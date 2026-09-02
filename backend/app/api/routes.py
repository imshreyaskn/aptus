import re
import logging
from datetime import datetime, timezone
from typing import Optional, List, Dict, Any
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy.orm import selectinload

from backend.app.config import settings
from backend.app.db.session import get_db
from backend.app.db.models import Candidate, InterviewSession, Question, Answer, SessionSummary, get_utc_now
from backend.app.schemas.interview import (
    StartInterviewRequest,
    StartInterviewResponse,
    NextQuestionResponse,
    QuestionItemResponse,
    SubmitAnswerRequest,
    SubmitAnswerResponse,
    SessionSummaryResponse,
    SessionHistoryResponse,
    HistoryQAItem,
    ResumeProfile,
    PlannedTopic,
    JudgeVerdict
)
from backend.app.core.resume_parser import (
    extract_text_from_pdf_bytes,
    validate_and_parse_resume,
    parse_resume_to_profile
)
from backend.app.graph.workflow import step_start_interview, step_process_answer
from backend.app.graph.state import InterviewState

logger = logging.getLogger(__name__)
router = APIRouter()

NAME_REGEX = r"^[A-Za-z]+$"


@router.get("/health", tags=["System"])
async def health_check():
    return {
        "status": "healthy",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "gemini_model": settings.GEMINI_MODEL,
        "roles": settings.ROLES
    }



@router.get("/roles", tags=["Configuration"])
async def list_roles():
    return {
        "roles": settings.ROLES,
        "description": "Supported interview screening domains"
    }


@router.post("/sessions/start", response_model=StartInterviewResponse, tags=["Interview Flow"])
async def start_interview(
    name: str = Form("Candidate"),
    role: str = Form(...),
    resume_text: Optional[str] = Form(None),
    resume_file: Optional[UploadFile] = File(None),
    db: AsyncSession = Depends(get_db)
):
    """
    Candidate entry point: Validates name format, uploads resume (PDF or text) and initiates interview session.
    Parses resume, plans topics via LangGraph, and generates the first question.
    """
    clean_name = (name or "Candidate").strip()
    logger.info("=" * 60)
    logger.info(f"[Start Session] Processing Begin Session request for candidate='{clean_name}', role='{role}'")

    # 1. Candidate Name Regex Validation (letters only, no numbers, no spaces)
    if not re.match(NAME_REGEX, clean_name):
        logger.warning(f"[Start Session] Name validation failed: '{clean_name}' contains numbers, spaces, or invalid characters.")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Candidate name must contain only letters (no numbers or spaces)."
        )

    if role not in settings.ROLES:
        logger.warning(f"[Start Session] Invalid role selected: '{role}'. Valid roles: {settings.ROLES}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid role '{role}'. Must be one of: {', '.join(settings.ROLES)}"
        )

    # 2. Extract resume text and optional raw PDF bytes
    raw_resume_text = ""
    pdf_bytes = None
    if resume_file and resume_file.filename:
        logger.info(f"[Start Session] Reading uploaded file: '{resume_file.filename}' (content_type: {resume_file.content_type})")
        file_bytes = await resume_file.read()
        if resume_file.filename.lower().endswith(".pdf"):
            pdf_bytes = file_bytes
            raw_resume_text = extract_text_from_pdf_bytes(file_bytes)
            logger.info(f"[Start Session] Extracted {len(raw_resume_text)} characters of text from PDF bytes via pypdf.")
        else:
            raw_resume_text = file_bytes.decode("utf-8", errors="ignore")
            logger.info(f"[Start Session] Decoded {len(raw_resume_text)} characters of text from uploaded file.")
    elif resume_text:
        raw_resume_text = resume_text.strip()
        logger.info(f"[Start Session] Received pasted resume text ({len(raw_resume_text)} characters).")
    else:
        raw_resume_text = f"Candidate interested in {role} position."
        logger.info("[Start Session] No resume text/file supplied; using default role placeholder.")

    # 3. Strict Security & Authenticity Validation with Gemini
    logger.info(f"[Start Session] Running sandboxed resume validation and credential extraction...")
    validation = validate_and_parse_resume(
        raw_text=raw_resume_text,
        default_name=clean_name,
        pdf_bytes=pdf_bytes,
        target_role=role
    )

    if not validation.is_valid:
        logger.warning(
            f"[Start Session] Resume REJECTED for '{clean_name}': {validation.rejection_reason}, "
            f"security_flags={validation.security_flags}"
        )
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Resume rejected: {validation.rejection_reason or 'Document is invalid, non-resume content, or contains prompt injection.'}"
        )

    logger.info(
        f"[Start Session] Resume APPROVED: is_valid=True, is_role_relevant={validation.is_role_relevant}, "
        f"seniority='{validation.estimated_experience_level}', detected_skills={len(validation.skills)}, "
        f"detected_technologies={len(validation.technologies)}"
    )

    validated_profile = validation.model_dump()
    candidate_name = clean_name  # Preserve user's verified name input

    # 4. Create Candidate in DB
    candidate = Candidate(
        name=candidate_name,
        resume_raw_text=raw_resume_text,
        role_selected=role,
        resume_profile=validated_profile
    )
    db.add(candidate)
    await db.flush()
    logger.info(f"[Start Session] Candidate persisted in DB with ID={candidate.id}")

    # 5. Create Session in DB
    session = InterviewSession(
        candidate_id=candidate.id,
        role=role,
        status="in_progress",
        topics_planned=[]
    )
    db.add(session)
    await db.flush()
    logger.info(f"[Start Session] Interview session created with ID={session.id}")

    # 6. Run LangGraph Start Flow
    logger.info(f"[Start Session] Executing LangGraph start flow (planning topics & generating initial question)...")
    graph_state = step_start_interview(
        session_id=session.id,
        candidate_id=candidate.id,
        candidate_name=candidate_name,
        role=role,
        resume_raw_text=raw_resume_text,
        resume_profile=validated_profile
    )

    # Update Candidate & Session with generated plan & profile
    candidate.resume_profile = graph_state.get("resume_profile", validated_profile)
    session.topics_planned = graph_state.get("topics_planned", [])
    
    # 7. Persist First Question
    q_data = graph_state.get("current_question", {})
    if q_data:
        question = Question(
            session_id=session.id,
            question_text=q_data.get("question_text") or q_data.get("question", ""),
            topic=q_data.get("topic", "Fundamentals"),
            difficulty=q_data.get("difficulty", "mid"),
            source_chunk_ids=q_data.get("source_chunks_detail", []),
            order_index=0
        )
        db.add(question)
        logger.info(f"[Start Session] Generated question on topic '{question.topic}' (difficulty: {question.difficulty})")

    await db.commit()
    await db.refresh(session)
    await db.refresh(candidate)

    logger.info(f"[Start Session] Session {session.id} successfully initialized with {len(session.topics_planned)} planned topics.")
    logger.info("=" * 60)

    return StartInterviewResponse(
        session_id=session.id,
        candidate_id=candidate.id,
        candidate_name=candidate.name,
        role=session.role,
        status=session.status,
        resume_profile=ResumeProfile(**candidate.resume_profile),
        topics_planned=[PlannedTopic(**t) for t in session.topics_planned]
    )


@router.get("/sessions/{session_id}/next-question", response_model=NextQuestionResponse, tags=["Interview Flow"])
async def get_next_question(session_id: str, db: AsyncSession = Depends(get_db)):
    """
    Returns the currently active unanswered question for the session.
    """
    # Fetch session
    q_session = await db.execute(
        select(InterviewSession)
        .options(selectinload(InterviewSession.questions).selectinload(Question.answer))
        .where(InterviewSession.id == session_id)
    )
    session = q_session.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Interview session not found")

    if session.status == "completed":
        return NextQuestionResponse(
            session_id=session.id,
            is_completed=True,
            question=None,
            progress={"total_questions": len(session.questions), "status": "completed"},
            message="Interview session is completed."
        )

    # Find first question without an answer
    unanswered_question = next((q for q in session.questions if not q.answer), None)

    if not unanswered_question:
        return NextQuestionResponse(
            session_id=session.id,
            is_completed=True,
            question=None,
            progress={"total_questions": len(session.questions), "status": "completed"},
            message="All questions answered. Ready for summary."
        )

    return NextQuestionResponse(
        session_id=session.id,
        is_completed=False,
        question=QuestionItemResponse(
            id=unanswered_question.id,
            session_id=unanswered_question.session_id,
            question_text=unanswered_question.question_text,
            topic=unanswered_question.topic,
            difficulty=unanswered_question.difficulty,
            order_index=unanswered_question.order_index,
            source_chunk_ids=unanswered_question.source_chunk_ids,
            created_at=unanswered_question.created_at
        ),
        progress={
            "current_index": unanswered_question.order_index + 1,
            "total_topics": len(session.topics_planned),
            "max_questions": settings.MAX_QUESTIONS_PER_SESSION
        }
    )


@router.post("/sessions/{session_id}/answer", response_model=SubmitAnswerResponse, tags=["Interview Flow"])
async def submit_answer(
    session_id: str,
    payload: SubmitAnswerRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    Submits a candidate's answer for evaluation.
    Judges the response, checks topic coverage, and generates the next question or final summary.
    """
    # Fetch session, candidate, and questions with answers
    stmt = (
        select(InterviewSession)
        .options(
            selectinload(InterviewSession.candidate),
            selectinload(InterviewSession.questions).selectinload(Question.answer)
        )
        .where(InterviewSession.id == session_id)
    )
    res = await db.execute(stmt)
    session = res.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    if session.status == "completed":
        raise HTTPException(status_code=400, detail="Interview session is already completed.")

    # Find target question
    question = next((q for q in session.questions if q.id == payload.question_id), None)
    if not question:
        raise HTTPException(status_code=404, detail="Question not found in this session")

    if question.answer:
        raise HTTPException(status_code=400, detail="This question has already been answered.")

    # Reconstruct graph state from DB history
    qa_history = []
    topic_coverage = {}
    for t in session.topics_planned:
        topic_coverage[t.get("topic")] = {"attempts": 0, "max_depth": "none", "covered": False}

    for past_q in sorted(session.questions, key=lambda x: x.order_index):
        if past_q.answer:
            qa_history.append({
                "question": {
                    "question": past_q.question_text,
                    "topic": past_q.topic,
                    "difficulty": past_q.difficulty,
                    "source_chunk_ids": past_q.source_chunk_ids
                },
                "answer_text": past_q.answer.answer_text,
                "judge_verdict": past_q.answer.judge_verdict
            })
            matched_t = past_q.topic if past_q.topic in topic_coverage else None
            if not matched_t:
                for k in topic_coverage.keys():
                    if past_q.topic.lower().strip() in k.lower().strip() or k.lower().strip() in past_q.topic.lower().strip():
                        matched_t = k
                        break
            if matched_t:
                topic_coverage[matched_t]["attempts"] += 1
                v_depth = past_q.answer.judge_verdict.get("depth", "insufficient")
                if v_depth in ["adequate", "deep"]:
                    topic_coverage[matched_t]["covered"] = True
                    topic_coverage[matched_t]["max_depth"] = v_depth

    # Accurately determine current topic index from the question being answered
    curr_topic_idx = 0
    for i, t in enumerate(session.topics_planned or []):
        t_name = t.get("topic", "") if isinstance(t, dict) else str(t)
        if t_name == question.topic or question.topic in t_name or t_name in question.topic:
            curr_topic_idx = i
            break

    current_state: InterviewState = {
        "session_id": session.id,
        "candidate_id": session.candidate.id,
        "candidate_name": session.candidate.name,
        "role": session.role,
        "resume_raw_text": session.candidate.resume_raw_text or "",
        "resume_profile": session.candidate.resume_profile or {},
        "topics_planned": session.topics_planned,
        "current_topic_index": curr_topic_idx,
        "current_difficulty": question.difficulty,
        "retrieved_chunks": question.source_chunk_ids or [],
        "current_question": {
            "question": question.question_text,
            "topic": question.topic,
            "difficulty": question.difficulty,
            "source_chunks_detail": question.source_chunk_ids
        },
        "last_answer_text": payload.answer_text,
        "last_judge_verdict": None,
        "qa_history": qa_history,
        "topic_coverage": topic_coverage,
        "questions_count": len(qa_history),
        "is_completed": False,
        "final_summary": None,
        "error": None
    }

    # Run state machine transition
    updated_state = step_process_answer(current_state, payload.answer_text)

    decision = updated_state.get("turn_decision", {})
    action = decision.get("action", "advance")
    interviewer_reply = decision.get("interviewer_reply")

    if action == "stay":
        # Candidate greeted, uttered noise, or asked for clarification/hint.
        # Do NOT persist an Answer or create a new Question. Stay on the current question!
        return SubmitAnswerResponse(
            answer_id=f"stay_{question.id}",
            question_id=question.id,
            judge_verdict=None,
            is_session_completed=False,
            next_question=None,
            action="stay",
            interviewer_reply=interviewer_reply,
            progress={
                "answered_count": len(qa_history),
                "max_questions": settings.MAX_QUESTIONS_PER_SESSION,
                "topic_coverage": updated_state.get("topic_coverage", {})
            }
        )

    # Persist Answer & Judge Verdict
    judge_verdict_data = updated_state.get("last_judge_verdict") or {}
    answer = Answer(
        question_id=question.id,
        answer_text=payload.answer_text,
        judge_verdict=judge_verdict_data
    )
    db.add(answer)
    await db.flush()

    is_completed = updated_state.get("is_completed", False) or (action == "conclude")
    next_question_item = None

    if is_completed:
        session.status = "completed"
        session.completed_at = get_utc_now()
        summary_data = updated_state.get("final_summary", {})
        
        # Save session summary
        summary = SessionSummary(
            session_id=session.id,
            summary_text=summary_data.get("summary_text", "Interview completed."),
            strengths=summary_data.get("strengths", []),
            gaps=summary_data.get("gaps", []),
            next_steps=summary_data.get("next_steps", []),
            recommendation=summary_data.get("overall_recommendation")
        )
        db.add(summary)
    else:
        # Save newly generated question
        next_q_data = updated_state.get("current_question")
        if next_q_data:
            next_order_index = len(session.questions)
            next_q = Question(
                session_id=session.id,
                question_text=next_q_data.get("question_text") or next_q_data.get("question", ""),
                topic=next_q_data.get("topic", "System Design"),
                difficulty=next_q_data.get("difficulty", "mid"),
                source_chunk_ids=next_q_data.get("source_chunks_detail", []),
                order_index=next_order_index
            )
            db.add(next_q)
            await db.flush()
            await db.refresh(next_q)

            next_question_item = QuestionItemResponse(
                id=next_q.id,
                session_id=next_q.session_id,
                question_text=next_q.question_text,
                topic=next_q.topic,
                difficulty=next_q.difficulty,
                order_index=next_q.order_index,
                source_chunk_ids=next_q.source_chunk_ids,
                created_at=next_q.created_at
            )

    await db.commit()

    return SubmitAnswerResponse(
        answer_id=answer.id,
        question_id=question.id,
        judge_verdict=JudgeVerdict(**judge_verdict_data) if judge_verdict_data else None,
        is_session_completed=is_completed,
        next_question=next_question_item,
        action=action,
        interviewer_reply=interviewer_reply,
        progress={
            "answered_count": len(qa_history) + 1,
            "max_questions": settings.MAX_QUESTIONS_PER_SESSION,
            "topic_coverage": updated_state.get("topic_coverage", {})
        }
    )


@router.post("/sessions/{session_id}/end", response_model=SessionSummaryResponse, tags=["Interview Flow"])
async def end_session(session_id: str, db: AsyncSession = Depends(get_db)):
    """
    Explicitly ends an interview session and triggers executive evaluation and summary synthesis.
    """
    stmt = (
        select(InterviewSession)
        .options(
            selectinload(InterviewSession.candidate),
            selectinload(InterviewSession.questions).selectinload(Question.answer),
            selectinload(InterviewSession.summary)
        )
        .where(InterviewSession.id == session_id)
    )
    res = await db.execute(stmt)
    session = res.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Interview session not found")

    if session.summary:
        return SessionSummaryResponse(
            session_id=session.summary.session_id,
            summary_text=session.summary.summary_text,
            strengths=session.summary.strengths,
            gaps=session.summary.gaps,
            next_steps=session.summary.next_steps,
            overall_recommendation=session.summary.recommendation,
            generated_at=session.summary.generated_at
        )

    # Reconstruct QA history for summarization
    qa_history = []
    for past_q in sorted(session.questions, key=lambda x: x.order_index):
        if past_q.answer:
            qa_history.append({
                "question": {
                    "question": past_q.question_text,
                    "topic": past_q.topic,
                    "difficulty": past_q.difficulty,
                    "source_chunk_ids": past_q.source_chunk_ids
                },
                "answer_text": past_q.answer.answer_text,
                "judge_verdict": past_q.answer.judge_verdict
            })

    current_state: InterviewState = {
        "session_id": session.id,
        "candidate_id": session.candidate.id,
        "candidate_name": session.candidate.name,
        "role": session.role,
        "resume_raw_text": session.candidate.resume_raw_text or "",
        "resume_profile": session.candidate.resume_profile or {},
        "topics_planned": session.topics_planned or [],
        "qa_history": qa_history,
        "is_completed": True
    }

    summary_result = summarize_node(current_state)
    summary_data = summary_result.get("final_summary", {})

    session.status = "completed"
    session.completed_at = get_utc_now()
    summary = SessionSummary(
        session_id=session.id,
        summary_text=summary_data.get("summary_text", "Interview completed."),
        strengths=summary_data.get("strengths", []),
        gaps=summary_data.get("gaps", []),
        next_steps=summary_data.get("next_steps", [])
    )
    db.add(summary)
    await db.commit()

    return SessionSummaryResponse(
        session_id=summary.session_id,
        summary_text=summary.summary_text,
        strengths=summary.strengths,
        gaps=summary.gaps,
        next_steps=summary.next_steps,
        generated_at=summary.generated_at
    )


@router.get("/sessions/{session_id}/summary", response_model=SessionSummaryResponse, tags=["Interview Flow"])
async def get_session_summary(session_id: str, db: AsyncSession = Depends(get_db)):
    """
    Fetches the final evaluated summary for a completed interview.
    """
    stmt = (
        select(SessionSummary)
        .where(SessionSummary.session_id == session_id)
    )
    res = await db.execute(stmt)
    summary = res.scalar_one_or_none()
    if not summary:
        raise HTTPException(status_code=404, detail="Summary not found for this session. It may still be in progress.")

    return SessionSummaryResponse(
        session_id=summary.session_id,
        summary_text=summary.summary_text,
        strengths=summary.strengths,
        gaps=summary.gaps,
        next_steps=summary.next_steps,
        generated_at=summary.generated_at
    )


@router.get("/sessions/{session_id}/history", response_model=SessionHistoryResponse, tags=["Traceability & Audit"])
async def get_session_history(session_id: str, db: AsyncSession = Depends(get_db)):
    """
    Returns full Q&A transcript with source chunk traceability and judge verdicts.
    """
    stmt = (
        select(InterviewSession)
        .options(
            selectinload(InterviewSession.candidate),
            selectinload(InterviewSession.questions).selectinload(Question.answer),
            selectinload(InterviewSession.summary)
        )
        .where(InterviewSession.id == session_id)
    )
    res = await db.execute(stmt)
    session = res.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    qa_pairs = []
    for q in sorted(session.questions, key=lambda x: x.order_index):
        qa_pairs.append(HistoryQAItem(
            question_id=q.id,
            question_text=q.question_text,
            topic=q.topic,
            difficulty=q.difficulty,
            order_index=q.order_index,
            source_chunks=q.source_chunk_ids or [],
            answer_id=q.answer.id if q.answer else None,
            answer_text=q.answer.answer_text if q.answer else None,
            judge_verdict=q.answer.judge_verdict if q.answer else None
        ))

    summary_resp = None
    if session.summary:
        summary_resp = SessionSummaryResponse(
            session_id=session.summary.session_id,
            summary_text=session.summary.summary_text,
            strengths=session.summary.strengths,
            gaps=session.summary.gaps,
            next_steps=session.summary.next_steps,
            generated_at=session.summary.generated_at
        )

    return SessionHistoryResponse(
        session_id=session.id,
        role=session.role,
        candidate_name=session.candidate.name,
        status=session.status,
        resume_profile=session.candidate.resume_profile or {},
        topics_planned=session.topics_planned or [],
        qa_pairs=qa_pairs,
        summary=summary_resp
    )

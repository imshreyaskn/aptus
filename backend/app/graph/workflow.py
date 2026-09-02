import logging
from typing import Dict, Any, Optional
from uuid import uuid4
from langgraph.graph import StateGraph, END
from langgraph.checkpoint.memory import MemorySaver
from backend.app.graph.state import InterviewState
from backend.app.graph.nodes import (
    parse_resume_node,
    plan_topics_node,
    retrieve_node,
    generate_question_node,
    classify_and_evaluate_node,  # Merged node per §3 - replaces turn_director + judge_answer
    coverage_check_node,
    summarize_node,
)

logger = logging.getLogger(__name__)


def should_continue(state: InterviewState) -> str:
    """Routing condition after coverage check."""
    if state.get("is_completed", False):
        return "summarize"
    return "retrieve"


def build_interview_graph(checkpointer=None):
    """
    Constructs the LangGraph state machine with optional checkpointing.
    Per §7: Uses LangGraph's own checkpointer for persistence - no separate stores needed.
    """
    builder = StateGraph(InterviewState)

    # Register Nodes (using merged classify_and_evaluate per §3)
    # judge_answer_node removed - functionality merged into classify_and_evaluate_node
    builder.add_node("parse_resume", parse_resume_node)
    builder.add_node("plan_topics", plan_topics_node)
    builder.add_node("retrieve", retrieve_node)
    builder.add_node("generate_question", generate_question_node)
    builder.add_node("classify_and_evaluate", classify_and_evaluate_node)
    builder.add_node("coverage_check", coverage_check_node)
    builder.add_node("summarize", summarize_node)

    # Initial flow
    builder.set_entry_point("parse_resume")
    builder.add_edge("parse_resume", "plan_topics")
    builder.add_edge("plan_topics", "retrieve")
    builder.add_edge("retrieve", "generate_question")
    # After generating question, we pause / await answer (END of initial step)
    builder.add_edge("generate_question", END)

    # When an answer is submitted:
    builder.add_edge("classify_and_evaluate", "coverage_check")
    builder.add_conditional_edges(
        "coverage_check",
        should_continue,
        {
            "summarize": "summarize",
            "retrieve": "retrieve"
        }
    )
    builder.add_edge("summarize", END)

    return builder.compile(checkpointer=checkpointer)


# Singleton compiled graph instance with persistent checkpointing
# Per §7: LangGraph's own checkpointer handles all persistence (message_history, insight_buffer, state)
# PRODUCTION NOTE: Replace MemorySaver with AsyncSqliteSaver or Postgres-backed checkpointer for production
_memory_saver = MemorySaver()
interview_graph = build_interview_graph(checkpointer=_memory_saver)


def get_graph_with_thread(thread_id: str):
    """Get a graph instance configured for a specific thread/session."""
    return build_interview_graph(checkpointer=_memory_saver)


def step_start_interview(
    session_id: str,
    candidate_id: str,
    candidate_name: str,
    role: str,
    resume_raw_text: str,
    resume_profile: Optional[Dict[str, Any]] = None
) -> InterviewState:
    """
    Executes the start sequence: parse_resume -> plan_topics -> retrieve -> generate_question.
    Uses checkpointing per §7 - state is persisted automatically.
    """
    initial_state: InterviewState = {
        "session_id": session_id,
        "candidate_id": candidate_id,
        "candidate_name": candidate_name,
        "role": role,
        "resume_raw_text": resume_raw_text,
        "resume_profile": resume_profile or {},
        "topics_planned": [],
        "current_topic_index": 0,
        "current_difficulty": "mid",
        "retrieved_chunks": [],
        "current_question": None,
        "last_answer_text": None,
        "last_judge_verdict": None,
        "qa_history": [],
        "topic_coverage": {},
        "questions_count": 0,
        "is_completed": False,
        "final_summary": None,
        "error": None
    }

    # Step 1: parse_resume
    s1 = parse_resume_node(initial_state)
    state = {**initial_state, **s1}

    # Step 2: plan_topics
    s2 = plan_topics_node(state)
    state = {**state, **s2}

    # Step 3: retrieve
    s3 = retrieve_node(state)
    state = {**state, **s3}

    # Step 4: generate_question
    s4 = generate_question_node(state)
    state = {**state, **s4}

    return state


def step_process_answer(
    current_state: InterviewState,
    answer_text: str,
    modality: str = "text",
    asr_confidence: float = 1.0,
    interruption_flag: bool = False
) -> InterviewState:
    """
    Processes candidate turn using merged classify_and_evaluate node per §3.
    
    STATELESS: Takes current_state as parameter, returns updated state.
    No global mutation, no side effects.
    
    Args:
        current_state: Current interview state (Pydantic model)
        answer_text: Candidate's response text (transcript for voice, typed for text)
        modality: "voice" or "text"
        asr_confidence: STT confidence (1.0 for text)
        interruption_flag: True if this arrived while agent was speaking
    
    Returns:
        Updated InterviewState with evaluation results and next question (or summary if completed)
    """
    # Convert state to dict for graph processing
    state = current_state.model_dump() if hasattr(current_state, "model_dump") else dict(current_state)
    
    # Create unified Turn object per spec §1 (Pydantic validated)
    from backend.app.graph.state import Turn
    turn = Turn(
        modality=modality,  # type: ignore
        normalized_text=answer_text,
        asr_confidence=asr_confidence,
        interruption_flag=interruption_flag
    )
    state["last_turn"] = turn.model_dump()
    
    # Run merged classify_and_evaluate (replaces turn_director + judge_answer)
    eval_result = classify_and_evaluate_node(state)
    state = {**state, **eval_result}
    
    decision = state.get("turn_decision", {})
    action = decision.get("action", "advance")
    turn_type = decision.get("turn_type", "answer")
    
    # Handle stay actions (clarification, smalltalk, noise, meta_question)
    if action == "stay":
        # Keep current question active, return conversational reply
        # DO NOT increment questions_count or burn question slot
        interviewer_reply = decision.get("interviewer_reply", "")
        state["interviewer_reply"] = interviewer_reply
        
        # Convert back to Pydantic model
        return InterviewState(**state)
    
    # Handle conclude (end_request)
    if action == "conclude":
        s_res = summarize_node(state)
        state = {**state, **s_res, "is_completed": True}
        return InterviewState(**state)
    
    # For advance actions: check coverage and proceed
    c_res = coverage_check_node(state)
    state = {**state, **c_res}
    
    if state.get("is_completed", False):
        # Summarize and end
        s_res = summarize_node(state)
        state = {**state, **s_res}
    else:
        # Generate next question
        r_res = retrieve_node(state)
        state = {**state, **r_res}
        
        g_res = generate_question_node(state)
        state = {**state, **g_res}
    
    # Convert back to Pydantic model with validation
    return InterviewState(**state)

import logging
from typing import Dict, Any, Optional
from langgraph.graph import StateGraph, END
from backend.app.graph.state import InterviewState
from backend.app.graph.nodes import (
    parse_resume_node,
    plan_topics_node,
    retrieve_node,
    generate_question_node,
    turn_director_node,
    judge_answer_node,
    coverage_check_node,
    summarize_node,
)

logger = logging.getLogger(__name__)


def should_continue(state: InterviewState) -> str:
    """Routing condition after coverage check."""
    if state.get("is_completed", False):
        return "summarize"
    return "retrieve"


def build_interview_graph():
    """
    Constructs the LangGraph state machine.
    """
    builder = StateGraph(InterviewState)

    # Register Nodes
    builder.add_node("parse_resume", parse_resume_node)
    builder.add_node("plan_topics", plan_topics_node)
    builder.add_node("retrieve", retrieve_node)
    builder.add_node("generate_question", generate_question_node)
    builder.add_node("turn_director", turn_director_node)
    builder.add_node("judge_answer", judge_answer_node)
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
    builder.add_edge("turn_director", "judge_answer")
    builder.add_edge("judge_answer", "coverage_check")
    builder.add_conditional_edges(
        "coverage_check",
        should_continue,
        {
            "summarize": "summarize",
            "retrieve": "retrieve"
        }
    )
    builder.add_edge("summarize", END)

    return builder.compile()


# Singleton compiled graph instance
interview_graph = build_interview_graph()


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
    answer_text: str
) -> InterviewState:
    """
    Intelligently processes candidate turn:
    1. Runs turn_director_node to classify intent and decide action ('advance', 'stay', 'conclude').
    2. If action == 'stay': keeps current question active, returns conversational reply without advancing counter.
    3. If action == 'conclude': summarizes and marks completed.
    4. If action == 'advance': judges answer -> checks coverage -> (summarizes OR generates next question).
    """
    state = dict(current_state)
    state["last_answer_text"] = answer_text

    # Step 1: Intelligent Turn Direction
    d_res = turn_director_node(state)
    state = {**state, **d_res}
    decision = state.get("turn_decision", {})
    action = decision.get("action", "advance")

    if action == "stay":
        # Candidate greeted, uttered noise, or asked for clarification/hint.
        # DO NOT increment questions_count, DO NOT burn question slot!
        return state

    if action == "conclude":
        # Candidate asked to conclude the interview
        s_res = summarize_node(state)
        state = {**state, **s_res, "is_completed": True}
        return state

    # Step 2: Judge answer (for actual answers or forfeits)
    j_res = judge_answer_node(state)
    state = {**state, **j_res}

    # Step 3: Coverage check
    c_res = coverage_check_node(state)
    state = {**state, **c_res}

    if state.get("is_completed", False):
        # Step 4a: Summarize
        s_res = summarize_node(state)
        state = {**state, **s_res}
    else:
        # Step 4b: Retrieve & generate next question
        r_res = retrieve_node(state)
        state = {**state, **r_res}

        g_res = generate_question_node(state)
        state = {**state, **g_res}

    return state

import pytest
from backend.app.graph.workflow import step_start_interview, step_process_answer


def test_langgraph_start_and_process_flow():
    session_id = "test-session-123"
    candidate_id = "test-cand-123"
    role = "AI/ML Engineer"
    resume = "Candidate with experience in PyTorch and Deep Learning."

    # Start Interview step
    start_state = step_start_interview(
        session_id=session_id,
        candidate_id=candidate_id,
        candidate_name="Test User",
        role=role,
        resume_raw_text=resume
    )

    assert "resume_profile" in start_state
    assert len(start_state["topics_planned"]) > 0
    assert start_state["current_question"] is not None
    assert "question" in start_state["current_question"]

    # Submit an answer step
    answer_text = (
        "In deep learning, backpropagation computes the gradient of the loss function "
        "with respect to each weight using the chain rule. Stochastic gradient descent "
        "then updates the parameters in the direction of steepest descent."
    )

    updated_state = step_process_answer(start_state, answer_text)

    assert updated_state["last_judge_verdict"] is not None
    assert updated_state["last_judge_verdict"]["score"] >= 1
    assert len(updated_state["qa_history"]) == 1
    assert updated_state["questions_count"] == 1


def test_early_exit_summary_incomplete():
    from backend.app.graph.nodes import summarize_node
    from backend.app.schemas.interview import FinalSummary

    empty_state = {
        "session_id": "test-early-exit",
        "candidate_id": "cand-1",
        "candidate_name": "EarlyQuitter",
        "role": "AI/ML Engineer",
        "qa_history": [],
        "resume_profile": {},
        "topics_planned": []
    }

    result = summarize_node(empty_state)
    assert result["is_completed"] is True
    assert "final_summary" in result
    summary = FinalSummary.model_validate(result["final_summary"])
    assert summary.overall_recommendation == "Incomplete"


def test_turn_director_stay_on_noise_and_greeting():
    from backend.app.graph.nodes import turn_director_node

    state_greeting = {
        "candidate_name": "TestCandidate",
        "current_question": {"topic": "Transformers", "question": "Explain attention mechanism"},
        "last_answer_text": "hey bro how are you"
    }
    res_greeting = turn_director_node(state_greeting)
    decision = res_greeting["turn_decision"]
    assert decision["action"] == "stay"
    assert decision["intent"] in ["smalltalk_or_greeting", "clarification"]
    assert len(decision["interviewer_reply"]) > 0

    state_noise = {
        "candidate_name": "TestCandidate",
        "current_question": {"topic": "Transformers", "question": "Explain attention mechanism"},
        "last_answer_text": "phone"
    }
    res_noise = turn_director_node(state_noise)
    decision_noise = res_noise["turn_decision"]
    assert decision_noise["action"] == "stay"
    assert decision_noise["intent"] == "noise_or_incomplete"


def test_turn_director_advance_on_forfeit():
    from backend.app.graph.nodes import turn_director_node, judge_answer_node

    state_forfeit = {
        "candidate_name": "TestCandidate",
        "current_question": {"topic": "Transformers", "question": "Explain attention mechanism"},
        "last_answer_text": "I don't know bro",
        "current_difficulty": "mid",
        "qa_history": [],
        "topic_coverage": {"Transformers": {"attempts": 0, "covered": False}},
        "questions_count": 0
    }
    res = turn_director_node(state_forfeit)
    decision = res["turn_decision"]
    assert decision["action"] == "advance"
    assert decision["intent"] == "forfeit"

    state_with_decision = {**state_forfeit, **res}
    judge_res = judge_answer_node(state_with_decision)
    assert judge_res["last_judge_verdict"]["score"] == 1
    assert judge_res["questions_count"] == 1
    assert len(judge_res["qa_history"]) == 1


def test_turn_director_conclude_on_exit():
    from backend.app.graph.nodes import turn_director_node

    state_exit = {
        "candidate_name": "TestCandidate",
        "current_question": {"topic": "Transformers", "question": "Explain attention mechanism"},
        "last_answer_text": "I want to end the interview"
    }
    res = turn_director_node(state_exit)
    decision = res["turn_decision"]
    assert decision["action"] == "conclude"
    assert decision["intent"] == "end_request"


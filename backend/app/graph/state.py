from typing import TypedDict, List, Dict, Any, Optional
from backend.app.schemas.interview import ResumeProfile, PlannedTopic, GeneratedQuestion, JudgeVerdict, FinalSummary


class InterviewState(TypedDict):
    # Session identifiers & setup
    session_id: str
    candidate_id: str
    candidate_name: str
    role: str
    resume_raw_text: str
    resume_profile: Dict[str, Any]
    
    # Topic Planning
    topics_planned: List[Dict[str, Any]]
    current_topic_index: int
    current_difficulty: str  # junior | mid | senior
    
    # RAG Context
    retrieved_chunks: List[Dict[str, Any]]
    
    # Current Question & Answer Cycle
    current_question: Optional[Dict[str, Any]]
    last_answer_text: Optional[str]
    last_judge_verdict: Optional[Dict[str, Any]]
    
    # Q&A Transcript & Coverage Tracking
    qa_history: List[Dict[str, Any]]
    topic_coverage: Dict[str, Dict[str, Any]]  # {topic_name: {"attempts": int, "max_depth": str, "covered": bool}}
    questions_count: int
    
    # Final Result
    is_completed: bool
    final_summary: Optional[Dict[str, Any]]
    error: Optional[str]

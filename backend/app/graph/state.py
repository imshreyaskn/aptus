from pydantic import BaseModel, Field, validator
from typing import List, Dict, Any, Optional, Literal
from uuid import uuid4
from datetime import datetime


class Turn(BaseModel):
    """
    Unified turn object for both voice and text modalities.
    The graph never knows which modality produced this turn.
    Runtime validation ensures data integrity.
    """
    turn_id: str = Field(default_factory=lambda: str(uuid4()))
    modality: Literal["voice", "text"]
    normalized_text: str
    asr_confidence: float = 1.0
    interruption_flag: bool = False
    
    @validator('asr_confidence')
    def validate_confidence(cls, v):
        if not 0.0 <= v <= 1.0:
            raise ValueError(f"asr_confidence must be between 0 and 1, got {v}")
        return v


class InsightEntry(BaseModel):
    """Evidence-linked claim for insight generation."""
    topic: str
    claim: str
    evidence: str
    observation: str


class InterviewState(BaseModel):
    """
    Strongly typed state with runtime validation per spec §2.
    Pydantic provides runtime type checking, default values, and validation.
    """
    # Context (pre-seeded)
    session_id: str = Field(default_factory=lambda: str(uuid4()))
    candidate_name: str = ""
    resume_summary: str = ""
    role_context: str = ""
    
    # Conversation
    message_history: List[Dict[str, Any]] = Field(default_factory=list)
    current_topic: Optional[str] = None
    topics_covered: List[str] = Field(default_factory=list)
    turn_count: int = 0
    current_phase: Literal[
        "INIT", "OPENING", "QUESTION_DELIVERY", "WAIT_FOR_TURN",
        "CLASSIFY_AND_EVALUATE", "CLARIFY_UNCERTAIN", "ESCALATE_PIVOT",
        "COVERAGE_CHECK", "WRAPUP", "INSIGHT_GENERATION", "CLOSED", "ERROR_RECOVERY"
    ] = "INIT"
    
    # Evaluation
    answer_quality: Optional[float] = None
    evaluation_confidence: float = 0.0
    candidate_confidence: Optional[float] = None
    hedging_detected: bool = False
    question_quality_flag: bool = True
    contradicts_resume_flag: bool = False
    
    # Escalation
    difficulty_level: Literal["junior", "mid", "senior"] = "junior"
    consecutive_strong: int = 0
    consecutive_weak: int = 0
    topic_sub_state: Dict[str, Any] = Field(default_factory=dict)
    
    # Uncertainty
    uncertainty_type: Optional[Literal[
        "asr_low_conf", "candidate_hedging", "silence_timeout", 
        "off_topic", "ambiguous", "meta_question"
    ]] = None
    unresolved_retry_count: int = 0
    
    # Delivery
    question_delivery_state: Literal["fully_delivered", "interrupted"] = "fully_delivered"
    agent_speaking_flag: bool = False
    
    # Insight
    insight_buffer: List[InsightEntry] = Field(default_factory=list)
    
    # Current cycle state
    current_question: Optional[Dict[str, Any]] = None
    last_turn: Optional[Turn] = None
    
    class Config:
        arbitrary_types_allowed = True
        extra = "ignore"  # Gracefully handle extra fields from checkpoints

    def prune_history(self, max_turns: int = 50):
        """
        Prevent memory leaks by pruning old history while keeping context.
        Called periodically to bound memory usage in long sessions.
        """
        if len(self.message_history) > max_turns * 2:  # Only prune when significantly over limit
            # Keep system prompt + last N turns
            system_msgs = [m for m in self.message_history if m.get("role") == "system"]
            non_system_msgs = [m for m in self.message_history if m.get("role") != "system"]
            
            # Keep most recent messages
            recent_msgs = non_system_msgs[-max_turns:]
            
            self.message_history = system_msgs + recent_msgs
    
    def add_to_history(self, role: str, content: str):
        """Safely add message to history with automatic pruning."""
        self.message_history.append({"role": role, "content": content, "timestamp": datetime.utcnow().isoformat()})
        self.turn_count += 1
        
        # Prune if getting too large
        if len(self.message_history) > 100:
            self.prune_history(max_turns=50)

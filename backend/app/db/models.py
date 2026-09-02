import uuid
from datetime import datetime, timezone
from sqlalchemy import Column, String, Text, DateTime, ForeignKey, Integer, JSON
from sqlalchemy.orm import relationship
from backend.app.db.session import Base


def generate_uuid() -> str:
    return str(uuid.uuid4())


def get_utc_now():
    return datetime.now(timezone.utc)


class Candidate(Base):
    __tablename__ = "candidates"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    name = Column(String(255), nullable=False, default="Candidate")
    resume_raw_text = Column(Text, nullable=True)
    resume_profile = Column(JSON, nullable=False, default=dict)
    role_selected = Column(String(100), nullable=False)
    created_at = Column(DateTime, default=get_utc_now, nullable=False)


    # Relationships
    sessions = relationship("InterviewSession", back_populates="candidate", cascade="all, delete-orphan")


class InterviewSession(Base):
    __tablename__ = "sessions"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    candidate_id = Column(String(36), ForeignKey("candidates.id", ondelete="CASCADE"), nullable=False)
    role = Column(String(100), nullable=False)
    status = Column(String(50), nullable=False, default="in_progress")  # in_progress | completed
    topics_planned = Column(JSON, nullable=False, default=list)
    created_at = Column(DateTime, default=get_utc_now, nullable=False)
    completed_at = Column(DateTime, nullable=True)

    # Relationships
    candidate = relationship("Candidate", back_populates="sessions")
    questions = relationship("Question", back_populates="session", cascade="all, delete-orphan", order_by="Question.order_index")
    summary = relationship("SessionSummary", back_populates="session", uselist=False, cascade="all, delete-orphan")


class Question(Base):
    __tablename__ = "questions"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    session_id = Column(String(36), ForeignKey("sessions.id", ondelete="CASCADE"), nullable=False)
    question_text = Column(Text, nullable=False)
    topic = Column(String(100), nullable=False)
    difficulty = Column(String(50), nullable=False, default="mid")  # junior | mid | senior
    source_chunk_ids = Column(JSON, nullable=False, default=list)  # List of chunk identifiers & passages
    order_index = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime, default=get_utc_now, nullable=False)

    # Relationships
    session = relationship("InterviewSession", back_populates="questions")
    answer = relationship("Answer", back_populates="question", uselist=False, cascade="all, delete-orphan")


class Answer(Base):
    __tablename__ = "answers"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    question_id = Column(String(36), ForeignKey("questions.id", ondelete="CASCADE"), nullable=False, unique=True)
    answer_text = Column(Text, nullable=False)
    judge_verdict = Column(JSON, nullable=False, default=dict)  # {depth, correctness, relevance, feedback, score}
    submitted_at = Column(DateTime, default=get_utc_now, nullable=False)

    # Relationships
    question = relationship("Question", back_populates="answer")


class SessionSummary(Base):
    __tablename__ = "session_summaries"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    session_id = Column(String(36), ForeignKey("sessions.id", ondelete="CASCADE"), nullable=False, unique=True)
    summary_text = Column(Text, nullable=False)
    strengths = Column(JSON, nullable=False, default=list)
    gaps = Column(JSON, nullable=False, default=list)
    next_steps = Column(JSON, nullable=False, default=list)
    recommendation = Column(String(50), nullable=True)
    generated_at = Column(DateTime, default=get_utc_now, nullable=False)

    # Relationships
    session = relationship("InterviewSession", back_populates="summary")

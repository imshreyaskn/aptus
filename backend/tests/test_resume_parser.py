import pytest
from backend.app.core.resume_parser import parse_resume_to_profile


def test_resume_parsing():
    sample_resume = (
        "Sarah Connor\n"
        "Senior Backend Architect with 7+ years of experience in distributed systems.\n"
        "Proficient in Python, PostgreSQL, Redis, Kafka, Docker, and Kubernetes.\n"
        "Designed high-concurrency microservices with 99.99% availability."
    )

    profile = parse_resume_to_profile(sample_resume, default_name="Sarah Connor")
    assert profile.name in ["Sarah Connor", "Candidate"]
    assert profile.estimated_experience_level in ["senior", "mid", "junior"]
    assert len(profile.skills) > 0
    assert any("python" in t.lower() or "sql" in t.lower() or "docker" in t.lower() for t in profile.technologies)

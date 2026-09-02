import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport
from backend.app.main import app
from backend.app.db.session import init_db


@pytest.mark.asyncio
async def test_api_end_to_end_flow():
    # Initialize DB
    await init_db()

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # 1. Health check
        res_health = await client.get("/api/health")
        assert res_health.status_code == 200
        assert res_health.json()["status"] == "healthy"

        # 2. Roles check
        res_roles = await client.get("/api/roles")
        assert res_roles.status_code == 200
        assert len(res_roles.json()["roles"]) >= 3

        # 3. Start Interview
        res_start = await client.post(
            "/api/sessions/start",
            data={
                "name": "Jordan",
                "role": "AI/ML Engineer",
                "resume_text": "Experienced ML Engineer with PyTorch, Transformers, and distributed training skills."
            }
        )
        assert res_start.status_code == 200
        start_data = res_start.json()
        session_id = start_data["session_id"]
        assert session_id is not None
        assert len(start_data["topics_planned"]) > 0

        # 4. Get next question
        res_q = await client.get(f"/api/sessions/{session_id}/next-question")
        assert res_q.status_code == 200
        q_data = res_q.json()
        assert not q_data["is_completed"]
        assert q_data["question"] is not None
        question_id = q_data["question"]["id"]

        # 5. Submit answer
        res_ans = await client.post(
            f"/api/sessions/{session_id}/answer",
            json={
                "question_id": question_id,
                "answer_text": "Adam combines momentum and RMSProp using exponentially decaying averages of past gradients and squared gradients with bias correction."
            }
        )
        assert res_ans.status_code == 200
        ans_data = res_ans.json()
        assert ans_data["judge_verdict"]["score"] >= 1
        assert "feedback" in ans_data["judge_verdict"]

        # 6. Check history
        res_hist = await client.get(f"/api/sessions/{session_id}/history")
        assert res_hist.status_code == 200
        hist_data = res_hist.json()
        assert len(hist_data["qa_pairs"]) >= 1
        assert hist_data["qa_pairs"][0]["answer_text"] is not None

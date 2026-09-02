# Aptus — AI Candidate Screening System

A role-based, RAG-driven technical screening system that conducts adaptive mock interviews. Candidates upload a resume, choose a target role, answer dynamically generated technical questions grounded in domain literature, and receive structured evaluation summaries with full source-chunk traceability.


---

## 1. System Architecture

```
                      +-----------------------------+
                      |     React (Vite) UI         |
                      |  Upload / Interview / Audit |
                      +--------------+--------------+
                                     | (REST API)
                                     v
                      +-----------------------------+
                      |       FastAPI Backend       |
                      +--------------+--------------+
                                     |
               +---------------------+---------------------+
               |                     |                     |
               v                     v                     v
    +--------------------+  +------------------+  +------------------+
    |  PostgreSQL / DB   |  | LangGraph Engine |  |  FAISS Vectors   |
    | (Candidates, Q&A)  |  |  (State Machine) |  | (Per-role index) |
    +--------------------+  +--------+---------+  +--------+---------+
                                     |                     |
                                     v                     v
                            +------------------+  +------------------+
                            |  Google Gemini   |  |  sentence-tf     |
                            | (Structured JSON)|  | (all-MiniLM-L6)  |
                            +------------------+  +------------------+
```

---

## 2. Roles & Knowledge Base

| Role | Knowledge Base & Textbooks | Status / Corpus |
|---|---|---|
| **AI/ML Engineer** | Tom Mitchell's *Machine Learning* + *The Hundred-Page ML Book* | Ingested |
| **Data Science / Applied ML** | *Introduction to ML with Python* + *Master ML Algorithms* | Ingested |
| **Backend Engineer** | Modern Backend Engineering: Systems Architecture, Storage Engines & Distributed Reliability | **Curated Design Substitution** (see below) |

### Design Decision: Backend Engineer Corpus Substitution
*As noted in the assignment specification, the baseline materials focus on machine learning. For the **Backend Engineer** track, we sourced and curated a specialized corpus covering database storage engines (B-Trees vs. LSM-Trees), ANSI SQL transaction isolation levels (MVCC, serializability anomalies), distributed consensus (Raft, Paxos, CAP/PACELC), caching architectures (cache stampede mitigation, eviction policies), API idempotency, and asynchronous messaging architectures (event sourcing, outbox pattern).*

---

## 3. LangGraph State Machine

The interview state machine orchestrates the interview lifecycle:

```
[Candidate Entry]
       │
       ▼
 ┌─────────────┐
 │parse_resume │ ──► Extract skills, tech stack, experience level (Junior/Mid/Senior)
 └──────┬──────┘
        ▼
 ┌─────────────┐
 │ plan_topics │ ──► Synthesize 4-6 prioritized topics tailored to role & candidate
 └──────┬──────┘
        ▼
 ┌─────────────┐
 │  retrieve   │ ──► Query role FAISS index for top-k chunks with section metadata
 └──────┬──────┘
        ▼
 ┌───────────────────┐
 │ generate_question │ ──► Formulate question grounded in retrieved knowledge
 └────────┬──────────┘
          ▼
   [await_answer]    ──► Persist question & return to candidate UI
          │
  (Candidate submits)
          ▼
 ┌──────────────┐
 │ judge_answer │    ──► Score depth (insufficient/adequate/deep), correctness & relevance
 └──────┬───────┘
        ▼
 ┌────────────────┐
 │ coverage_check │
 └──────┬─────────┘
        ├──────────────────────────┐
 [Topics/Cap not reached]   [All covered or Cap hit]
        │                          │
        ▼                          ▼
   (Loop to retrieve)       ┌───────────┐
                            │ summarize │ ──► Synthesize strengths, gaps & next steps
                            └─────┬─────┘
                                  ▼
                                [END]
```

---

## 4. Quickstart Guide

### Option A: Docker Compose (Recommended)

Run the entire stack (Postgres + Backend + Frontend) in one command:

```bash
# 1. Set your Gemini API Key in .env
cp .env.example .env
# Edit .env and set GEMINI_API_KEY=your_key_here

# 2. Launch with Docker Compose
docker-compose up --build
```

- **Frontend UI**: `http://localhost:5173`
- **Backend API**: `http://localhost:8000`
- **Interactive Swagger Docs**: `http://localhost:8000/docs`

---

### Option B: Local Development (Without Docker)

#### 1. Backend Setup (Python 3.10+)

```bash
# Create virtual environment
python -m venv .venv
source .venv/bin/activate  # On Windows: .venv\Scripts\activate

# Install dependencies
pip install -r backend/requirements.txt

# Ingest knowledge corpora and build FAISS vector indexes
python scripts/ingest_corpus.py

# Start FastAPI server (defaults to local SQLite if Postgres is not configured)
uvicorn backend.app.main:app --reload --port 8000
```

#### 2. Frontend Setup (Node 18+)

```bash
cd frontend
npm install
npm run dev
```

Visit `http://localhost:5173` in your browser.

---

## 5. Traceability & Source Grounding

Every question generated includes `source_chunk_ids` linked to exact textbook passages stored in FAISS.
- Click **"Inspect Source Chunks"** on any question card during the interview to inspect the exact passages, book titles, and section headers used to formulate the question.
- In the final results view, click **"View Grounded Textbook Chunks"** on any past Q&A pair to verify knowledge grounding.

---

## 6. Running Test Suite

Run unit and integration tests covering RAG chunking, resume parsing, LangGraph state transitions, and API endpoints:

```bash
python -m pytest backend/tests/ -v
```

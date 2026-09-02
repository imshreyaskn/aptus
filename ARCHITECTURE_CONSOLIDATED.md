# Aptus Interview Engine — Consolidated Architecture

This document describes the redesigned interview engine following the consolidated specification. The key principle is **one reasoning engine, two thin adapters** — voice and text both produce a `Turn`, and the graph never knows which modality produced it.

## Core Changes from Previous Draft

### 1. Unified Turn Object

Both voice and text modalities now produce identical `Turn` objects:

```python
class Turn(TypedDict, total=False):
    turn_id: str
    modality: Literal["voice", "text"]
    normalized_text: str  # Transcript or typed text
    asr_confidence: float  # STT confidence (voice); 1.0 for text
    interruption_flag: bool  # True if arrived while agent was speaking
```

**Cut from previous draft:**
- `stt_segments`, `language`, `audio_duration_ms`, `latency_ms` — these are observability fields, not state. Add later against real metrics needs, not speculatively.

### 2. Simplified State Schema

The state schema is organized by causal category:

| Category | Variables |
|---|---|
| Context (pre-seeded) | `candidate_name`, `resume_summary`, `role_context`, `session_id` |
| Conversation | `message_history`, `current_topic`, `topics_covered`, `turn_count`, `current_phase` |
| Evaluation | `answer_quality`, `evaluation_confidence`, `candidate_confidence`, `hedging_detected`, `question_quality_flag`, `contradicts_resume_flag` |
| Escalation (per topic) | `difficulty_level`, `consecutive_strong`, `consecutive_weak`, `topic_sub_state` |
| Uncertainty | `uncertainty_type`, `unresolved_retry_count` |
| Delivery | `question_delivery_state`, `agent_speaking_flag` |
| Insight | `insight_buffer: list of {topic, claim, evidence, observation}` |

**Key changes:**
- `contradicts_resume` is only an Evaluation field now, not also a member of `uncertainty_type` — it's logged, never resolved live, so it doesn't gate turn progression.
- Dropped `checkpoint_version` / `last_stable_phase` — LangGraph's own checkpointer makes these redundant.

### 3. Merged Classification + Evaluation

**Biggest structural change:** Turn classification and answer evaluation are now **one LLM call**, not two.

Whether a turn is an answer, a meta-question, a repeat-request, or an early-answer-to-an-interrupted-question all get decided in the same call that would've evaluated the answer anyway. The model outputs `turn_type` as the first field, and only fills in evaluation fields when `turn_type = answer`.

**Benefits:**
- Removes a full LLM round trip from the critical latency path
- Collapses three nodes into one (`turn_director`, `classify_turn`, `judge_answer` → single `CLASSIFY_AND_EVALUATE`)

### 4. Explicit Idle Timeout

`WAIT_FOR_TURN` now has a real exit for "no submission at all," routed straight into `CLARIFY_UNCERTAIN` with `uncertainty_type = silence_timeout`. This was undocumented behavior in the previous draft.

### 5. HANDLE_INTERRUPTION Folded In

`HANDLE_INTERRUPTION` as a separate top-level state is gone. If `interruption_flag` is true, `CLASSIFY_AND_EVALUATE` just gets that as extra context (was the question fully delivered or not) and it factors into `turn_type` the same way meta-question detection does.

**Result:** One fewer state, same behavior, less to keep in sync.

## State Machine Topology

```
INIT → OPENING → QUESTION_DELIVERY → WAIT_FOR_TURN → CLASSIFY_AND_EVALUATE
                                                        ↓
                          ┌──────────────┬──────────────┼──────────────┐
                          ↓              ↓              ↓              ↓
                    meta_question   answer+unclear   answer+clean   idle_timeout
                          ↓              ↓              ↓              ↓
                    WAIT_FOR_TURN  CLARIFY_UNCERTAIN  ESCALATE_PIVOT  CLARIFY_UNCERTAIN
                                                        ↓
                                              COVERAGE_CHECK
                                                    ↓
                                    ┌───────────────┴───────────────┐
                                    ↓                               ↓
                              TOPIC_SELECT                       WRAPUP
                                    ↓                               ↓
                            QUESTION_DELIVERY              INSIGHT_GENERATION
                                                                 ↓
                                                               CLOSED
```

### State Descriptions

| State | Entry | What happens | Exit |
|---|---|---|---|
| **INIT** | Session start | Load pre-seeded context | → OPENING |
| **OPENING** | INIT done | Grounded greeting + first resume-based question | → QUESTION_DELIVERY |
| **TOPIC_SELECT** | Continue signal | Pick next topic from role_context gaps | → QUESTION_DELIVERY |
| **QUESTION_DELIVERY** | Topic chosen | Deliver via text or TTS; set `agent_speaking_flag` | → WAIT_FOR_TURN |
| **WAIT_FOR_TURN** | Question delivered | Wait for button-release/STT or text submit. Also watches idle timer. | → CLASSIFY_AND_EVALUATE, or → CLARIFY_UNCERTAIN (idle_timeout) |
| **CLASSIFY_AND_EVALUATE** | Turn received | Single call: classify turn_type; if answer, also score it and set uncertainty_type if needed | → per branch below |
| — meta_question / repeat_request | | Short direct response, question stays active | → WAIT_FOR_TURN |
| — answer, uncertainty_type ≠ none | | | → CLARIFY_UNCERTAIN |
| — answer, clean | | | → ESCALATE_PIVOT |
| **CLARIFY_UNCERTAIN** | Flagged uncertainty | Resolve per §5 | → WAIT_FOR_TURN (retry) or → ESCALATE_PIVOT (resolved) |
| **ESCALATE_PIVOT** | Answer scored | Update difficulty/topic sub-state | → COVERAGE_CHECK |
| **COVERAGE_CHECK** | Post-cycle | Compare coverage + elapsed time to thresholds | → TOPIC_SELECT or → WRAPUP |
| **WRAPUP** | Sufficient coverage / time ceiling | Explicit close cue, invite questions | → INSIGHT_GENERATION |
| **INSIGHT_GENERATION** | Wrapup done | Structured report from insight_buffer | → CLOSED |
| **ERROR_RECOVERY** | Any recoverable failure | Reload from checkpoint | → last stable state |
| **CLOSED** | Report generated | End | — |

## Interaction Model

### Voice: Push-to-Talk

- **Button press** → start recording (stop TTS if playing — manual interrupt)
- **Button release** → stop recording → STT via Groq → Turn
- **No VAD needed** — the button solves endpointing

### Text: Type-and-Submit

- **Type** → **Submit** → Turn
- **No interrupt mechanism** — text rendering is near-instantaneous, so there's no meaningful window where a candidate is "interrupting" a still-arriving response

**Design decision:** Text-side TTS-style interruption handling is deliberately not built. If you later add token-by-token streaming for text with a visibly slow render, revisit this — for now, treating text output as atomic avoids building an interrupt mechanism for a problem that doesn't exist yet.

## Voice/Text Adapters

Located in `backend/app/adapters/modality.py`:

### TextAdapter
```python
adapter = TextAdapter()
turn = adapter.submit_turn(text="I think regularization prevents overfitting...", session_id="sess_123")
response = adapter.render_response(text="Good point about regularization.")
```

### VoiceAdapter
```python
adapter = VoiceAdapter()

# User presses button
adapter.start_recording(session_id="sess_123")

# Audio chunks arrive during recording
adapter.append_audio(audio_chunk_1)
adapter.append_audio(audio_chunk_2)

# User releases button
turn = adapter.stop_recording_and_transcribe(session_id="sess_123", language="en")

# Agent responds via TTS
audio_response = adapter.speak_response(text="Good point about regularization.", language_code="en-US")
```

## External Services

### Groq STT (Free Tier)
- **Model:** `whisper-large-v3-turbo`
- **API:** `client.audio.transcriptions.create()`
- **Output:** text, confidence, segments
- **Config:** `GROQ_API_KEY` environment variable

### Google Cloud TTS (Free Tier Standard Voice)
- **Voice:** `en-US-Standard-A` (standard voice, free tier)
- **Output:** MP3 audio bytes
- **Config:** `GOOGLE_CLOUD_CREDENTIALS` environment variable (service account JSON)

### Gemini LLM (Reasoning Engine)
- **Model:** `gemini-2.0-flash-exp` (or fallback to `gemini-1.5-flash`)
- **Purpose:** Structured JSON output for turn classification + evaluation
- **Config:** `GEMINI_API_KEY` environment variable

## Persistence — Simplified

**Previous draft:** Three separate stores (checkpoint store, transcript store, insight buffer store)

**Consolidated:** **LangGraph's own checkpointer** (Postgres-backed). 

`message_history` and `insight_buffer` already live in graph state, so checkpointing the state is checkpointing the transcript and the evidence trail simultaneously. A reconnect just reloads the checkpoint and resumes at `current_phase`.

Building three separate persistence systems for one team-scale interview tool is premature architecture.

## Phased Build Plan

### Phase 1: Skeleton, Text-Only, Stubbed Calls
- Full graph topology including merged `CLASSIFY_AND_EVALUATE` node
- Deterministic fake scoring
- Escalation and coverage logic validated end-to-end with no LLM cost

### Phase 2: Real Reasoning, Still Text-Only
- Swap in real LLM calls: classify+evaluate, question planning grounded in role_context
- Escalation, uncertainty handling, insight generation
- This is where actual interview intelligence gets proven, while iteration is cheap

### Phase 3: Voice Adapter
- Push-to-talk record → STT → Turn
- TTS output via Google Cloud
- Manual interrupt (button stops TTS)
- No VAD, no endpointing logic — the button already solved that

### Phase 4: Hardening
- LangGraph checkpointing for reconnect
- Latency budget measurement per segment
- Adversarial/prompt-injection testing
- RAG relevance validation before question generation

**Note:** Mixed-initiative handling (meta-question, repeat-request) isn't a separate late phase anymore — it's built into `CLASSIFY_AND_EVALUATE` from phase 1, since it was always going to be part of that same call. That's a phase removed for free by the merge.

## What Got Cut, and Why

| Cut Item | Reason |
|---|---|
| **Autonomous VAD/endpointing** | Replaced by push-to-talk; this was the single biggest complexity source and the button removes it entirely |
| **Separate turn-classification LLM call** | Merged into evaluation; halves the latency-critical LLM calls per turn |
| **Three persistence stores** | Collapsed into one LangGraph checkpointer |
| **Text-side TTS-style interruption handling** | Not needed, text render has no meaningful duration to interrupt |
| **Optional Turn metadata** (stt_segments, language, audio_duration_ms) | Deferred until a concrete need shows up |
| **HANDLE_INTERRUPTION as distinct top-level state** | Folded into normal turn classification via `interruption_flag` |

## What Stays (Genuinely Worth the Complexity)

| Feature | Why It Stays |
|---|---|
| **Four-way confidence split** (asr/evaluation/candidate/answer_quality) | These really are causally different signals |
| **Consecutive-count escalation with question-quality gating** | Prevents badly-phrased questions from being scored as candidate weakness |
| **Evidence-linked insight generation** | Makes the final report defensible instead of a plausible-sounding guess |

These aren't decoration — they're what makes the difficulty curve stable and the final report actionable.

## Quick Start

### Environment Setup

```bash
# .env file
GEMINI_API_KEY=your_gemini_key_here
GROQ_API_KEY=your_groq_key_here  # Get free key at https://console.groq.com
GOOGLE_CLOUD_CREDENTIALS='{"type":"service_account",...}'  # Service account JSON for TTS
```

### Install Dependencies

```bash
cd backend
pip install -r requirements.txt
```

New dependencies:
- `groq>=0.9.0` — Groq SDK for STT
- `google-cloud-texttospeech>=2.20.0` — Google Cloud TTS

### Test Imports

```python
from backend.app.graph.state import Turn, InterviewState
from backend.app.adapters.modality import TextAdapter, VoiceAdapter
from backend.app.core.gemini import transcribe_audio_groq, synthesize_speech_google

# Test text adapter
text_adapter = TextAdapter()
turn = text_adapter.submit_turn("Regularization prevents overfitting", "test_session")
print(turn)

# Test voice adapter (requires GROQ_API_KEY)
voice_adapter = VoiceAdapter()
voice_adapter.start_recording("test_session")
# ... append audio ...
# turn = voice_adapter.stop_recording_and_transcribe("test_session")
```

## Next Steps

1. **Implement CLASSIFY_AND_EVALUATE node** — merge turn_director + judge_answer logic into single LLM call
2. **Add idle timeout watcher** — explicit edge from WAIT_FOR_TURN to CLARIFY_UNCERTAIN
3. **Wire LangGraph checkpointer** — use Postgres-backed MemorySaver or equivalent
4. **Build frontend push-to-talk UI** — button that triggers VoiceAdapter methods
5. **Test end-to-end with stubbed LLM** — validate state transitions before adding real LLM cost

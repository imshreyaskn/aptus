# Aptus Frontend

A focused, push-to-talk AI technical screening client.

## Product contract

Aptus intentionally does **not** behave like a continuous realtime voice assistant.

The interaction model is:

1. Interviewer speaks with cloud TTS.
2. Candidate explicitly activates Voice.
3. Candidate speaks.
4. Candidate presses **Stop & send**.
5. Recorded audio goes to the backend STT service.
6. The authoritative transcript is submitted to the interview engine.
7. The next interviewer action is spoken with TTS.

Pressing Voice while the interviewer is speaking is the explicit interruption gesture. It stops playback and starts a new recording.

## Architecture

```text
React UI
   │
   ▼
useInterviewAgent
   │
   ▼
InterviewAgent runtime
   ├── InterviewStateMachine
   ├── VoiceListener  ──► MediaRecorder ──► backend STT
   └── speaker         ──► backend TTS
             │
             ▼
       onSubmitAnswer
             │
             ▼
        FastAPI interview API
```

React owns presentation. `InterviewAgent` owns interaction lifecycle. The backend remains authoritative for evaluation and next-question generation.

## Engineering rules

- No API keys in frontend code.
- No autonomous VAD.
- No automatic microphone restarts.
- Server STT is authoritative.
- Every mutable interview submission has a cancellation boundary.
- One long-lived agent instance per interview screen.
- React callbacks flow through refs so rerenders do not replace the runtime.
- TTS cancellation resolves pending promises and invalidates stale playback generations.
- Pure state-machine behavior is unit tested.
- Accessibility uses semantic controls and `:focus-visible` rather than visual rewrites.

## Development

```bash
npm install
npm run dev
npm test
npm run lint
npm run build
```

The existing UI design was intentionally retained: editorial typography, ivory/obsidian palette, glass surfaces, restrained motion, and the chat-first interview room.

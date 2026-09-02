# Aptus Frontend — World-Class Refactor Audit

## Scope

Refactored from the supplied combined frontend source bundle:
`frontend_combined(1).txt`.

The product's original design philosophy is intentionally preserved:
- editorial / restrained visual language
- ivory + obsidian palette
- glass surfaces
- chat-first interview room
- push-to-talk voice interaction
- backend-driven interview evaluation
- text as a first-class fallback

No framework rewrite was introduced.

## Core behavior contract

The voice experience is explicitly push-to-talk:

`Agent TTS -> idle -> user presses Voice -> recording -> user presses Stop & send -> server STT -> interview API -> next action -> TTS`

Important decisions:
- no automatic VAD
- no silence-based auto-submit
- no automatic microphone restarts
- browser SpeechRecognition is preview-only
- backend STT is authoritative
- pressing Voice during interviewer TTS is the interruption gesture
- all mutable answer submission has an abort/stale-result boundary
- the React hook owns one long-lived InterviewAgent instance

## Major fixes

### 1. Voice state ownership
Replaced loosely coupled boolean behavior with an explicit state machine:
`IDLE -> PLANNING -> SPEAKING -> AWAITING_RESPONSE -> PROCESSING -> ...`

Invalid transitions now throw immediately during development instead of silently continuing.

### 2. Push-to-talk correctness
`VoiceListener.stop()` now:
- waits for MediaRecorder finalization
- builds one final audio blob
- sends it to backend STT
- uses the server transcript as authoritative
- only falls back to the browser preview transcript when server STT fails
- never restarts the microphone automatically

### 3. TTS cancellation
The TTS controller now uses playback generations:
- interrupting speech invalidates the current generation
- pending queued speech is resolved
- current Web Audio playback is stopped
- HTMLAudio fallback is supported
- stale synthesis responses cannot restart old speech

### 4. Async race protection
Interview submissions use monotonically increasing submission IDs plus AbortController.
An old network result can no longer overwrite a later interaction.

### 5. React lifecycle
`useInterviewAgent` creates the runtime once.
Changing `currentQuestion` updates the existing runtime instead of replacing/destroying the agent.

Callbacks are kept in refs so React rerenders do not leave stale callback closures inside the long-lived runtime.

### 6. API boundary
`api.js` now centralizes:
- response parsing
- API error normalization
- request timeout
- GET-only retry behavior
- safe path encoding
- validation of mutable inputs

Mutation endpoints are intentionally never automatically retried.

### 7. Accessibility
Added:
- semantic labels for interview controls
- `:focus-visible`
- reduced-motion handling
- mobile viewport treatment
- less accidental click behavior

The original visual design was not rewritten.

### 8. Results correctness
Syllabus completion is now based on distinct covered topics rather than treating topic count as question count.

## Code-quality additions

- ESLint 9 configuration
- Vitest setup through package scripts
- deterministic unit tests for the interview state machine
- deterministic tests for plan generation
- architecture README
- Docker health through a predictable SPA nginx fallback
- `.dockerignore`

## Intentional non-changes

The following were deliberately not introduced:
- WebSockets
- LiveKit
- automatic endpointing
- continuous microphone capture
- complex realtime event buses
- Redux/Zustand
- a TypeScript migration
- component-library replacement
- a complete visual redesign

These would increase implementation surface without improving the product's current interaction model enough to justify the complexity.

## Verification

Passed:
- JavaScript syntax checks for the refactored runtime/API modules
- local import-target consistency check

Not completed in this environment:
- full Vite production build
- Vitest execution
- ESLint execution

`npm install` could not complete within the execution window, so those tool-dependent checks were not falsely reported as passing.

## Remaining backend boundary

The supplied frontend expects these backend contracts to remain authoritative:
- `/sessions/start`
- `/sessions/{id}/next-question`
- `/sessions/{id}/answer`
- `/sessions/{id}/end`
- `/sessions/{id}/summary`
- `/sessions/{id}/history`
- `/tts`
- `/stt`

The backend source was not part of this uploaded frontend artifact, so backend internals were not rewritten here.

## Security reminder

Any API credential previously committed in the older backend/config bundle must be rotated separately. Removing the credential from source does not invalidate an already exposed secret.

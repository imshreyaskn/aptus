// frontend/src/voice/interviewAgent.js
// Production-grade 12-state interview agent architecture for technical screening.
// Pure JS class — no React dependencies. Wired to React via useInterviewAgent.js

import { speakText, stopAudio } from './speaker';
import { VoiceListener } from './listener';

// ─── State Definitions ────────────────────────────────────────────────────────

export const S = {
  IDLE:                'IDLE',
  PLANNING_INTERVIEW:  'PLANNING_INTERVIEW',
  SPEAKING:            'SPEAKING',
  AWAITING_RESPONSE:   'AWAITING_RESPONSE',
  INTERRUPTED:         'INTERRUPTED',
  PROCESSING:          'PROCESSING',
  CLARIFYING:          'CLARIFYING',
  RECOVERING:          'RECOVERING',
  WRAPPING_UP:         'WRAPPING_UP',
  COMPLETE:            'COMPLETE',
  ERROR:               'ERROR',
  PAUSED:              'PAUSED',
};

const TRANSITIONS = {
  [S.IDLE]:               [S.PROCESSING, S.PLANNING_INTERVIEW, S.AWAITING_RESPONSE, S.WRAPPING_UP, S.IDLE],
  [S.PLANNING_INTERVIEW]: [S.SPEAKING, S.WRAPPING_UP, S.ERROR, S.IDLE],
  [S.SPEAKING]:           [S.PROCESSING, S.AWAITING_RESPONSE, S.INTERRUPTED, S.WRAPPING_UP, S.ERROR, S.PAUSED, S.IDLE],
  [S.AWAITING_RESPONSE]:  [S.PROCESSING, S.CLARIFYING, S.SPEAKING, S.WRAPPING_UP, S.PAUSED, S.ERROR, S.IDLE],
  [S.INTERRUPTED]:        [S.PROCESSING, S.AWAITING_RESPONSE, S.WRAPPING_UP, S.IDLE],
  [S.PROCESSING]:         [S.SPEAKING, S.WRAPPING_UP, S.RECOVERING, S.ERROR, S.AWAITING_RESPONSE],
  [S.CLARIFYING]:         [S.PROCESSING, S.SPEAKING, S.AWAITING_RESPONSE, S.WRAPPING_UP, S.IDLE],
  [S.RECOVERING]:         [S.PROCESSING, S.SPEAKING, S.AWAITING_RESPONSE, S.WRAPPING_UP, S.IDLE],
  [S.WRAPPING_UP]:        [S.COMPLETE, S.SPEAKING],
  [S.COMPLETE]:           [S.IDLE],
  [S.ERROR]:              [S.PROCESSING, S.RECOVERING, S.AWAITING_RESPONSE, S.WRAPPING_UP, S.IDLE],
  [S.PAUSED]:             [S.PROCESSING, S.SPEAKING, S.AWAITING_RESPONSE, S.WRAPPING_UP, S.IDLE],
};

const RESPONSE_TIMEOUT_MS = 90_000; // 90s — candidate given generous time
const MAX_LOG = 30;
const MAX_LISTENER_RESTARTS = 5;
const SILENCE_TIMEOUT_MS = 2800;
const POST_TTS_GUARD_MS = 300; // Delay before opening mic to prevent acoustic echo feedback

// ─── State Machine ────────────────────────────────────────────────────────────

class StateMachine {
  constructor() {
    this._current = { state: S.IDLE, message: 'Ready', timestamp: Date.now() };
    this._log = [];
    this._waitTimer = null;

    // Hooks
    this.onChange = null;      // (snapshot) => void
    this.onExitBusy = null;    // () => void — called when leaving SPEAKING/PROCESSING
    this.onWaitTimeout = null; // () => void — called when AWAITING_RESPONSE times out
  }

  get state() { return this._current.state; }
  get current() { return this._current; }
  get log() { return this._log; }

  transition(to, message = '', extra = {}) {
    const from = this._current.state;

    // Self-transition: just update message, no hooks
    if (from === to && to !== S.IDLE) {
      if (message) {
        this._current = { ...this._current, message, timestamp: Date.now(), ...extra };
        this.onChange?.(this._current);
      }
      return this._current;
    }

    const allowed = TRANSITIONS[from] || [];
    if (!allowed.includes(to)) {
      console.warn(`[InterviewAgent FSM] Invalid transition: ${from} → ${to}. Allowed: [${allowed.join(', ')}]`);
      return null;
    }

    // Exit-busy hook: leaving SPEAKING or PROCESSING
    if ((from === S.SPEAKING || from === S.PROCESSING) && to !== S.SPEAKING && to !== S.PROCESSING) {
      this.onExitBusy?.();
    }

    // Clear response timeout when leaving AWAITING_RESPONSE
    if (from === S.AWAITING_RESPONSE) {
      this._clearWaitTimer();
    }

    this._log.push({ from, to, message, timestamp: Date.now() });
    if (this._log.length > MAX_LOG) this._log.shift();

    this._current = { state: to, message: message || to, timestamp: Date.now(), ...extra };
    this.onChange?.(this._current);

    // Start response timeout on AWAITING_RESPONSE
    if (to === S.AWAITING_RESPONSE) {
      this._startWaitTimer();
    }

    return this._current;
  }

  reset(message = 'Reset') {
    this._clearWaitTimer();
    this._current = { state: S.IDLE, message, timestamp: Date.now() };
    this.onChange?.(this._current);
  }

  _startWaitTimer() {
    this._clearWaitTimer();
    this._waitTimer = setTimeout(() => {
      if (this.state === S.AWAITING_RESPONSE) {
        this.onWaitTimeout?.();
      }
    }, RESPONSE_TIMEOUT_MS);
  }

  _clearWaitTimer() {
    if (this._waitTimer) {
      clearTimeout(this._waitTimer);
      this._waitTimer = null;
    }
  }
}

// ─── Plan Synthesizer ─────────────────────────────────────────────────────────

export function synthesizeInterviewPlan(session, candidateName, role, resumeText = '') {
  const name = candidateName || session?.candidate_name || 'there';
  const topics = session?.topics_planned || [];

  // Build todos from planned topics
  const todos = topics.map((t, i) => {
    const areaName = typeof t === 'string' ? t : (t.topic || `Topic ${i + 1}`);
    const reasoning = typeof t === 'object' && t.reasoning ? t.reasoning : `Assess candidate depth in ${areaName}`;
    return {
      id: `t${i}`,
      area: areaName,
      intent: reasoning,
      status: 'pending',      // 'pending' | 'covered' | 'skipped'
      priority: i < 2 ? 'high' : 'medium',
      attempts: 0,
    };
  });

  const resumeSnippet = resumeText ? ` I've reviewed your background.` : '';

  return {
    candidateName: name,
    role,
    greeting: `Hi ${name}, welcome to your ${role} screening interview.${resumeSnippet} We'll have a technical discussion covering your background and core engineering principles. Ready to begin?`,
    todos,
    closing: `Thank you so much for your time today, ${name}. That concludes our screening session. We are compiling your performance evaluation now.`,
    resumeContext: resumeText.slice(0, 800),
  };
}

// ─── Main Agent Class ─────────────────────────────────────────────────────────

export class InterviewAgent {
  constructor({ session, candidateName, role, resumeText, currentQuestion, onSubmitAnswer, onComplete }) {
    this.machine = new StateMachine();
    this.session = session;
    this.candidateName = candidateName;
    this.role = role;
    this.resumeText = resumeText;
    this.currentQuestion = currentQuestion || null;
    this._onSubmitAnswer = onSubmitAnswer;   // (questionId, answerText) => Promise<result>
    this._onComplete = onComplete;           // () => void

    this.plan = null;
    this.conversationHistory = [];  // [{ role: 'interviewer'|'candidate', text, timestamp }]
    this.abortController = null;
    this.listenerRestarts = 0;
    this.isSubmitting = false;
    this._destroyed = false;
    this._submissionToken = 0;

    // Listener instance (single, reused)
    this.listener = new VoiceListener({ autoVAD: false, continuous: false, interimResults: true });
    this._wireListener();

    // Machine hooks
    this.machine.onExitBusy = () => {
      stopAudio();
    };

    this.machine.onWaitTimeout = async () => {
      // Candidate silent for 90s — gentle prompt
      await this._speakAndTransition(
        'Just checking in — take your time. Would you like me to clarify the question, or would you like to continue?',
        S.AWAITING_RESPONSE,
        'Still listening...'
      );
    };

    // Public callbacks (wired by hook)
    this.onChange = null;        // (snapshot) => void
    this.onPlanChange = null;    // (plan) => void
    this.onHistoryChange = null; // (history) => void
    this.onVolume = null;        // (level: 0-1) => void
    this.onLiveTranscript = null; // (text) => void
    this.onError = null;         // (msg) => void
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  get state() { return this.machine.state; }
  get snapshot() { return this.machine.current; }
  get isSupported() { return VoiceListener.isSupported(); }
  get isListening() { return Boolean(this.listener?.isRecording); }

  /** Kick off the interview. Call once after mount. */
  async start() {
    if (this.machine.state !== S.IDLE) return;
    this.machine.onChange = (snap) => this.onChange?.(snap);

    this.machine.transition(S.PLANNING_INTERVIEW, 'Preparing your interview...');

    try {
      this.plan = synthesizeInterviewPlan(this.session, this.candidateName, this.role, this.resumeText);
      this.onPlanChange?.(this.plan);
    } catch (err) {
      console.error('[InterviewAgent] Plan synthesis failed:', err);
      this.plan = {
        candidateName: this.candidateName || 'there',
        role: this.role,
        greeting: `Hi, welcome to your ${this.role} interview. Let's get started.`,
        todos: (this.session?.topics_planned || []).map((t, i) => ({
          id: `t${i}`, area: t.topic || t, intent: '', status: 'pending', priority: 'medium', attempts: 0,
        })),
        closing: 'Thank you for your time today. We will be in touch.',
        resumeContext: '',
      };
      this.onPlanChange?.(this.plan);
    }

    const firstQText = this.currentQuestion?.question_text || this.currentQuestion?.question;
    if (firstQText) {
      await this._addToHistory('interviewer', firstQText);
      this.machine.transition(S.SPEAKING, 'Asking first question...');
      await this._safeSpeak(firstQText);
    } else {
      await this._addToHistory('interviewer', this.plan.greeting);
      this.machine.transition(S.SPEAKING, 'Greeting candidate...');
      await this._safeSpeak(this.plan.greeting);
    }

    if (this.machine.state === S.SPEAKING) {
      await this._finishSpeaking();
    }
  }

  /** Handle a completed user utterance (from VAD or manual submit). */
  async handleUserInput(text) {
    const trimmed = text?.trim();
    if (!trimmed) return;
    if (this.isSubmitting || this._destroyed || this.machine.state === S.COMPLETE || this.machine.state === S.WRAPPING_UP) return;
    this.isSubmitting = true;
    const submissionToken = ++this._submissionToken;

    // Immediately stop any TTS audio playing right now
    stopAudio();

    // Pure server-driven turn processing: AI Turn Director determines stay, advance, or conclude
    await this._processUserAnswer(trimmed);
  }

  async submitText(text) {
    await this.handleUserInput(text);
  }

  /** Manual mic toggle from UI button. Mic only listens when candidate explicitly activates it. */
  async toggleMic() {
    if (this.isListening) {
      // Button release ends the recording. Await backend STT before submitting.
      const captured = await this._stopListening();
      if (captured?.trim()) {
        await this.handleUserInput(captured.trim());
      } else {
        this.machine.transition(S.AWAITING_RESPONSE, 'Ready for your answer (Type or tap Voice)...');
      }
      return;
    }

    // Button press starts push-to-talk. If TTS is active, this is a manual interrupt.
    stopAudio();
    await this._stopListening();
    await this._startListening();
  }

  /** Interrupt the speaking agent (user tapped orb or pressed key). */
  async interrupt() {
    stopAudio();
    this._stopListening();
    this.machine.transition(S.AWAITING_RESPONSE, 'Listening to your response...');
    await this._startListening();
  }

  /** Manual pause/resume toggle. */
  async togglePause() {
    if (this.machine.state === S.PAUSED) {
      await this._resumeFromPause();
    } else {
      stopAudio();
      this._stopListening();
      this.machine.transition(S.PAUSED, 'Interview paused');
    }
  }

  /** Called by App when a new question arrives from backend. */
  setCurrentQuestion(question) {
    this.currentQuestion = question;
  }

  /** Force-end the interview immediately — used by UI button and "end interview" intent. */
  async forceEnd() {
    const st = this.machine.state;
    if (st === S.COMPLETE || st === S.WRAPPING_UP) return;
    stopAudio();
    this._stopListening();
    this.abortController?.abort();
    ++this._submissionToken;
    this.isSubmitting = false;
    await this._wrapUp();
  }

  /** Tear down cleanly — call on unmount. */
  destroy() {
    stopAudio();
    this._stopListening();
    this._destroyed = true;
    ++this._submissionToken;
    this.machine.reset('Agent destroyed');
    this.abortController?.abort();
  }

  // ── Internal ─────────────────────────────────────────────────────────────────

  _wireListener() {
    this.listener.onVolume = (vol) => this.onVolume?.(vol);
    this.listener.onInterim = (text) => this.onLiveTranscript?.(text);
    this.listener.onFinal = (text) => this.onLiveTranscript?.(text);

    this.listener.onSilence = async (fullText) => {
      if (
        this.machine.state === S.AWAITING_RESPONSE ||
        this.machine.state === S.CLARIFYING ||
        this.machine.state === S.INTERRUPTED
      ) {
        await this.handleUserInput(fullText);
      }
    };

    this.listener.onError = (err) => {
      const code = err?.error || err?.message || String(err);
      if (code === 'not-allowed') {
        this.machine.transition(S.ERROR, 'Microphone permission denied.');
        this.onError?.('Microphone access denied. You can still type your answers below.');
      } else if (code === 'Web Speech API is not supported in this browser.' || code?.includes?.('not supported')) {
        this.onError?.('Voice unavailable in this browser. Use text input below.');
      } else if (code !== 'no-speech') {
        console.warn('[InterviewAgent] Listener error:', code);
        this._handleListenerRestart();
      }
    };

    this.listener.onEnd = () => {
      this.onVolume?.(0);
      // Push-to-talk: stopping is intentional. Never auto-restart the mic.
    };
  }

  async _handleListenerRestart() {
    // Retained for compatibility with older callers. Push-to-talk never auto-restarts.
  }

  async _finishSpeaking() {
    // Safety delay to ensure TTS audio has finished rendering
    await new Promise(r => setTimeout(r, POST_TTS_GUARD_MS));
    if (this.machine.state === S.SPEAKING || this.machine.state === S.CLARIFYING || this.machine.state === S.RECOVERING) {
      this._stopListening();
      this.machine.transition(S.AWAITING_RESPONSE, 'Ready for your answer (Type or tap Voice)...');
    }
  }

  async _startListening() {
    this.listenerRestarts = 0;
    this.listener.resetTranscript();
    this.onLiveTranscript?.('');
    this.machine.transition(S.AWAITING_RESPONSE, 'Listening to your response...');
    try {
      await this.listener.start();
    } catch (err) {
      const isPermission = err?.message?.includes('Permission') || err?.name === 'NotAllowedError';
      if (isPermission) {
        this.machine.transition(S.ERROR, 'Microphone permission denied.');
        this.onError?.('Microphone access denied. You can still type your answers below.');
      } else {
        this.onError?.('Voice unavailable. Text input is active.');
      }
    }
  }

  async _stopListening() {
    try { return await this.listener.stop(); } catch (_) { return ''; }
    finally { this.onVolume?.(0); }
  }

  async _handleInterruption(text) {
    stopAudio();
    this._stopListening();
    this.machine.transition(S.INTERRUPTED, 'Interrupted. Listening...');
    this.listener.resetTranscript();
    this.onLiveTranscript?.('');

    if (text) {
      await this._processUserAnswer(text);
    } else {
      await this._startListening();
    }
  }

  async _resumeFromPause() {
    this.machine.transition(S.AWAITING_RESPONSE, 'Ready for your answer (Type or tap Voice)...');
    this.listener.resetTranscript();
    this.onLiveTranscript?.('');
    this._stopListening();
  }

  /** Core: take user's answer, evaluate, advance plan. */
  async _processUserAnswer(text) {
    this._stopListening();
    this.onLiveTranscript?.('');
    await this._addToHistory('candidate', text);

    const transitioned = this.machine.transition(S.PROCESSING, 'Evaluating your response...');
    if (!transitioned) {
      console.warn('[InterviewAgent] _processUserAnswer called from invalid state:', this.machine.state);
      this.isSubmitting = false;
      return;
    }

    this.abortController?.abort();
    const ac = new AbortController();
    this.abortController = ac;

    try {
      const result = await this._onSubmitAnswer(
        this.currentQuestion?.id,
        text,
        ac.signal
      );

      if (ac.signal.aborted || submissionToken !== this._submissionToken || this._destroyed) return;

      if (result?.action === 'stay') {
        const reply = result.interviewer_reply || "Whenever you're ready, let me know your thoughts on this topic.";
        await this._addToHistory('interviewer', reply);
        this.machine.transition(S.SPEAKING, 'Interviewer replying...');
        await this._safeSpeak(reply);
        if (this.machine.state === S.SPEAKING) {
          await this._finishSpeaking();
        }
        return;
      }

      if (result?.action === 'conclude' || result?.is_session_completed) {
        await this._wrapUp();
        return;
      }

      this._syncTopicCoverage(result?.progress?.topic_coverage, this.currentQuestion?.topic);

      if (result?.next_question) {
        this.currentQuestion = result.next_question;
        await this._speakNextQuestion(result);
      } else {
        await this._safeRecover('Got an unexpected response from the server. Let me continue.');
      }
    } catch (err) {
      if (ac.signal.aborted) return;
      console.error('[InterviewAgent] Submit answer failed:', err);
      this.machine.transition(S.RECOVERING, 'Network error. Retrying...');
      await this._safeSpeak('I had a connection issue. Let me repeat the question.');
      await this._repeatCurrentQuestion();
    } finally {
      this.isSubmitting = false;
    }
  }

  async _speakNextQuestion(result) {
    const nextQ = result.next_question;
    const questionText = nextQ.question_text || nextQ.question || '';

    await this._addToHistory('interviewer', questionText);
    this.machine.transition(S.SPEAKING, 'Asking next question...');
    await this._safeSpeak(questionText);

    if (this.machine.state === S.SPEAKING) {
      await this._finishSpeaking();
    }
  }

  async _speakQuestion(question) {
    if (!question) return;
    const text = question.question_text || question.question || '';
    await this._addToHistory('interviewer', text);
    this.machine.transition(S.SPEAKING, 'Asking question...');
    await this._safeSpeak(text);
    if (this.machine.state === S.SPEAKING) {
      await this._finishSpeaking();
    }
  }

  async _repeatCurrentQuestion() {
    if (!this.currentQuestion) return;
    const text = this.currentQuestion.question_text || this.currentQuestion.question || '';
    this.machine.transition(S.SPEAKING, 'Repeating the question...');
    await this._safeSpeak(text);
    if (this.machine.state === S.SPEAKING) {
      await this._finishSpeaking();
    }
  }

  async _wrapUp() {
    this.machine.transition(S.WRAPPING_UP, 'Wrapping up interview...');
    const closingText = this.plan?.closing || `Thank you so much for your time today, ${this.candidateName || 'there'}. That wraps up our screening. We are synthesizing your detailed evaluation report.`;
    await this._addToHistory('interviewer', closingText);
    await this._safeSpeak(closingText);
    this.machine.transition(S.COMPLETE, 'Interview complete');
    setTimeout(() => {
      this._onComplete?.();
    }, 800);
  }

  async _safeSpeak(text) {
    try {
      await speakText(text);
    } catch (err) {
      console.warn('[InterviewAgent] TTS failed:', err);
    }
  }

  async _speakAndTransition(text, toState, message) {
    this.machine.transition(S.SPEAKING, 'Speaking...');
    await this._safeSpeak(text);
    if (this.machine.state === S.SPEAKING) {
      this.machine.transition(toState, message);
    }
  }

  async _safeRecover(message) {
    this.machine.transition(S.RECOVERING, message);
    await this._safeSpeak(message);
    await this._finishSpeaking();
  }

  async _addToHistory(role, text) {
    const entry = { role, text, timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) };
    this.conversationHistory.push(entry);
    this.onHistoryChange?.([...this.conversationHistory]);
  }

  _syncTopicCoverage(topicCoverage, fallbackTopic) {
    if (!this.plan || !this.plan.todos) return;

    if (topicCoverage && Object.keys(topicCoverage).length > 0) {
      for (const todo of this.plan.todos) {
        const areaNorm = todo.area.toLowerCase().trim();
        const matchedKey = Object.keys(topicCoverage).find(
          k => k.toLowerCase().trim() === areaNorm ||
               k.toLowerCase().trim().includes(areaNorm) ||
               areaNorm.includes(k.toLowerCase().trim())
        );
        if (matchedKey) {
          const entry = topicCoverage[matchedKey];
          if (entry.covered) {
            todo.status = 'covered';
          } else if (entry.attempts >= 2) {
            todo.status = 'reviewed';
          } else if (entry.attempts > 0) {
            todo.status = 'probing';
          }
          todo.attempts = entry.attempts || 0;
        }
      }
      this.onPlanChange?.({ ...this.plan, todos: [...this.plan.todos] });
      return;
    }

    this._markTodoCovered(fallbackTopic);
  }

  _markTodoCovered(topic) {
    if (!this.plan || !this.plan.todos) return;
    const cleanTopic = String(topic || '').toLowerCase().trim();
    
    // First, attempt to match the pending todo by topic name
    let todo = this.plan.todos.find(
      t => t.status === 'pending' && cleanTopic && (
        cleanTopic.includes(t.area.toLowerCase().trim()) ||
        t.area.toLowerCase().trim().includes(cleanTopic)
      )
    );

    // Fallback: match the first pending todo
    if (!todo) {
      todo = this.plan.todos.find(t => t.status === 'pending');
    }

    if (todo) {
      todo.status = 'covered';
      todo.attempts = (todo.attempts || 0) + 1;
      this.onPlanChange?.({ ...this.plan, todos: [...this.plan.todos] });
    }
  }
}

export default InterviewAgent;

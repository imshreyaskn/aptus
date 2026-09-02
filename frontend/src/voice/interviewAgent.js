import { speakText, stopAudio, primeAudio, isAudioPlaying } from './speaker';
import { VoiceListener } from './listener';

export const S = Object.freeze({
  IDLE: 'IDLE',
  PLANNING_INTERVIEW: 'PLANNING_INTERVIEW',
  SPEAKING: 'SPEAKING',
  AWAITING_RESPONSE: 'AWAITING_RESPONSE',
  INTERRUPTED: 'INTERRUPTED',
  PROCESSING: 'PROCESSING',
  RECOVERING: 'RECOVERING',
  WRAPPING_UP: 'WRAPPING_UP',
  COMPLETE: 'COMPLETE',
  ERROR: 'ERROR',
  PAUSED: 'PAUSED',
});

const TRANSITIONS = {
  [S.IDLE]: [S.PLANNING_INTERVIEW],
  [S.PLANNING_INTERVIEW]: [S.SPEAKING, S.ERROR],
  [S.SPEAKING]: [S.AWAITING_RESPONSE, S.INTERRUPTED, S.WRAPPING_UP, S.ERROR, S.PAUSED],
  [S.AWAITING_RESPONSE]: [S.PROCESSING, S.SPEAKING, S.INTERRUPTED, S.WRAPPING_UP, S.PAUSED, S.ERROR],
  [S.INTERRUPTED]: [S.AWAITING_RESPONSE, S.PROCESSING, S.SPEAKING],
  [S.PROCESSING]: [S.SPEAKING, S.WRAPPING_UP, S.RECOVERING, S.AWAITING_RESPONSE, S.ERROR],
  [S.RECOVERING]: [S.SPEAKING, S.AWAITING_RESPONSE, S.ERROR, S.WRAPPING_UP],
  [S.WRAPPING_UP]: [S.COMPLETE],
  [S.COMPLETE]: [],
  [S.ERROR]: [S.AWAITING_RESPONSE, S.RECOVERING, S.WRAPPING_UP],
  [S.PAUSED]: [S.AWAITING_RESPONSE, S.WRAPPING_UP],
};

const WAIT_TIMEOUT_MS = 90_000;
const POST_TTS_GUARD_MS = 250;

export class InterviewStateMachine {
  constructor() {
    this.state = S.IDLE;
    this.snapshot = { state: S.IDLE, message: 'Ready' };
    this._waitTimer = null;
    this.onChange = null;
    this.onWaitTimeout = null;
  }

  transition(next, message = next) {
    if (next === this.state) {
      this.snapshot = { ...this.snapshot, message, timestamp: Date.now() };
      this.onChange?.(this.snapshot);
      return this.snapshot;
    }

    if (!TRANSITIONS[this.state]?.includes(next)) {
      throw new Error(`Invalid interview transition: ${this.state} -> ${next}`);
    }

    if (this.state === S.AWAITING_RESPONSE) this._clearWaitTimer();

    this.state = next;
    this.snapshot = { state: next, message, timestamp: Date.now() };
    this.onChange?.(this.snapshot);

    if (next === S.AWAITING_RESPONSE) this._startWaitTimer();
    return this.snapshot;
  }

  reset() {
    this._clearWaitTimer();
    this.state = S.IDLE;
    this.snapshot = { state: S.IDLE, message: 'Ready', timestamp: Date.now() };
    this.onChange?.(this.snapshot);
  }

  destroy() {
    this._clearWaitTimer();
    this.onChange = null;
    this.onWaitTimeout = null;
  }

  _startWaitTimer() {
    this._clearWaitTimer();
    this._waitTimer = setTimeout(() => {
      if (this.state === S.AWAITING_RESPONSE) this.onWaitTimeout?.();
    }, WAIT_TIMEOUT_MS);
  }

  _clearWaitTimer() {
    if (!this._waitTimer) return;
    clearTimeout(this._waitTimer);
    this._waitTimer = null;
  }
}

export function synthesizeInterviewPlan(session, candidateName, role, resumeText = '') {
  const name = candidateName || session?.candidate_name || 'there';
  const topics = session?.topics_planned || [];

  return {
    candidateName: name,
    role,
    greeting: `Hi ${name}, welcome to your ${role} screening interview.${resumeText ? ' I have reviewed your background.' : ''} We will have a focused technical discussion across the relevant engineering areas. Ready to begin?`,
    todos: topics.map((topic, index) => {
      const area = typeof topic === 'string' ? topic : topic.topic || `Topic ${index + 1}`;
      return {
        id: `topic-${index}`,
        area,
        intent: typeof topic === 'object' && topic.reasoning
          ? topic.reasoning
          : `Assess candidate depth in ${area}`,
        status: 'pending',
        priority: index < 2 ? 'high' : 'medium',
        attempts: 0,
      };
    }),
    closing: `Thank you for your time today, ${name}. That concludes the screening session.`,
    resumeContext: resumeText.slice(0, 800),
  };
}

export class InterviewAgent {
  constructor({
    session,
    candidateName,
    role,
    resumeText = '',
    currentQuestion = null,
    onSubmitAnswer,
    onComplete,
  }) {
    this.session = session;
    this.candidateName = candidateName;
    this.role = role;
    this.resumeText = resumeText;
    this.currentQuestion = currentQuestion;
    this._onSubmitAnswer = onSubmitAnswer;
    this._onComplete = onComplete;

    this.machine = new InterviewStateMachine();
    this.listener = new VoiceListener();
    this.plan = null;
    this.conversationHistory = [];

    this._abortController = null;
    this._submissionId = 0;
    this._destroyed = false;
    this._completionTimer = null;

    this.onChange = null;
    this.onPlanChange = null;
    this.onHistoryChange = null;
    this.onVolume = null;
    this.onLiveTranscript = null;
    this.onError = null;

    this._bind();
  }

  get state() { return this.machine.state; }
  get snapshot() { return this.machine.snapshot; }
  get isSupported() { return VoiceListener.isSupported(); }
  get isListening() { return this.listener.isRecording; }
  get isSpeaking() { return this.state === S.SPEAKING && isAudioPlaying(); }
  get isProcessing() { return this.state === S.PROCESSING; }
  get isComplete() { return this.state === S.COMPLETE; }

  _bind() {
    this.machine.onChange = (snapshot) => this.onChange?.(snapshot);
    this.machine.onWaitTimeout = () => this._handleResponseTimeout();

    this.listener.onVolume = (value) => this.onVolume?.(value);
    this.listener.onInterim = (text) => this.onLiveTranscript?.(text);
    this.listener.onFinal = (text) => this.onLiveTranscript?.(text);
    this.listener.onError = (error) => {
      this.onError?.(error?.message || 'Voice input is unavailable right now.');
    };
    this.listener.onEnd = () => this.onVolume?.(0);
  }

  async start() {
    if (this._destroyed || this.state !== S.IDLE) return;

    try {
      await primeAudio();
      this.machine.transition(S.PLANNING_INTERVIEW, 'Preparing your interview…');
      this.plan = synthesizeInterviewPlan(
        this.session,
        this.candidateName,
        this.role,
        this.resumeText,
      );
      this.onPlanChange?.(this.plan);

      const firstQuestion = this.currentQuestion?.question_text || this.currentQuestion?.question;
      if (firstQuestion) {
        await this._deliverAgentMessage(firstQuestion, 'Asking first question…');
      } else {
        await this._deliverAgentMessage(this.plan.greeting, 'Greeting…');
      }
    } catch (error) {
      this._handleFatal(error);
      throw error;
    }
  }

  async toggleMic() {
    if (this._destroyed || this.state === S.COMPLETE || this.state === S.WRAPPING_UP || this.state === S.PROCESSING) {
      return;
    }

    // Pressing while speaking is the explicit interrupt gesture.
    if (this.state === S.SPEAKING) {
      stopAudio();
      this.machine.transition(S.INTERRUPTED, 'Listening…');
      await this._startListening();
      return;
    }

    if (this.listener.isRecording) {
      const text = await this._stopListening();
      if (text) await this.handleUserInput(text);
      else this.machine.transition(S.AWAITING_RESPONSE, 'Ready when you are…');
      return;
    }

    stopAudio();
    await this._startListening();
  }

  async submitText(text) {
    await this.handleUserInput(text);
  }

  async handleUserInput(text) {
    const normalized = text?.trim();
    if (!normalized || this._destroyed) return;
    if (this.state !== S.AWAITING_RESPONSE && this.state !== S.INTERRUPTED) return;

    const submissionId = ++this._submissionId;
    this._abortController?.abort();
    this._abortController = new AbortController();

    stopAudio();
    await this._stopListening();

    this._addHistory('candidate', normalized);
    this.machine.transition(S.PROCESSING, 'Evaluating your response…');

    try {
      const result = await this._onSubmitAnswer?.(
        this.currentQuestion?.id,
        normalized,
        this._abortController.signal,
      );

      if (this._destroyed || submissionId !== this._submissionId || this._abortController.signal.aborted) {
        return;
      }

      if (result?.action === 'stay') {
        const reply = result.interviewer_reply || 'Take your time. Walk me through your reasoning.';
        await this._deliverAgentMessage(reply, 'Interviewer responding…');
        return;
      }

      if (result?.action === 'conclude' || result?.is_session_completed) {
        await this._wrapUp();
        return;
      }

      if (result?.next_question) {
        this.currentQuestion = result.next_question;
        this._syncTopicCoverage(result.progress?.topic_coverage, this.currentQuestion?.topic);
        await this._deliverQuestion(result.next_question);
        return;
      }

      await this._recover('I did not receive the next question correctly. Let me recover and continue.');
    } catch (error) {
      if (this._destroyed || submissionId !== this._submissionId || error?.name === 'AbortError') return;
      await this._recover('I hit a connection issue. I will repeat the question.');
      await this._repeatCurrentQuestion();
    } finally {
      if (submissionId === this._submissionId) this._abortController = null;
    }
  }

  setCurrentQuestion(question) {
    this.currentQuestion = question;
  }

  async forceEnd() {
    if (this.state === S.COMPLETE || this.state === S.WRAPPING_UP) return;

    ++this._submissionId;
    this._abortController?.abort();
    stopAudio();
    await this._stopListening();

    await this._wrapUp();
  }

  togglePause() {
    if (this.state === S.PAUSED) {
      this.machine.transition(S.AWAITING_RESPONSE, 'Ready when you are…');
      return;
    }

    stopAudio();
    this._stopListening();
    if (this.state !== S.COMPLETE && this.state !== S.WRAPPING_UP) {
      this.machine.transition(S.PAUSED, 'Interview paused');
    }
  }

  destroy() {
    this._destroyed = true;
    ++this._submissionId;
    this._abortController?.abort();
    this._abortController = null;
    clearTimeout(this._completionTimer);
    stopAudio();
    this._stopListening();
    this.machine.destroy();
  }

  async _deliverQuestion(question) {
    const text = question?.question_text || question?.question || '';
    if (!text) return;

    this._addHistory('interviewer', text);
    await this._deliverAgentMessage(text, 'Asking next question…');
  }

  async _deliverAgentMessage(text, status) {
    if (!text || this._destroyed) return;

    this.machine.transition(S.SPEAKING, status);
    await speakText(text, {
      onError: (error) => this.onError?.(error?.message || 'Voice playback failed.'),
    });

    if (this._destroyed || this.state !== S.SPEAKING) return;

    await new Promise((resolve) => setTimeout(resolve, POST_TTS_GUARD_MS));
    if (this._destroyed || this.state !== S.SPEAKING) return;

    this.machine.transition(S.AWAITING_RESPONSE, 'Ready when you are…');
  }

  async _startListening() {
    this.onLiveTranscript?.('');
    try {
      await this.listener.start();
      if (this.state === S.AWAITING_RESPONSE || this.state === S.INTERRUPTED) {
        this.machine.transition(S.AWAITING_RESPONSE, 'Listening…');
      }
    } catch (error) {
      this.onError?.(error?.message || 'Could not access your microphone.');
      if (this.state !== S.COMPLETE) {
        this.machine.transition(S.AWAITING_RESPONSE, 'Voice unavailable — type your answer instead.');
      }
    }
  }

  async _stopListening() {
    try {
      return await this.listener.stop();
    } catch (error) {
      this.onError?.(error?.message || 'Could not finalize the recording.');
      return '';
    } finally {
      this.onVolume?.(0);
    }
  }

  async _repeatCurrentQuestion() {
    const text = this.currentQuestion?.question_text || this.currentQuestion?.question;
    if (text) await this._deliverAgentMessage(text, 'Repeating question…');
  }

  async _recover(message) {
    if (this._destroyed) return;
    this.machine.transition(S.RECOVERING, message);
    this._addHistory('interviewer', message);
    await speakText(message, {
      onError: (error) => this.onError?.(error?.message || 'Voice playback failed.'),
    });
  }

  async _handleResponseTimeout() {
    if (this._destroyed || this.state !== S.AWAITING_RESPONSE) return;
    await this._deliverAgentMessage(
      'Take your time. You can start speaking whenever you are ready, or type your answer below.',
      'Still here…',
    );
  }

  async _wrapUp() {
    if (this.state === S.COMPLETE || this.state === S.WRAPPING_UP || this._destroyed) return;

    this.machine.transition(S.WRAPPING_UP, 'Wrapping up…');
    const closing = this.plan?.closing
      || `Thank you for your time today, ${this.candidateName || 'there'}.`;

    this._addHistory('interviewer', closing);
    await speakText(closing, {
      onError: (error) => this.onError?.(error?.message || 'Voice playback failed.'),
    });

    if (this._destroyed) return;

    this.machine.transition(S.COMPLETE, 'Interview complete');
    this._completionTimer = setTimeout(() => {
      if (!this._destroyed) this._onComplete?.();
    }, 500);
  }

  _addHistory(role, text) {
    this.conversationHistory.push({
      id: `${Date.now()}-${this.conversationHistory.length}`,
      role,
      text,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    });
    this.onHistoryChange?.([...this.conversationHistory]);
  }

  _syncTopicCoverage(topicCoverage, fallbackTopic) {
    if (!this.plan?.todos) return;

    if (topicCoverage && Object.keys(topicCoverage).length) {
      for (const todo of this.plan.todos) {
        const key = Object.keys(topicCoverage).find((candidate) => {
          const a = String(candidate).toLowerCase().trim();
          const b = String(todo.area).toLowerCase().trim();
          return a === b || a.includes(b) || b.includes(a);
        });

        if (!key) continue;
        const entry = topicCoverage[key] || {};
        todo.attempts = Number(entry.attempts || 0);
        todo.status = entry.covered
          ? 'covered'
          : todo.attempts >= 2
            ? 'reviewed'
            : todo.attempts > 0
              ? 'probing'
              : 'pending';
      }
    } else {
      const target = this.plan.todos.find((todo) => {
        const topic = String(fallbackTopic || '').toLowerCase();
        const area = String(todo.area || '').toLowerCase();
        return topic && (topic.includes(area) || area.includes(topic));
      }) || this.plan.todos.find((todo) => todo.status === 'pending');

      if (target) {
        target.attempts = (target.attempts || 0) + 1;
        target.status = 'covered';
      }
    }

    this.onPlanChange?.({ ...this.plan, todos: [...this.plan.todos] });
  }

  _handleFatal(error) {
    console.error('[InterviewAgent]', error);
    try {
      if (this.state !== S.ERROR) this.machine.transition(S.ERROR, error?.message || 'Interview could not start.');
    } catch {
      this.onError?.(error?.message || 'Interview could not start.');
    }
    this.onError?.(error?.message || 'Interview could not start.');
  }
}

export default InterviewAgent;

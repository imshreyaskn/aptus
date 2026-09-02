/**
 * React hook connecting InterviewAgent FSM lifecycle to component state.
 * Manages tab visibility, voice audio cleanup, text answer submission, and UI derived booleans.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { InterviewAgent, S } from './interviewAgent';
import { VoiceListener } from './listener';

/**
 * @param {Object} props
 * @param {Object} props.session - Active backend session
 * @param {string} props.candidateName - Official candidate name
 * @param {string} props.role - Selected target role
 * @param {string} [props.resumeText] - Candidate resume text
 * @param {Object} props.currentQuestion - Initial or active question item
 * @param {Function} props.onSubmitAnswer - Async handler submitting candidate answer
 * @param {Function} props.onComplete - Async handler called when interview wraps up
 */
export function useInterviewAgent({
  session,
  candidateName,
  role,
  resumeText,
  currentQuestion,
  onSubmitAnswer,
  onComplete,
}) {
  const [snapshot, setSnapshot] = useState({ state: S.IDLE, message: 'Ready' });
  const [plan, setPlan] = useState(null);
  const [history, setHistory] = useState([]);
  const [liveTranscript, setLiveTranscript] = useState('');
  const [volumeLevel, setVolumeLevel] = useState(0);
  const [errorMessage, setErrorMessage] = useState('');
  const [hasStarted, setHasStarted] = useState(false);

  const agentRef = useRef(null);
  const currentQuestionRef = useRef(currentQuestion);
  currentQuestionRef.current = currentQuestion;

  // ── Mount: initialize InterviewAgent instance ──────────────────────────────
  useEffect(() => {
    const agent = new InterviewAgent({
      session,
      candidateName,
      role,
      resumeText,
      currentQuestion,
      onSubmitAnswer: (qId, text, signal) => onSubmitAnswer(qId, text, signal),
      onComplete,
    });

    agent.onChange = (snap) => setSnapshot({ ...snap });
    agent.onPlanChange = (p) => setPlan({ ...p, todos: [...p.todos] });
    agent.onHistoryChange = (h) => setHistory([...h]);
    agent.onLiveTranscript = (t) => setLiveTranscript(t);
    agent.onVolume = (v) => setVolumeLevel(v);
    agent.onError = (msg) => setErrorMessage(msg);

    agentRef.current = agent;

    // Tab visibility handling: pause speech when hidden, resume when returning
    const handleVisibility = () => {
      if (!agentRef.current) return;
      if (document.hidden) {
        const st = agentRef.current.state;
        if (st === S.AWAITING_RESPONSE || st === S.SPEAKING) {
          agentRef.current.togglePause();
        }
      } else {
        if (agentRef.current.state === S.PAUSED) {
          agentRef.current.togglePause();
        }
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      agentRef.current?.destroy();
      agentRef.current = null;
    };
  }, []);

  // ── Synchronize currentQuestion to agent instance when parent updates ─────
  useEffect(() => {
    agentRef.current?.setCurrentQuestion(currentQuestion);
  }, [currentQuestion?.id]);

  // ── Actions ───────────────────────────────────────────────────────────────

  const start = useCallback(async () => {
    if (hasStarted || !agentRef.current) return;
    setHasStarted(true);
    setErrorMessage('');
    await agentRef.current.start();
  }, [hasStarted]);

  const interrupt = useCallback(async () => {
    await agentRef.current?.interrupt();
  }, []);

  const toggleMic = useCallback(async () => {
    await agentRef.current?.toggleMic();
  }, []);

  const togglePause = useCallback(async () => {
    await agentRef.current?.togglePause();
  }, []);

  // Manual text submit — always available regardless of voice state
  const submitText = useCallback(async (text) => {
    const trimmed = text?.trim();
    if (!trimmed) return;
    await agentRef.current?.handleUserInput(trimmed);
  }, []);

  // Force-end the interview immediately
  const forceEnd = useCallback(async () => {
    await agentRef.current?.forceEnd();
  }, []);

  // ── Derived booleans for UI consumption ───────────────────────────────────
  const state = snapshot.state;
  const isSpeaking        = state === S.SPEAKING;
  const isListening       = Boolean(agentRef.current?.isListening);
  const isProcessing      = state === S.PROCESSING;
  const isPaused          = state === S.PAUSED;
  const isComplete        = state === S.COMPLETE;
  const isRecovering      = state === S.RECOVERING;
  const isPlanning        = state === S.PLANNING_INTERVIEW;
  const isError           = state === S.ERROR;
  const isSupported       = VoiceListener.isSupported();
  const isActive          = hasStarted && !isComplete;

  return {
    // State
    snapshot,
    state,
    plan,
    history,
    liveTranscript,
    volumeLevel,
    errorMessage,
    hasStarted,
    isSupported,

    // Booleans
    isSpeaking,
    isListening,
    isProcessing,
    isPaused,
    isComplete,
    isRecovering,
    isPlanning,
    isError,
    isActive,

    // Actions
    start,
    interrupt,
    toggleMic,
    togglePause,
    submitText,
    forceEnd,
  };
}

export default useInterviewAgent;


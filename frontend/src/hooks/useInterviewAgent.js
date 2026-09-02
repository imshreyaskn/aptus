import { useCallback, useEffect, useRef, useState } from 'react';
import InterviewAgent from '../voice/interviewAgent';

/**
 * React adapter around the long-lived interview runtime.
 *
 * The agent instance is intentionally created once. React props/callbacks are
 * updated through refs so rerenders never reset the interview.
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
  const agentRef = useRef(null);
  const submitRef = useRef(onSubmitAnswer);
  const completeRef = useRef(onComplete);

  const [snapshot, setSnapshot] = useState({ state: 'IDLE', message: 'Ready' });
  const [history, setHistory] = useState([]);
  const [plan, setPlan] = useState(null);
  const [liveTranscript, setLiveTranscript] = useState('');
  const [volume, setVolume] = useState(0);
  const [errorMessage, setErrorMessage] = useState('');
  const [hasStarted, setHasStarted] = useState(false);

  submitRef.current = onSubmitAnswer;
  completeRef.current = onComplete;

  if (!agentRef.current) {
    const agent = new InterviewAgent({
      session,
      candidateName,
      role,
      resumeText,
      currentQuestion,
      onSubmitAnswer: (...args) => submitRef.current?.(...args),
      onComplete: () => completeRef.current?.(),
    });

    agent.onChange = setSnapshot;
    agent.onPlanChange = setPlan;
    agent.onHistoryChange = setHistory;
    agent.onVolume = setVolume;
    agent.onLiveTranscript = setLiveTranscript;
    agent.onError = (message) => setErrorMessage(message || 'Voice input unavailable.');

    agentRef.current = agent;
  }

  useEffect(() => {
    agentRef.current?.setCurrentQuestion(currentQuestion);
  }, [currentQuestion]);

  useEffect(() => () => agentRef.current?.destroy(), []);

  const start = useCallback(async () => {
    const agent = agentRef.current;
    if (!agent || hasStarted) return;

    setErrorMessage('');
    await agent.start();
    setHasStarted(true);
  }, [hasStarted]);

  const toggleMic = useCallback(() => agentRef.current?.toggleMic(), []);
  const submitText = useCallback((text) => agentRef.current?.submitText(text), []);
  const interrupt = useCallback(() => agentRef.current?.toggleMic(), []);
  const togglePause = useCallback(() => agentRef.current?.togglePause(), []);
  const forceEnd = useCallback(() => agentRef.current?.forceEnd(), []);

  return {
    start,
    toggleMic,
    submitText,
    interrupt,
    togglePause,
    forceEnd,
    setCurrentQuestion: (question) => agentRef.current?.setCurrentQuestion(question),

    state: snapshot.state,
    snapshot,
    history,
    plan,
    liveTranscript,
    volume,
    errorMessage,
    hasStarted,

    isSpeaking: snapshot.state === 'SPEAKING',
    isListening: Boolean(agentRef.current?.isListening),
    isProcessing: snapshot.state === 'PROCESSING',
    isPlanning: snapshot.state === 'PLANNING_INTERVIEW',
    isComplete: snapshot.state === 'COMPLETE',
    isPaused: snapshot.state === 'PAUSED',
    isSupported: agentRef.current?.isSupported ?? false,
  };
}

export default useInterviewAgent;

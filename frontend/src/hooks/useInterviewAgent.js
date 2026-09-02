import { useCallback, useEffect, useRef, useState } from 'react';
import InterviewAgent from '../voice/interviewAgent';

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
  const submitAnswerRef = useRef(onSubmitAnswer);
  const onCompleteRef = useRef(onComplete);
  submitAnswerRef.current = onSubmitAnswer;
  onCompleteRef.current = onComplete;
  const [, forceRender] = useState(0);
  const [snapshot, setSnapshot] = useState({ state: 'IDLE', message: 'Ready' });
  const [history, setHistory] = useState([]);
  const [plan, setPlan] = useState(null);
  const [liveTranscript, setLiveTranscript] = useState('');
  const [volume, setVolume] = useState(0);
  const [errorMessage, setErrorMessage] = useState('');
  const [hasStarted, setHasStarted] = useState(false);
  const [, setCompleted] = useState(false);

  if (!agentRef.current) {
    agentRef.current = new InterviewAgent({
      session,
      candidateName,
      role,
      resumeText,
      currentQuestion,
      onSubmitAnswer: (...args) => submitAnswerRef.current?.(...args),
      onComplete: () => {
        setCompleted(true);
        onCompleteRef.current?.();
      },
    });

    agentRef.current.onChange = (next) => { setSnapshot({ ...next }); forceRender(v => v + 1); };
    agentRef.current.onPlanChange = (next) => { setPlan(next); forceRender(v => v + 1); };
    agentRef.current.onHistoryChange = (next) => setHistory(next);
    agentRef.current.onVolume = (next) => setVolume(next);
    agentRef.current.onLiveTranscript = (next) => setLiveTranscript(next);
    agentRef.current.onError = (msg) => { setErrorMessage(msg || 'Voice input unavailable.'); forceRender(v => v + 1); };
  }

  useEffect(() => {
    const agent = agentRef.current;
    if (currentQuestion) agent.setCurrentQuestion(currentQuestion);
  }, [currentQuestion]);

  useEffect(() => {
    const agent = agentRef.current;
    return () => agent.destroy();
  }, []);

  const start = useCallback(async () => {
    const agent = agentRef.current;
    if (!agent || hasStarted) return;
    setErrorMessage('');
    try {
      await agent.start();
      setHasStarted(true);
    } catch (err) {
      setErrorMessage(err?.message || 'Failed to start interview.');
    }
  }, [hasStarted]);

  const value = {
    start,
    toggleMic: () => agentRef.current?.toggleMic(),
    interrupt: () => agentRef.current?.interrupt(),
    togglePause: () => agentRef.current?.togglePause(),
    forceEnd: () => agentRef.current?.forceEnd(),
    submitText: (text) => agentRef.current?.submitText(text),
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
    isSupported: agentRef.current?.isSupported ?? false,
  };

  return value;
}

export default useInterviewAgent;

// File: frontend/src\App.jsx

import React, { useState } from 'react';
import LandingScreen from './components/LandingScreen';
import SetupScreen from './components/SetupScreen';
import InterviewAgentScreen from './components/InterviewAgentScreen';
import ResultsScreen from './components/ResultsScreen';
import { startInterview, getNextQuestion, submitAnswer, endSession, getSessionSummary, getSessionHistory } from './api';

function App() {
  const [screen, setScreen] = useState('landing'); // 'landing' | 'setup' | 'interview' | 'results'
  const [interviewMode, setInterviewMode] = useState('voice'); // 'voice' | 'text'
  
  // Staged Setup State
  const [candidateName, setCandidateName] = useState('');
  const [selectedRole, setSelectedRole] = useState('AI/ML Engineer');
  const [resumeText, setResumeText] = useState('');


  // Active Interview State
  const [session, setSession] = useState(null);
  const [currentQuestion, setCurrentQuestion] = useState(null);
  const [topicCoverage, setTopicCoverage] = useState({});
  const [lastVerdict, setLastVerdict] = useState(null);
  
  // Results State
  const [summary, setSummary] = useState(null);
  const [history, setHistory] = useState(null);

  // Loading States
  const [isStarting, setIsStarting] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoadingResults, setIsLoadingResults] = useState(false);

  // 1. Start Interview Handler
  const handleStartInterview = async ({ name, role, resumeText: rt, resumeFile }) => {
    setIsStarting(true);
    if (name) setCandidateName(name);
    if (role) setSelectedRole(role);
    setResumeText(rt || '');
    try {
      const data = await startInterview({
        name: name || candidateName || 'Candidate',
        role: role || selectedRole,
        resumeText: rt,
        resumeFile
      });
      setSession(data);

      // Initialize initial topic coverage map
      const initialCoverage = {};
      (data.topics_planned || []).forEach(t => {
        initialCoverage[t.topic] = { attempts: 0, covered: false };
      });
      setTopicCoverage(initialCoverage);

      // Fetch first question
      const qRes = await getNextQuestion(data.session_id);
      if (qRes.question) {
        setCurrentQuestion(qRes.question);
        setScreen('interview');
      } else {
        throw new Error('No question generated for session.');
      }
    } catch (error) {
      console.error('[Aptus] Failed to start interview:', error);
      throw error;
    } finally {
      setIsStarting(false);
    }
  };


  // 2. Submit Answer Handler
  const handleSubmitAnswer = async (questionId, answerText) => {
    if (!session) return;
    setIsSubmitting(true);
    try {
      const res = await submitAnswer(session.session_id, questionId, answerText);
      setLastVerdict(res.judge_verdict);

      if (res.progress?.topic_coverage) {
        setTopicCoverage(res.progress.topic_coverage);
      }

      if (res.is_session_completed) {
        // Let InterviewAgent play closing TTS and invoke onComplete when done
      } else if (res.next_question) {
        setCurrentQuestion(res.next_question);
      }
      return res;
    } finally {
      setIsSubmitting(false);
    }
  };

  // 3. Load Results
  const loadResults = async (sessionId) => {
    setIsLoadingResults(true);
    try {
      let sumRes = await endSession(sessionId).catch(() => null);
      if (!sumRes) {
        sumRes = await getSessionSummary(sessionId).catch(() => null);
      }
      const histRes = await getSessionHistory(sessionId).catch(() => null);
      setSummary(sumRes);
      setHistory(histRes);
      setScreen('results');
    } finally {
      setIsLoadingResults(false);
    }
  };

  // Reset to Landing
  const handleReset = () => {
    setSession(null);
    setCurrentQuestion(null);
    setTopicCoverage({});
    setLastVerdict(null);
    setSummary(null);
    setHistory(null);
    setCandidateName('');
    setSelectedRole('AI/ML Engineer');
    setResumeText('');
    setScreen('landing');
  };


  const isEntryPhase = screen === 'landing' || screen === 'setup';

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', backgroundColor: 'var(--color-base)' }}>
      {/* Main Content Area */}
      <main style={{
        flex: 1,
        padding: screen === 'results' ? '32px 0 64px' : '0',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: isEntryPhase ? 'center' : 'flex-start'
      }}>
        {screen === 'landing' && (
          <LandingScreen
            onGetStarted={(name) => {
              setCandidateName(name);
              setScreen('setup');
            }}
          />
        )}

        {screen === 'setup' && (
          <SetupScreen
            candidateName={candidateName}
            selectedRole={selectedRole}
            onSelectRole={(role) => setSelectedRole(role)}
            onStartInterview={handleStartInterview}
            onBack={() => setScreen('landing')}
            isStarting={isStarting}
          />
        )}

        {screen === 'interview' && currentQuestion && (
          <InterviewAgentScreen
            session={session}
            candidateName={candidateName}
            selectedRole={selectedRole}
            resumeText={resumeText}
            currentQuestion={currentQuestion}
            onSubmitAnswer={handleSubmitAnswer}
            onComplete={() => loadResults(session.session_id)}
          />
        )}


        {screen === 'results' && (
          <ResultsScreen
            summary={summary}
            history={history}
            onReset={handleReset}
          />
        )}

        {isLoadingResults && (
          <div className="layout-container" style={{ padding: '64px 24px' }}>
            <h2 className="text-h2" style={{ marginBottom: '8px' }}>
              Synthesizing evaluation report
            </h2>
            <p className="text-body" style={{ color: 'var(--color-muted)' }}>
              Aggregating Q&A transcript, judge evaluations, and topic coverage across literature chunks.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}

export default App;

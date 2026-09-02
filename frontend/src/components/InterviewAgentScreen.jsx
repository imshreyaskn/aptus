// frontend/src/components/InterviewAgentScreen.jsx
// Clean chat + voice interview interface styled consistently with the landing page

import React, { useState, useEffect, useRef } from 'react';
import {
  Mic, Volume2, Pause,
  Check, Circle, Loader2,
  ListTodo, X, Send, LogOut
} from 'lucide-react';
import { useInterviewAgent } from '../voice/useInterviewAgent';
import { S } from '../voice/interviewAgent';

function InterviewAgentScreen({
  session,
  candidateName,
  selectedRole,
  resumeText,
  currentQuestion,
  onSubmitAnswer,
  onComplete,
}) {
  const [inputText, setInputText] = useState('');
  const [isFocused, setIsFocused] = useState(false);
  const [isPlanOpen, setIsPlanOpen] = useState(false);
  const chatBottomRef = useRef(null);
  const inputRef = useRef(null);

  const agent = useInterviewAgent({
    session,
    candidateName,
    role: selectedRole,
    resumeText,
    currentQuestion,
    onSubmitAnswer,
    onComplete,
  });

  // Auto-scroll chat on new messages or live transcripts
  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [agent.history, agent.liveTranscript]);

  // Auto-start interview on mount
  useEffect(() => {
    const timer = setTimeout(() => {
      if (!agent.hasStarted) {
        agent.start();
      }
    }, 300);
    return () => clearTimeout(timer);
  }, []);

  const handleOrbClick = async () => {
    if (!agent.hasStarted) {
      await agent.start();
      return;
    }
    if (agent.isSpeaking) {
      await agent.interrupt();
    } else {
      await agent.toggleMic();
    }
  };

  const handleTextSubmit = async (e) => {
    e?.preventDefault();
    const text = inputText.trim() || agent.liveTranscript.trim();
    if (!text) return;
    setInputText('');
    await agent.submitText(text);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleTextSubmit();
    }
  };

  const coveredTodos = agent.plan?.todos.filter(t => t.status === 'covered' || t.status === 'reviewed') || [];
  const totalTodos = agent.plan?.todos.length || 0;
  const isBusy = agent.isProcessing || agent.isPlanning;
  const canSend = !isBusy && !agent.isComplete && (inputText.trim() || agent.liveTranscript.trim());

  return (
    <div style={{
      maxWidth: '680px',
      width: '100%',
      margin: '0 auto',
      height: '100vh',
      display: 'flex',
      flexDirection: 'column',
      position: 'relative',
      padding: '24px 16px 20px',
      boxSizing: 'border-box'
    }}>

      {/* ── Top Center Aptus Wordmark ── */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '0 0 16px',
        flexShrink: 0,
        position: 'relative'
      }}>
        <h1 className="text-wordmark" style={{ fontSize: '28px', margin: 0, lineHeight: '1.0', letterSpacing: '-0.02em' }}>
          Aptus
        </h1>

        {/* Header Action Buttons (top right) */}
        <div style={{ position: 'absolute', right: 0, top: '2px', display: 'flex', alignItems: 'center', gap: '8px' }}>
          {totalTodos > 0 && (
            <button
              type="button"
              onClick={() => setIsPlanOpen(!isPlanOpen)}
              className="btn-liquid-glass"
              style={{
                padding: '6px 12px',
                fontSize: '12px',
                borderRadius: '10px',
                display: 'flex',
                alignItems: 'center',
                gap: '6px'
              }}
            >
              <ListTodo size={13} />
              <span>Plan ({coveredTodos.length}/{totalTodos})</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => agent.forceEnd()}
            disabled={agent.isComplete || agent.state === S.WRAPPING_UP}
            className="btn-liquid-glass"
            style={{
              padding: '6px 12px',
              fontSize: '12px',
              borderRadius: '10px',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              color: 'var(--color-text-secondary)',
              cursor: 'pointer'
            }}
            title="End interview and view evaluation summary"
          >
            <LogOut size={13} />
            <span>End</span>
          </button>
        </div>
        {/* Toast: voice-unavailable / error info */}
        {agent.errorMessage && (
          <div style={{
            position: 'absolute',
            bottom: '-2px',
            left: 0,
            right: 0,
            display: 'flex',
            justifyContent: 'center'
          }}>
            <span style={{
              fontSize: '11px',
              color: 'var(--color-text-secondary)',
              background: 'rgba(243,240,233,0.9)',
              borderRadius: '6px',
              padding: '3px 10px',
              border: '1px solid var(--color-border)'
            }}>
              {agent.errorMessage}
            </span>
          </div>
        )}
      </div>

      {/* ── Slide-down Interview Plan Overlay ── */}
      {isPlanOpen && (
        <div style={{
          position: 'absolute',
          top: '56px',
          left: '16px',
          right: '16px',
          backgroundColor: 'rgba(253, 252, 248, 0.96)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          border: '1px solid var(--color-border)',
          borderRadius: '16px',
          padding: '20px',
          boxShadow: '0 16px 36px rgba(16, 16, 16, 0.12)',
          zIndex: 50,
          maxHeight: '70vh',
          overflowY: 'auto'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
            <span style={{ fontSize: '13px', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Planned Assessment Topics
            </span>
            <button
              onClick={() => setIsPlanOpen(false)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px', color: 'var(--color-text-secondary)' }}
            >
              <X size={16} />
            </button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {agent.plan?.todos?.map((todo) => {
              const isCovered = todo.status === 'covered';
              const isProbing = todo.status === 'probing';
              const isReviewed = todo.status === 'reviewed';

              return (
                <div
                  key={todo.id}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    justifyContent: 'space-between',
                    gap: '10px',
                    padding: '10px 12px',
                    borderRadius: '10px',
                    backgroundColor: isCovered
                      ? 'rgba(22, 163, 74, 0.05)'
                      : isProbing
                      ? 'rgba(217, 119, 6, 0.06)'
                      : 'var(--color-base)',
                    border: isProbing
                      ? '1px solid rgba(217, 119, 6, 0.3)'
                      : '1px solid var(--color-border)'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
                    <div style={{ marginTop: '2px' }}>
                      {isCovered ? (
                        <Check size={14} color="#16a34a" strokeWidth={2.5} />
                      ) : isProbing ? (
                        <Circle size={14} color="#d97706" strokeWidth={2.5} />
                      ) : isReviewed ? (
                        <Check size={14} color="var(--color-text-muted)" strokeWidth={2} />
                      ) : (
                        <Circle size={14} color="var(--color-text-muted)" strokeWidth={1.5} />
                      )}
                    </div>
                    <div>
                      <div style={{
                        fontSize: '13px',
                        fontWeight: '500',
                        color: isCovered
                          ? '#15803d'
                          : isProbing
                          ? '#b45309'
                          : isReviewed
                          ? 'var(--color-text-muted)'
                          : 'var(--color-text)'
                      }}>
                        {todo.area}
                      </div>
                      {todo.intent && (
                        <p style={{ fontSize: '11.5px', color: 'var(--color-text-secondary)', margin: '2px 0 0', lineHeight: 1.4 }}>
                          {todo.intent}
                        </p>
                      )}
                    </div>
                  </div>

                  <span style={{
                    fontSize: '10.5px',
                    fontWeight: '600',
                    padding: '2px 8px',
                    borderRadius: '6px',
                    flexShrink: 0,
                    textTransform: 'uppercase',
                    letterSpacing: '0.04em',
                    backgroundColor: isCovered
                      ? 'rgba(22, 163, 74, 0.12)'
                      : isProbing
                      ? 'rgba(217, 119, 6, 0.15)'
                      : isReviewed
                      ? 'rgba(100, 116, 139, 0.1)'
                      : 'rgba(0, 0, 0, 0.04)',
                    color: isCovered
                      ? '#15803d'
                      : isProbing
                      ? '#b45309'
                      : isReviewed
                      ? 'var(--color-text-muted)'
                      : 'var(--color-text-secondary)'
                  }}>
                    {isCovered ? 'Mastered' : isProbing ? 'Probing (2nd Attempt)' : isReviewed ? 'Evaluated' : 'Upcoming'}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Main Chat Log ── */}
      <div style={{
        flex: 1,
        overflowY: 'auto',
        overflowX: 'hidden',
        padding: '12px 4px 16px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'stretch',
        gap: '16px'
      }}>
        {/* Welcome message when starting */}
        {agent.history.length === 0 && (
          <div style={{
            alignSelf: 'flex-start',
            maxWidth: '85%',
            display: 'flex',
            flexDirection: 'column',
            gap: '4px'
          }}>
            <div style={{
              padding: '14px 18px',
              borderRadius: '20px 20px 20px 4px',
              backgroundColor: 'rgba(255, 255, 255, 0.7)',
              backdropFilter: 'blur(16px)',
              WebkitBackdropFilter: 'blur(16px)',
              border: '1px solid rgba(255, 255, 255, 0.95)',
              boxShadow: '0 8px 24px -4px rgba(16, 16, 16, 0.08), inset 0 1px 1px 0 rgba(255, 255, 255, 1)',
              lineHeight: 1.6,
              fontSize: '14.5px',
              color: 'var(--color-text)'
            }}>
              Hi {candidateName || 'there'}! Type your answer below, or click Voice when you'd like to speak.
            </div>
          </div>
        )}

        {/* History Dialogue Bubbles */}
        {agent.history.map((turn, idx) => {
          const isInterviewer = turn.role === 'interviewer';
          return (
            <div
              key={idx}
              style={{
                alignSelf: isInterviewer ? 'flex-start' : 'flex-end',
                maxWidth: '85%',
                display: 'flex',
                flexDirection: 'column',
                gap: '4px'
              }}
            >
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                paddingLeft: isInterviewer ? '4px' : 0,
                paddingRight: isInterviewer ? 0 : '4px',
                justifyContent: isInterviewer ? 'flex-start' : 'flex-end'
              }}>
                <span style={{ fontSize: '10.5px', color: 'var(--color-text-muted)' }}>
                  {turn.timestamp}
                </span>
              </div>

              <div style={{
                padding: '14px 18px',
                borderRadius: isInterviewer ? '20px 20px 20px 4px' : '20px 20px 4px 20px',
                backgroundColor: isInterviewer
                  ? 'rgba(255, 255, 255, 0.75)'
                  : 'var(--color-ivory)',
                backdropFilter: 'blur(16px)',
                WebkitBackdropFilter: 'blur(16px)',
                border: '1px solid rgba(255, 255, 255, 0.95)',
                boxShadow: isInterviewer
                  ? '0 8px 24px -4px rgba(16, 16, 16, 0.08), inset 0 1.5px 1px 0 rgba(255, 255, 255, 1)'
                  : '0 8px 20px -4px rgba(16, 16, 16, 0.06), inset 0 1px 1px 0 rgba(255, 255, 255, 0.8)',
                lineHeight: 1.6,
                fontSize: isInterviewer ? '14.5px' : '14px',
                color: 'var(--color-text)'
              }}>
                {turn.text}
              </div>
            </div>
          );
        })}

        {/* Live Interim Transcript Bubble */}
        {agent.liveTranscript && (
          <div style={{
            alignSelf: 'flex-end',
            maxWidth: '85%',
            display: 'flex',
            flexDirection: 'column',
            gap: '4px'
          }}>
            <div style={{
              padding: '12px 16px',
              borderRadius: '20px 20px 4px 20px',
              backgroundColor: 'rgba(37, 99, 235, 0.04)',
              border: '1.5px dashed rgba(37, 99, 235, 0.35)',
              color: 'var(--color-text)',
              fontSize: '14px',
              fontStyle: 'italic',
              lineHeight: 1.5
            }}>
              "{agent.liveTranscript}"
            </div>
          </div>
        )}

        <div ref={chatBottomRef} />
      </div>

      {/* ── Shared Status Indicator (Common place for evaluating/processing/loading) ── */}
      {(isBusy || agent.state === S.WRAPPING_UP) && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '8px',
          padding: '6px 0 2px',
          color: 'var(--color-text-secondary)',
          fontSize: '12.5px',
          flexShrink: 0
        }}>
          <Loader2 size={14} className="spin-anim" />
          <span>
            {agent.state === S.WRAPPING_UP
              ? 'Synthesizing evaluation report...'
              : agent.snapshot?.message || 'Evaluating your response...'}
          </span>
        </div>
      )}

      {/* ── Input + Voice Row Styled Like the Landing Screen ── */}
      <form
        onSubmit={handleTextSubmit}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          padding: '8px 0 4px',
          flexShrink: 0
        }}
      >
        <input
          ref={inputRef}
          type="text"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          onKeyDown={handleKeyDown}
          disabled={agent.isComplete || isBusy}
          placeholder={
            isBusy
              ? "Evaluating response..."
              : agent.isListening
              ? "Listening... (speak or type response)"
              : "Type your answer (or click Voice)..."
          }
          style={{
            flex: 1,
            background: 'transparent',
            border: 'none',
            borderLeft: isFocused
              ? '1.5px solid var(--color-obsidian-100)'
              : '1.5px solid var(--color-border)',
            outline: 'none',
            fontSize: '14px',
            fontFamily: 'var(--font-sans)',
            color: 'var(--color-text)',
            padding: '8px 2px 8px 12px',
            textAlign: 'left',
            transition: 'border-color 150ms ease-out'
          }}
        />

        {/* Voice Button Styled as Landing Page Button */}
        <button
          type="button"
          onClick={handleOrbClick}
          disabled={isBusy || agent.isComplete}
          className="btn-liquid-glass"
          style={{
            padding: '8px 18px',
            fontSize: '13.5px',
            borderRadius: '10px',
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            color: agent.isListening ? '#2563eb' : 'var(--color-text)',
            opacity: (isBusy || agent.isComplete) ? 0.6 : 1
          }}
        >
          {agent.isSpeaking ? (
            <Volume2 size={16} />
          ) : agent.isListening ? (
            <Mic size={16} color="#2563eb" />
          ) : (
            <Mic size={16} />
          )}
          <span>
            {agent.isListening ? 'Listening...' : agent.isSpeaking ? 'Interrupt' : 'Voice'}
          </span>
        </button>

        {/* Send Button Styled as Landing Page Button with paper plane SVG */}
        <button
          type="submit"
          disabled={!canSend}
          className="btn-liquid-glass"
          style={{
            padding: '8px 18px',
            fontSize: '13.5px',
            borderRadius: '10px',
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            opacity: canSend ? 1 : 0.4
          }}
        >
          <Send size={13} />
          <span>Send</span>
        </button>
      </form>

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        .spin-anim { animation: spin 1s linear infinite; }
      `}</style>
    </div>
  );
}

export default InterviewAgentScreen;

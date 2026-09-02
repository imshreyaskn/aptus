import React, { useState } from 'react';
import { ChevronDown, ChevronUp, ArrowRight, BookOpen, CheckCircle2, AlertCircle, Award, Sparkles } from 'lucide-react';
import TraceabilityModal from './TraceabilityModal';

export default function ResultsScreen({
  summary,
  history,
  onReset
}) {
  const [selectedQAForTrace, setSelectedQAForTrace] = useState(null);
  const [expandedQA, setExpandedQA] = useState({});

  const toggleQA = (idx) => {
    setExpandedQA(prev => ({
      ...prev,
      [idx]: !prev[idx]
    }));
  };

  const candidateName = history?.candidate_name || 'Candidate';
  const role = history?.role || 'Technical Role';
  const qaPairs = history?.qa_pairs || [];

  const answeredQAs = qaPairs.filter(qa => qa.answer_text && qa.answer_text.trim().length > 0);
  const answeredCount = answeredQAs.length;

  // Calculate average score honestly
  const scores = answeredQAs
    .map(qa => qa.judge_verdict?.score)
    .filter(s => typeof s === 'number');
  const avgScore = scores.length > 0
    ? (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1)
    : '—';

  const totalPlanned = history?.topics_planned?.length || Math.max(1, qaPairs.length);
  const completionPercent = totalPlanned > 0 ? Math.min(100, Math.round((answeredCount / totalPlanned) * 100)) : 0;
  const completionStatus = completionPercent >= 100 ? 'COMPLETE' : completionPercent === 0 ? '0%' : `${completionPercent}%`;

  const radius = 36;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (completionPercent / 100) * circumference;

  const numAvgScore = scores.length > 0 ? (scores.reduce((a, b) => a + b, 0) / scores.length) : 0;

  const defaultSummaryText = answeredCount === 0
    ? `The screening session for ${candidateName} was concluded before any technical questions were answered. No evaluation score could be determined.`
    : numAvgScore < 4.0
    ? `${candidateName} completed ${answeredCount} screening round(s) with an average rating of ${avgScore}/10. Responses did not demonstrate sufficient technical depth or conceptual understanding for ${role}.`
    : `${candidateName} completed ${answeredCount} screening round(s), demonstrating relevant foundational knowledge across targeted topics.`;

  const defaultStrengths = answeredCount === 0
    ? ['Interview session initialized with candidate background and curriculum roadmap.']
    : numAvgScore < 4.0
    ? ['Completed session evaluation across initial curriculum areas.']
    : ['Demonstrated initial familiarity with core technical topics.'];

  const defaultGaps = answeredCount === 0
    ? ['No responses were recorded to evaluate technical depth or engineering trade-offs.']
    : numAvgScore < 4.0
    ? ['Responses lacked technical explanation, algorithmic depth, and architectural trade-offs.', 'Did not answer targeted questions on fundamental principles.']
    : ['Further technical rounds recommended to assess complete syllabus coverage.'];

  const defaultNextSteps = answeredCount === 0
    ? ['Schedule a complete technical screening interview.', `Review foundational literature in ${role}.`]
    : numAvgScore < 4.0
    ? [`Comprehensive review of foundational ${role} literature and architectures recommended.`, 'Re-application advised after fundamental technical skill development.']
    : ['Deepen practical hands-on implementation and system trade-offs.', 'Proceed to technical architecture design round.'];

  const recommendation = summary?.overall_recommendation || (numAvgScore >= 7.0 ? 'Strong Hire' : numAvgScore >= 5.5 ? 'Hire' : numAvgScore >= 4.0 ? 'Needs Further Evaluation' : answeredCount === 0 ? 'Incomplete' : 'No Hire');

  const recColors = {
    'Strong Hire': { bg: 'rgba(34, 197, 94, 0.12)', text: '#15803d', border: 'rgba(34, 197, 94, 0.3)' },
    'Hire': { bg: 'rgba(34, 197, 94, 0.10)', text: '#16a34a', border: 'rgba(34, 197, 94, 0.25)' },
    'Lean Hire': { bg: 'rgba(234, 179, 8, 0.12)', text: '#a16207', border: 'rgba(234, 179, 8, 0.3)' },
    'Needs Further Evaluation': { bg: 'rgba(245, 158, 11, 0.12)', text: '#b45309', border: 'rgba(245, 158, 11, 0.3)' },
    'No Hire': { bg: 'rgba(239, 68, 68, 0.12)', text: '#b91c1c', border: 'rgba(239, 68, 68, 0.3)' },
    'Incomplete': { bg: 'rgba(107, 114, 128, 0.12)', text: '#4b5563', border: 'rgba(107, 114, 128, 0.3)' },
  };
  const badgeStyle = recColors[recommendation] || recColors['Needs Further Evaluation'];

  return (
    <div style={{
      maxWidth: '780px',
      width: '100%',
      margin: '0 auto',
      padding: '32px 16px 80px',
      boxSizing: 'border-box',
      display: 'flex',
      flexDirection: 'column',
      gap: '24px'
    }}>

      {/* ── Candidate Name Header & Recommendation Badge ── */}
      <div style={{ textAlign: 'center', margin: '16px 0 8px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
        <h1 className="text-wordmark" style={{ fontSize: '56px', margin: 0, lineHeight: '1.0', letterSpacing: '-0.02em' }}>
          {candidateName}
        </h1>
        <div style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '6px',
          padding: '4px 14px',
          borderRadius: '999px',
          fontSize: '13px',
          fontWeight: '600',
          letterSpacing: '0.02em',
          textTransform: 'uppercase',
          background: badgeStyle.bg,
          color: badgeStyle.text,
          border: `1px solid ${badgeStyle.border}`
        }}>
          <span>Verdict: {recommendation}</span>
        </div>
      </div>

      {/* ── Hero Metric Panel (Unified Glass Card) ── */}
      <div style={{
        background: 'linear-gradient(135deg, rgba(255, 255, 255, 0.90) 0%, rgba(243, 240, 233, 0.65) 50%, rgba(255, 255, 255, 0.85) 100%)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        border: '1px solid rgba(255, 255, 255, 0.95)',
        borderRadius: '20px',
        padding: '24px',
        boxShadow: '0 12px 28px -4px rgba(16, 16, 16, 0.08), inset 0 1.5px 1px 0 rgba(255, 255, 255, 1)',
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
        gap: '20px',
        alignItems: 'center'
      }}>
        {/* Metric 1: Overall Performance Score */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <span className="text-caption" style={{ color: 'var(--color-text-secondary)', fontSize: '12px' }}>
            Overall Rating
          </span>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '4px' }}>
            <span className="text-stat" style={{ fontSize: '48px' }}>
              {avgScore}
            </span>
            {avgScore !== '—' && (
              <span className="text-body-l" style={{ color: 'var(--color-text-secondary)', fontWeight: '500' }}>
                /10
              </span>
            )}
          </div>
          <span className="text-micro-data" style={{ color: 'var(--color-text-muted)' }}>
            {avgScore !== '—' && Number(avgScore) >= 7 ? 'Demonstrates solid depth' : avgScore !== '—' ? 'Foundational competency' : 'No score recorded'}
          </span>
        </div>

        {/* Metric 2: Completed Rounds */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <span className="text-caption" style={{ color: 'var(--color-text-secondary)', fontSize: '12px' }}>
            Questions Completed
          </span>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px' }}>
            <span className="text-stat" style={{ fontSize: '48px' }}>
              {answeredCount}
            </span>
            <span className="text-body-l" style={{ color: 'var(--color-text-secondary)', fontWeight: '500' }}>
              / {totalPlanned}
            </span>
          </div>
          <span className="text-micro-data" style={{ color: 'var(--color-text-muted)' }}>
            {totalPlanned - answeredCount > 0 ? `${totalPlanned - answeredCount} topics remaining` : 'Full syllabus covered'}
          </span>
        </div>

        {/* Metric 3: Radial Progress Indicator */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-start', gap: '16px' }}>
          <div style={{ position: 'relative', width: '80px', height: '80px', flexShrink: 0 }}>
            <svg width="80" height="80" style={{ transform: 'rotate(-90deg)' }}>
              <circle
                cx="40"
                cy="40"
                r={radius}
                fill="transparent"
                stroke="var(--color-nude)"
                strokeWidth="6"
              />
              <circle
                cx="40"
                cy="40"
                r={radius}
                fill="transparent"
                stroke="var(--color-obsidian-100)"
                strokeWidth="6"
                strokeDasharray={circumference}
                strokeDashoffset={strokeDashoffset}
                strokeLinecap="round"
                style={{ transition: 'stroke-dashoffset 400ms ease-out' }}
              />
            </svg>
            <div style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}>
              <span className="text-micro-data" style={{ fontWeight: '600', fontSize: '12px' }}>
                {completionPercent}%
              </span>
            </div>
          </div>
          <div>
            <span className="text-caption" style={{ display: 'block', marginBottom: '2px' }}>Syllabus</span>
            <span className="tag-nude" style={{ fontSize: '11px', padding: '3px 8px', borderRadius: '6px' }}>
              {completionStatus}
            </span>
          </div>
        </div>
      </div>

      {/* ── Executive Assessment Card ── */}
      <div style={{
        backgroundColor: 'var(--color-ivory)',
        borderRadius: '20px',
        padding: '24px',
        border: '1px solid var(--color-border)',
        boxShadow: '0 4px 12px rgba(16, 16, 16, 0.03)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
          <Award size={16} color="var(--color-obsidian-100)" />
          <span className="text-caption" style={{ color: 'var(--color-obsidian-100)', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            Executive Assessment
          </span>
        </div>
        <p className="text-body-l" style={{ fontSize: '15px', lineHeight: '1.65', color: 'var(--color-text)', margin: 0 }}>
          {summary?.summary_text || defaultSummaryText}
        </p>
      </div>

      {/* ── Demonstrated Strengths & Identified Knowledge Gaps ── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
        gap: '16px'
      }}>
        {/* Strengths */}
        <div style={{
          backgroundColor: 'rgba(255, 255, 255, 0.8)',
          borderRadius: '20px',
          padding: '20px 24px',
          border: '1px solid var(--color-border)',
          backdropFilter: 'blur(16px)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
            <CheckCircle2 size={16} color="#16a34a" />
            <h3 className="text-h3" style={{ fontSize: '15px', margin: 0 }}>
              Demonstrated Strengths
            </h3>
          </div>
          <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '10px', padding: 0, margin: 0 }}>
            {(summary?.strengths?.length ? summary.strengths : defaultStrengths).map((s, idx) => (
              <li key={idx} className="text-body" style={{ fontSize: '13.5px', display: 'flex', alignItems: 'flex-start', gap: '8px', lineHeight: '1.5' }}>
                <span style={{ color: '#16a34a', fontWeight: '600', marginTop: '-1px' }}>&bull;</span>
                <span>{s}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Gaps */}
        <div style={{
          backgroundColor: 'rgba(255, 255, 255, 0.8)',
          borderRadius: '20px',
          padding: '20px 24px',
          border: '1px solid var(--color-border)',
          backdropFilter: 'blur(16px)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
            <AlertCircle size={16} color="#d97706" />
            <h3 className="text-h3" style={{ fontSize: '15px', margin: 0 }}>
              Identified Knowledge Gaps
            </h3>
          </div>
          <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '10px', padding: 0, margin: 0 }}>
            {(summary?.gaps?.length ? summary.gaps : defaultGaps).map((g, idx) => (
              <li key={idx} className="text-body" style={{ fontSize: '13.5px', display: 'flex', alignItems: 'flex-start', gap: '8px', lineHeight: '1.5' }}>
                <span style={{ color: '#d97706', fontWeight: '600', marginTop: '-1px' }}>&bull;</span>
                <span>{g}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* ── Recommended Next Steps ── */}
      <div style={{
        backgroundColor: 'rgba(243, 240, 233, 0.5)',
        borderRadius: '20px',
        padding: '20px 24px',
        border: '1px solid var(--color-border)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
          <Sparkles size={16} color="var(--color-obsidian-100)" />
          <h3 className="text-h3" style={{ fontSize: '15px', margin: 0 }}>
            Recommended Next Steps
          </h3>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {(summary?.next_steps?.length ? summary.next_steps : defaultNextSteps).map((step, idx) => (
            <div
              key={idx}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                padding: '10px 14px',
                backgroundColor: 'rgba(255, 255, 255, 0.7)',
                borderRadius: '10px',
                border: '1px solid rgba(16, 16, 16, 0.06)'
              }}
            >
              <span className="text-micro-data" style={{ color: 'var(--color-text-secondary)', fontWeight: '600' }}>
                [0{idx + 1}]
              </span>
              <span className="text-body" style={{ fontSize: '13.5px' }}>
                {step}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Interview Transcript (Accordion) ── */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
          <h2 className="text-h2" style={{ fontSize: '18px', margin: 0 }}>
            Interview Transcript
          </h2>
          <span className="tag-ivory" style={{ fontSize: '11px', borderRadius: '6px' }}>
            {qaPairs.length} {qaPairs.length === 1 ? 'Round' : 'Rounds'}
          </span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {qaPairs.map((qa, idx) => {
            const isExpanded = expandedQA[idx] !== false;
            const verdict = qa.judge_verdict || {};
            const hasAnswer = qa.answer_text && qa.answer_text.trim().length > 0;

            return (
              <div
                key={idx}
                style={{
                  backgroundColor: 'rgba(255, 255, 255, 0.75)',
                  backdropFilter: 'blur(16px)',
                  WebkitBackdropFilter: 'blur(16px)',
                  border: '1px solid var(--color-border)',
                  borderRadius: '16px',
                  overflow: 'hidden',
                  boxShadow: '0 4px 16px -2px rgba(16, 16, 16, 0.04)'
                }}
              >
                {/* Accordion Header */}
                <div
                  onClick={() => toggleQA(idx)}
                  style={{
                    padding: '14px 18px',
                    backgroundColor: 'rgba(243, 240, 233, 0.6)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    cursor: 'pointer',
                    userSelect: 'none'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                    <span className="text-micro-data" style={{ fontWeight: '600', color: 'var(--color-obsidian-100)' }}>
                      Q{idx + 1}
                    </span>
                    <span className="text-body" style={{ fontWeight: '500', fontSize: '13.5px' }}>
                      {qa.topic}
                    </span>
                    <span className="tag-nude" style={{ fontSize: '11px', borderRadius: '6px' }}>
                      {qa.difficulty}
                    </span>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    {typeof verdict.score === 'number' ? (
                      <span className="tag-ivory" style={{ fontWeight: '600', fontSize: '11px', borderRadius: '6px' }}>
                        SCORE: {verdict.score}/10
                      </span>
                    ) : (
                      <span className="tag-ivory" style={{ fontSize: '11px', borderRadius: '6px', opacity: 0.7 }}>
                        {hasAnswer ? 'EVALUATED' : 'UNANSWERED'}
                      </span>
                    )}
                    {isExpanded ? <ChevronUp size={15} color="var(--color-text-secondary)" /> : <ChevronDown size={15} color="var(--color-text-secondary)" />}
                  </div>
                </div>

                {/* Accordion Expanded Content */}
                {isExpanded && (
                  <div style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
                    {/* Question Bubble */}
                    <div style={{
                      padding: '14px 16px',
                      borderRadius: '14px 14px 14px 4px',
                      backgroundColor: 'rgba(255, 255, 255, 0.9)',
                      border: '1px solid rgba(255, 255, 255, 0.95)',
                      boxShadow: '0 4px 12px rgba(16, 16, 16, 0.04)'
                    }}>
                      <span className="text-caption" style={{ display: 'block', marginBottom: '4px', fontWeight: '500', color: 'var(--color-text-secondary)' }}>
                        Interviewer
                      </span>
                      <p className="text-body" style={{ fontSize: '14px', lineHeight: '1.6', margin: 0 }}>
                        {qa.question_text}
                      </p>
                    </div>

                    {/* Candidate Response Bubble */}
                    <div style={{
                      padding: '14px 16px',
                      borderRadius: '14px 14px 4px 14px',
                      backgroundColor: 'var(--color-ivory)',
                      border: '1px solid var(--color-border)',
                      alignSelf: 'flex-end',
                      width: '95%'
                    }}>
                      <span className="text-caption" style={{ display: 'block', marginBottom: '4px', fontWeight: '500', color: 'var(--color-text-secondary)' }}>
                        Candidate Response
                      </span>
                      <p className="text-body" style={{ fontSize: '13.5px', lineHeight: '1.6', margin: 0, whiteSpace: 'pre-wrap', fontStyle: hasAnswer ? 'normal' : 'italic', color: hasAnswer ? 'var(--color-text)' : 'var(--color-text-muted)' }}>
                        {qa.answer_text || 'No response recorded (ended early).'}
                      </p>
                    </div>

                    {/* Judge Assessment */}
                    {verdict.feedback && (
                      <div style={{
                        padding: '14px',
                        backgroundColor: 'rgba(243, 240, 233, 0.4)',
                        borderRadius: '12px',
                        border: '1px solid var(--color-border)'
                      }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px', flexWrap: 'wrap', gap: '6px' }}>
                          <span className="text-caption" style={{ fontWeight: '600', color: 'var(--color-text)' }}>
                            Judge Assessment
                          </span>
                          <div style={{ display: 'flex', gap: '6px' }}>
                            {verdict.depth && <span className="tag-nude" style={{ fontSize: '10.5px' }}>DEPTH: {verdict.depth.toUpperCase()}</span>}
                            {verdict.correctness && <span className="tag-ivory" style={{ fontSize: '10.5px' }}>CORRECT: {verdict.correctness.toUpperCase()}</span>}
                          </div>
                        </div>
                        <p className="text-body" style={{ fontSize: '13px', lineHeight: '1.5', margin: 0 }}>
                          {verdict.feedback}
                        </p>
                      </div>
                    )}

                    {/* Grounding literature inspect button */}
                    {qa.source_chunks && qa.source_chunks.length > 0 && (
                      <div>
                        <button
                          type="button"
                          className="btn-liquid-glass"
                          onClick={() => setSelectedQAForTrace(qa)}
                          style={{
                            padding: '6px 14px',
                            fontSize: '12px',
                            borderRadius: '8px',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '6px'
                          }}
                        >
                          <BookOpen size={13} />
                          <span>Inspect {qa.source_chunks.length} reference literature chunks</span>
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Reset / Start New Screening Action ── */}
      <div style={{ marginTop: '8px', display: 'flex', justifyContent: 'center' }}>
        <button
          onClick={onReset}
          className="btn-liquid-glass"
          style={{
            width: '100%',
            maxWidth: '380px',
            padding: '14px 28px',
            fontSize: '14.5px',
            borderRadius: '12px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px'
          }}
        >
          <span>Begin New Candidate Screening</span>
          <ArrowRight size={15} />
        </button>
      </div>

      {/* ── Traceability Modal ── */}
      <TraceabilityModal
        isOpen={!!selectedQAForTrace}
        onClose={() => setSelectedQAForTrace(null)}
        question={selectedQAForTrace}
        chunks={selectedQAForTrace?.source_chunks}
      />
    </div>
  );
}

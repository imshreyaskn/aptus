// File: frontend/src\components\SetupScreen.jsx

import React, { useState } from 'react';
import { AlertCircle, ArrowLeft, ArrowRight, Upload, Check, FileText } from 'lucide-react';

const ROLES = [
  {
    id: 'AI/ML Engineer',
    title: 'AI/ML Engineer',
    book: "Tom Mitchell's ML + Hundred-Page ML Book"
  },
  {
    id: 'Data Science / Applied ML',
    title: 'Data Science / Applied ML',
    book: 'Introduction to ML with Python'
  },
  {
    id: 'Backend Engineer',
    title: 'Backend Engineer',
    book: 'Distributed Systems & Architecture Corpus'
  }
];

const getSampleResume = (name) => `${name || 'Candidate'} | Senior AI/ML Engineer
${(name || 'candidate').toLowerCase()}@example.com | San Francisco, CA

PROFESSIONAL SUMMARY
Machine Learning Engineer with 5+ years of experience designing and deploying large-scale deep learning models, RAG systems, and high-throughput inference pipelines. Strong background in loss function optimization, transformer architectures, and PyTorch.

TECHNICAL SKILLS
- Languages: Python, C++, SQL
- Frameworks: PyTorch, JAX, HuggingFace Transformers, LangChain, FAISS
- Core Concepts: Backpropagation, Optimization (AdamW, SGD), Regularization, Distributed Training
- Infrastructure: Docker, Kubernetes, Triton Inference Server, AWS SageMaker

EXPERIENCE
Senior ML Engineer — Apex AI (2022 - Present)
- Architected vector search and RAG retrieval pipelines reducing query latency by 40%.
- Fine-tuned transformer models for domain-specific classification and reasoning tasks.
- Implemented custom loss functions and learning rate schedulers to mitigate vanishing gradients.`;

const NAME_REGEX = /^[A-Za-z]+$/;

/**
 * SetupScreen component
 * Allows candidate track selection and resume ingestion (PDF upload or raw text paste).
 * 
 * @param {Object} props
 * @param {string} props.candidateName - Official candidate name
 * @param {string} props.selectedRole - Currently selected track
 * @param {Function} props.onSelectRole - Callback when role changes
 * @param {Function} props.onStartInterview - Callback to initiate interview session
 * @param {Function} props.onBack - Callback to return to landing screen
 * @param {boolean} props.isStarting - Loading state during session initialization
 */
export default function SetupScreen({
  candidateName,
  selectedRole,
  onSelectRole,
  onStartInterview,
  onBack,
  isStarting
}) {
  const [role, setRole] = useState(selectedRole || ROLES[0].id);
  const [inputMode, setInputMode] = useState('paste'); // 'paste' | 'upload'
  const [resumeText, setResumeText] = useState(() => getSampleResume(candidateName));
  const [resumeFile, setResumeFile] = useState(null);
  const [isFocused, setIsFocused] = useState(false);
  const [error, setError] = useState(null);

  const charCount = resumeText.length;
  const wordCount = resumeText.trim() ? resumeText.trim().split(/\s+/).length : 0;

  const handleRoleChange = (newRole) => {
    setRole(newRole);
    onSelectRole?.(newRole);
    console.log(`[Aptus Setup] Track selected: ${newRole}`);
  };

  const handleFileChange = (e) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setResumeFile(file);
      console.log(`[Aptus Setup] Resume file selected: "${file.name}" (${(file.size / 1024).toFixed(1)} KB)`);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);

    const activeName = (candidateName || 'Candidate').trim();
    if (!NAME_REGEX.test(activeName)) {
      const msg = 'Candidate name must contain only letters (no numbers or spaces).';
      setError(msg);
      console.warn(`[Aptus Setup] Name validation failed: "${activeName}" does not match /^[A-Za-z]+$/`);
      return;
    }

    if (inputMode === 'upload' && !resumeFile) {
      setError('Select a resume PDF file before continuing.');
      return;
    }
    if (inputMode === 'paste' && !resumeText.trim()) {
      setError('Enter candidate resume text.');
      return;
    }

    console.log(`[Aptus Setup] Initiating Begin Session:`, {
      name: activeName,
      role,
      inputMode,
      file: resumeFile?.name || null,
      textLength: inputMode === 'paste' ? resumeText.length : null
    });

    try {
      await onStartInterview({
        name: activeName,
        role: role,
        resumeText: inputMode === 'paste' ? resumeText : null,
        resumeFile: inputMode === 'upload' ? resumeFile : null,
      });
      console.log(`[Aptus Setup] Session successfully initialized!`);
    } catch (err) {
      console.error(`[Aptus Setup] Begin Session failed:`, err);
      setError(err.message || 'Failed to start interview');
    }
  };

  return (
    <div style={{
      width: 'min(1140px, calc(100vw - 64px))',
      margin: '0 auto',
      padding: '36px 0 64px',
      boxSizing: 'border-box',
      display: 'flex',
      flexDirection: 'column'
    }}>
      {/* Top Bar: Back Button */}
      <div style={{
        display: 'flex',
        justifyContent: 'flex-start',
        alignItems: 'center',
        marginBottom: '28px'
      }}>
        <button
          type="button"
          onClick={onBack}
          className="btn-ghost"
          style={{
            padding: '6px 12px',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            fontSize: '13px',
            borderRadius: '8px'
          }}
        >
          <ArrowLeft size={14} />
          <span>Back</span>
        </button>
      </div>

      {/* Header Section */}
      <div style={{ marginBottom: '36px', textAlign: 'left' }}>
        <h1 className="text-wordmark" style={{ fontSize: '40px', lineHeight: '1.1', marginBottom: '8px', letterSpacing: '-0.02em' }}>
          Configure session
        </h1>
        <p className="text-body" style={{ fontSize: '14.5px', color: 'var(--color-text-secondary)', margin: 0 }}>
          Select your track and attach candidate experience.
        </p>
      </div>

      {error && (
        <div style={{
          backgroundColor: 'var(--color-ivory)',
          borderLeft: '2px solid var(--color-obsidian-100)',
          padding: '10px 14px',
          marginBottom: '24px',
          width: '100%',
          textAlign: 'left',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          boxSizing: 'border-box'
        }}>
          <AlertCircle size={15} color="var(--color-text)" />
          <span className="text-body" style={{ fontSize: '13px' }}>{error}</span>
        </div>
      )}

      {/* Main Workspace Grid (40% Target Track / 60% Candidate Background) */}
      <form onSubmit={handleSubmit} style={{ width: '100%', display: 'flex', flexDirection: 'column' }}>
        <div style={{
          width: '100%',
          display: 'grid',
          gridTemplateColumns: 'minmax(300px, 38%) 1fr',
          gap: '40px',
          alignItems: 'stretch',
          marginBottom: '40px',
          textAlign: 'left'
        }}>
          {/* Left Column: Target Track (Tighter Vertical Density ~68px per item) */}
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              marginBottom: '14px',
              paddingBottom: '8px',
              borderBottom: '1px solid var(--color-border)'
            }}>
              <span style={{
                fontSize: '11px',
                fontWeight: '600',
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
                color: 'var(--color-text)'
              }}>
                Target Track
              </span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {ROLES.map((r) => {
                const isSelected = role === r.id;
                return (
                  <div
                    key={r.id}
                    onClick={() => handleRoleChange(r.id)}
                    style={{
                      padding: '12px 16px',
                      minHeight: '64px',
                      cursor: 'pointer',
                      borderLeft: isSelected
                        ? '2px solid var(--color-obsidian-100)'
                        : '1.5px solid var(--color-border)',
                      backgroundColor: isSelected ? 'var(--color-ivory)' : 'transparent',
                      borderRadius: '0 8px 8px 0',
                      transition: 'all 140ms ease-out',
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'center',
                      boxSizing: 'border-box'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2px' }}>
                      <span style={{ fontSize: '14.5px', fontWeight: isSelected ? '500' : '400', color: 'var(--color-text)' }}>
                        {r.title}
                      </span>
                      {isSelected && (
                        <Check size={14} color="var(--color-obsidian-100)" strokeWidth={2.5} />
                      )}
                    </div>
                    <span className="text-caption" style={{ fontSize: '11.5px', color: 'var(--color-text-secondary)', lineHeight: '1.3' }}>
                      {r.book}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Right Column: Candidate Background */}
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '14px',
              paddingBottom: '8px',
              borderBottom: '1px solid var(--color-border)'
            }}>
              <span style={{
                fontSize: '11px',
                fontWeight: '600',
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
                color: 'var(--color-text)'
              }}>
                Candidate Background
              </span>
              <div style={{ display: 'flex', gap: '16px' }}>
                <button
                  type="button"
                  onClick={() => setInputMode('paste')}
                  style={{
                    background: 'none',
                    border: 'none',
                    fontSize: '12px',
                    fontFamily: 'var(--font-sans)',
                    color: inputMode === 'paste' ? 'var(--color-obsidian-100)' : 'var(--color-text-muted)',
                    fontWeight: inputMode === 'paste' ? '500' : '400',
                    cursor: 'pointer',
                    padding: '0 0 2px 0',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '5px',
                    borderBottom: inputMode === 'paste' ? '1.5px solid var(--color-obsidian-100)' : '1.5px solid transparent',
                    transition: 'all 120ms ease-out'
                  }}
                >
                  <FileText size={12.5} strokeWidth={1.75} />
                  <span>Paste text</span>
                </button>
                <button
                  type="button"
                  onClick={() => setInputMode('upload')}
                  style={{
                    background: 'none',
                    border: 'none',
                    fontSize: '12px',
                    fontFamily: 'var(--font-sans)',
                    color: inputMode === 'upload' ? 'var(--color-obsidian-100)' : 'var(--color-text-muted)',
                    fontWeight: inputMode === 'upload' ? '500' : '400',
                    cursor: 'pointer',
                    padding: '0 0 2px 0',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '5px',
                    borderBottom: inputMode === 'upload' ? '1.5px solid var(--color-obsidian-100)' : '1.5px solid transparent',
                    transition: 'all 120ms ease-out'
                  }}
                >
                  <Upload size={12.5} strokeWidth={1.75} />
                  <span>Upload PDF</span>
                </button>
              </div>
            </div>

            {/* Editor Area with Defined Bottom (minHeight 300px) */}
            <div style={{
              flex: 1,
              minHeight: '300px',
              display: 'flex',
              flexDirection: 'column',
              borderLeft: isFocused || (inputMode === 'upload' && resumeFile)
                ? '2px solid var(--color-obsidian-100)'
                : '1.5px solid var(--color-border)',
              padding: '6px 4px 6px 16px',
              boxSizing: 'border-box',
              transition: 'border-color 150ms ease-out'
            }}>
              {inputMode === 'paste' ? (
                <>
                  <textarea
                    rows={10}
                    value={resumeText}
                    onChange={(e) => setResumeText(e.target.value)}
                    onFocus={() => setIsFocused(true)}
                    onBlur={() => setIsFocused(false)}
                    placeholder="Paste candidate resume content here..."
                    style={{
                      flex: 1,
                      width: '100%',
                      minHeight: '235px',
                      boxSizing: 'border-box',
                      resize: 'none',
                      background: 'transparent',
                      border: 'none',
                      outline: 'none',
                      fontSize: '13px',
                      fontFamily: 'var(--font-mono)',
                      lineHeight: '1.6',
                      color: 'var(--color-text)',
                      whiteSpace: 'pre-wrap'
                    }}
                  />
                  <div style={{
                    display: 'flex',
                    justifyContent: 'flex-end',
                    alignItems: 'center',
                    paddingTop: '8px',
                    marginTop: 'auto',
                    borderTop: '1px solid var(--color-border)'
                  }}>
                    <span className="text-micro-data" style={{ color: 'var(--color-text-secondary)' }}>
                      {charCount.toLocaleString()} characters · {wordCount.toLocaleString()} words
                    </span>
                  </div>
                </>
              ) : (
                <div style={{
                  flex: 1,
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'center',
                  alignItems: 'flex-start',
                  gap: '14px',
                  padding: '24px 0'
                }}>
                  <input
                    id="resume-pdf-upload"
                    type="file"
                    accept=".pdf,.txt"
                    style={{ display: 'none' }}
                    onChange={handleFileChange}
                  />
                  <button
                    type="button"
                    className="btn-subtle"
                    onClick={() => document.getElementById('resume-pdf-upload').click()}
                    style={{ padding: '8px 16px', display: 'inline-flex', alignItems: 'center', gap: '8px', borderRadius: '8px' }}
                  >
                    <Upload size={14} />
                    <span>{resumeFile ? 'Change selected file' : 'Select PDF / TXT document'}</span>
                  </button>
                  {resumeFile ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <Check size={14} color="var(--color-obsidian-100)" />
                      <span className="text-micro-data" style={{ fontWeight: '500' }}>
                        {resumeFile.name} ({(resumeFile.size / 1024).toFixed(1)} KB)
                      </span>
                    </div>
                  ) : (
                    <p className="text-caption" style={{ color: 'var(--color-text-secondary)', margin: 0 }}>
                      Upload candidate resume PDF to ground the technical trajectory.
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Bottom Action Bar */}
        <div style={{
          paddingTop: '20px',
          borderTop: '1px solid var(--color-border)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          textAlign: 'left'
        }}>
          <div>
            <span className="text-caption" style={{ fontWeight: '500', color: 'var(--color-text)', display: 'block' }}>
              Session ready
            </span>
            <span className="text-micro-data" style={{ color: 'var(--color-text-secondary)' }}>
              {role} · {inputMode === 'upload' && resumeFile ? `${resumeFile.name}` : `${wordCount} words attached`}
            </span>
          </div>

          <button
            type="submit"
            disabled={isStarting}
            className="btn-liquid-glass"
            style={{
              width: 'auto',
              minWidth: '180px',
              height: '44px',
              padding: '0 24px',
              fontSize: '14.5px',
              whiteSpace: 'nowrap',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px'
            }}
          >
            <span style={{ whiteSpace: 'nowrap' }}>{isStarting ? 'Synthesizing plan...' : 'Begin Session'}</span>
            {!isStarting && <ArrowRight size={15} style={{ flexShrink: 0 }} />}
          </button>
        </div>
      </form>
    </div>
  );
}

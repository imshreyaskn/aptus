// File: frontend/src\components\LandingScreen.jsx

import React, { useState, useEffect } from 'react';

const CATCHPHRASES = [
  "Interviews designed by people who hate bad interviews.",
  "Talk systems with an interviewer that actually did the reading.",
  "Less whiteboard cosplay. More actual engineering.",
  "No trick questions. Just the stuff that actually breaks in production.",
  "Skip the theater. Show how you build."
];

const NAME_REGEX = /^[A-Za-z]+$/;

export default function LandingScreen({ onGetStarted }) {
  const [name, setName] = useState('');
  const [error, setError] = useState(null);
  const [isFocused, setIsFocused] = useState(false);
  const [phraseIndex, setPhraseIndex] = useState(0);
  const [isFading, setIsFading] = useState(false);

  useEffect(() => {
    // 5.2s interval for relaxed readability
    const interval = setInterval(() => {
      setIsFading(true);
      setTimeout(() => {
        setPhraseIndex((prev) => (prev + 1) % CATCHPHRASES.length);
        setIsFading(false);
      }, 250);
    }, 5200);

    return () => clearInterval(interval);
  }, []);

  const handleSubmit = (e) => {
    e.preventDefault();
    setError(null);
    const trimmed = name.trim();

    if (!trimmed) {
      setError('Please enter your name.');
      return;
    }

    if (!NAME_REGEX.test(trimmed)) {
      setError('Name must contain only letters (no numbers or spaces).');
      return;
    }

    console.log(`[Aptus Landing] Candidate name entered: "${trimmed}"`);
    onGetStarted(trimmed);
  };

  return (
    <div style={{
      minHeight: '80vh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '0 24px',
      textAlign: 'center'
    }}>
      {/* Title & Cycling Catchphrase (64px gap) */}
      <div style={{ marginBottom: '64px' }}>
        <h1 className="text-wordmark" style={{ fontSize: '64px', marginBottom: '0px', lineHeight: '1.0', letterSpacing: '-0.02em' }}>
          Aptus
        </h1>
        <div style={{ height: '24px', display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: '4px' }}>
          <p
            className="text-body"
            style={{
              color: 'var(--color-text-secondary)',
              maxWidth: '460px',
              margin: '0 auto',
              opacity: isFading ? 0 : 1,
              transform: isFading ? 'translateY(2px)' : 'translateY(0)',
              transition: 'opacity 250ms ease-out, transform 250ms ease-out'
            }}
          >
            {CATCHPHRASES[phraseIndex]}
          </p>
        </div>
      </div>

      {/* Borderless Entry (No outer bounding box) */}
      <form
        onSubmit={handleSubmit}
        style={{
          width: '100%',
          maxWidth: '360px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '12px'
        }}
      >
        <div style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: '16px'
        }}>
          <input
            type="text"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (error) setError(null);
            }}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            placeholder="what should we call you?"
            style={{
              flex: 1,
              background: 'transparent',
              border: 'none',
              borderLeft: error
                ? '1.5px solid #d9383a'
                : isFocused
                ? '1.5px solid var(--color-obsidian-100)'
                : '1.5px solid var(--color-border)',
              outline: 'none',
              fontSize: '14px',
              fontFamily: 'var(--font-sans)',
              color: 'var(--color-text)',
              padding: '6px 2px 6px 12px',
              textAlign: 'left',
              transition: 'border-color 150ms ease-out'
            }}
          />

          <button
            type="submit"
            className="btn-liquid-glass"
            style={{
              padding: '8px 20px',
              fontSize: '13.5px',
              borderRadius: '10px',
              flexShrink: 0
            }}
          >
            Let's go
          </button>
        </div>

        {error && (
          <span className="text-micro-data" style={{ color: '#d9383a', textAlign: 'left', alignSelf: 'flex-start', paddingLeft: '4px' }}>
            {error}
          </span>
        )}
      </form>
    </div>
  );
}

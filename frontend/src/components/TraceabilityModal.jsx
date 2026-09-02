import React from 'react';
import { X, Bookmark, BookOpen } from 'lucide-react';

export default function TraceabilityModal({ isOpen, onClose, question, chunks }) {
  if (!isOpen) return null;

  const displayChunks = chunks && chunks.length > 0 
    ? chunks 
    : (question?.source_chunk_ids || []);

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(16, 16, 16, 0.4)',
      backdropFilter: 'blur(16px)',
      WebkitBackdropFilter: 'blur(16px)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000,
      padding: '20px'
    }}>
      <div style={{
        backgroundColor: 'var(--color-base)',
        width: '100%',
        maxWidth: '720px',
        maxHeight: '85vh',
        display: 'flex',
        flexDirection: 'column',
        border: '1px solid var(--color-border)',
        borderRadius: '20px',
        boxShadow: '0 24px 48px -12px rgba(16, 16, 16, 0.2)',
        overflow: 'hidden'
      }}>
        {/* Modal Header */}
        <div style={{
          padding: '20px 24px',
          borderBottom: '1px solid var(--color-border)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          backgroundColor: 'rgba(243, 240, 233, 0.5)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <BookOpen size={18} color="var(--color-obsidian-100)" />
            <div>
              <h2 className="text-h2" style={{ fontSize: '18px', margin: 0 }}>
                Literature Grounding
              </h2>
              <p className="text-caption" style={{ margin: 0 }}>
                Source textbook excerpts retrieved via FAISS vector similarity
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--color-text-secondary)',
              cursor: 'pointer',
              padding: '6px',
              borderRadius: '8px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Modal Body */}
        <div style={{ padding: '24px', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {/* Question Summary */}
          <div style={{
            backgroundColor: 'var(--color-ivory)',
            padding: '16px 18px',
            borderRadius: '14px',
            border: '1px solid var(--color-border)'
          }}>
            <span className="text-caption" style={{ display: 'block', marginBottom: '4px', fontWeight: '500' }}>
              Target Question
            </span>
            <p className="text-body" style={{ fontWeight: '500', fontSize: '14px', margin: 0 }}>
              {question?.question_text || question?.question}
            </p>
          </div>

          {/* Retrieved Chunks List */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span className="text-caption" style={{ fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Retrieved Passages ({displayChunks.length})
              </span>
            </div>

            {displayChunks.length === 0 ? (
              <p className="text-caption" style={{ fontStyle: 'italic' }}>No source chunks attached.</p>
            ) : (
              displayChunks.map((chunk, idx) => {
                const isObj = typeof chunk === 'object' && chunk !== null;
                const chunkId = isObj ? (chunk.chunk_id || `chunk_${idx}`) : chunk;
                const docTitle = isObj ? (chunk.doc_title || chunk.book || 'Technical Reference') : 'Textbook Reference';
                const section = isObj ? (chunk.section || 'Core Fundamentals') : 'Section Overview';
                const text = isObj ? (chunk.text || chunk.excerpt || 'Context passage') : '';
                const score = isObj && chunk.score ? (chunk.score * 100).toFixed(1) + '%' : null;

                return (
                  <div
                    key={idx}
                    style={{
                      border: '1px solid var(--color-border)',
                      borderRadius: '14px',
                      padding: '16px 18px',
                      backgroundColor: 'rgba(255, 255, 255, 0.75)'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', flexWrap: 'wrap', gap: '8px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span className="tag-nude" style={{ fontSize: '11px', borderRadius: '6px' }}>
                          {chunkId}
                        </span>
                        <span className="text-body-s" style={{ fontWeight: '600' }}>
                          {docTitle}
                        </span>
                      </div>
                      {score && (
                        <span className="tag-ivory" style={{ fontSize: '11px', borderRadius: '6px' }}>
                          SIM: {score}
                        </span>
                      )}
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '10px' }}>
                      <Bookmark size={12} color="var(--color-text-secondary)" />
                      <span className="text-micro-data" style={{ color: 'var(--color-text-secondary)' }}>
                        {section}
                      </span>
                    </div>

                    {text && (
                      <div style={{
                        backgroundColor: 'var(--color-ivory)',
                        borderLeft: '2.5px solid var(--color-obsidian-100)',
                        borderRadius: '0 8px 8px 0',
                        padding: '12px 14px'
                      }}>
                        <p className="text-body" style={{ fontSize: '13px', lineHeight: '1.6', margin: 0 }}>
                          {text}
                        </p>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Modal Footer */}
        <div style={{
          padding: '16px 24px',
          borderTop: '1px solid var(--color-border)',
          display: 'flex',
          justifyContent: 'flex-end',
          backgroundColor: 'rgba(243, 240, 233, 0.4)'
        }}>
          <button
            onClick={onClose}
            className="btn-liquid-glass"
            style={{
              padding: '8px 20px',
              fontSize: '13px',
              borderRadius: '10px'
            }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

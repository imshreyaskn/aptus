/**
 * Aptus Frontend API Client
 * Type-annotated async HTTP client communicating with FastAPI backend endpoints.
 */

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api';

/**
 * Helper to unwrap JSON error messages from FastAPI responses.
 * @param {Response} res
 * @param {string} fallbackMsg
 * @returns {Promise<Error>}
 */
async function createApiError(res, fallbackMsg) {
  const errorData = await res.json().catch(() => ({}));
  const message = errorData.detail || errorData.message || fallbackMsg;
  const err = new Error(message);
  err.status = res.status;
  return err;
}

/**
 * Checks system health and supported roles.
 * @returns {Promise<{ status: string, timestamp: string, gemini_model: string, roles: string[] }>}
 */
export async function checkHealth() {
  const res = await fetch(`${API_BASE_URL}/health`);
  if (!res.ok) throw await createApiError(res, 'Health check failed');
  return res.json();
}

/**
 * Fetches list of available screening domain tracks.
 * @returns {Promise<{ roles: string[], description: string }>}
 */
export async function fetchRoles() {
  const res = await fetch(`${API_BASE_URL}/roles`);
  if (!res.ok) throw await createApiError(res, 'Failed to fetch roles');
  return res.json();
}

/**
 * Initializes a new interview screening session.
 * @param {Object} params
 * @param {string} params.name - Candidate name (letters only)
 * @param {string} params.role - Target role title
 * @param {string|null} [params.resumeText] - Raw pasted resume text
 * @param {File|null} [params.resumeFile] - Uploaded PDF resume file
 * @returns {Promise<Object>} StartInterviewResponse
 */
export async function startInterview({ name, role, resumeText, resumeFile }) {
  const formData = new FormData();
  formData.append('name', name || 'Candidate');
  formData.append('role', role);
  if (resumeText) {
    formData.append('resume_text', resumeText);
  }
  if (resumeFile) {
    formData.append('resume_file', resumeFile);
  }

  const res = await fetch(`${API_BASE_URL}/sessions/start`, {
    method: 'POST',
    body: formData,
  });

  if (!res.ok) {
    throw await createApiError(res, 'Failed to start interview session');
  }

  return res.json();
}

/**
 * Retrieves the next question or completion status for an active session.
 * @param {string} sessionId
 * @returns {Promise<Object>} NextQuestionResponse
 */
export async function getNextQuestion(sessionId) {
  const res = await fetch(`${API_BASE_URL}/sessions/${sessionId}/next-question`);
  if (!res.ok) {
    throw await createApiError(res, 'Failed to fetch next question');
  }
  return res.json();
}

/**
 * Submits a candidate answer for real-time evaluation and next-question generation.
 * @param {string} sessionId
 * @param {string} questionId
 * @param {string} answerText
 * @param {AbortSignal} [signal] - Optional abort signal
 * @returns {Promise<Object>} SubmitAnswerResponse
 */
export async function submitAnswer(sessionId, questionId, answerText, signal) {
  const res = await fetch(`${API_BASE_URL}/sessions/${sessionId}/answer`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      question_id: questionId,
      answer_text: answerText,
    }),
    signal,
  });

  if (!res.ok) {
    throw await createApiError(res, 'Failed to submit answer');
  }

  return res.json();
}

/**
 * Explicitly terminates an interview session and triggers executive evaluation synthesis.
 * @param {string} sessionId
 * @returns {Promise<Object>} SessionSummaryResponse
 */
export async function endSession(sessionId) {
  const res = await fetch(`${API_BASE_URL}/sessions/${sessionId}/end`, {
    method: 'POST',
  });
  if (!res.ok) {
    throw await createApiError(res, 'Failed to end session');
  }
  return res.json();
}

/**
 * Fetches the executive evaluation report for a completed session.
 * @param {string} sessionId
 * @returns {Promise<Object>} SessionSummaryResponse
 */
export async function getSessionSummary(sessionId) {
  const res = await fetch(`${API_BASE_URL}/sessions/${sessionId}/summary`);
  if (!res.ok) {
    throw await createApiError(res, 'Failed to fetch summary');
  }
  return res.json();
}

/**
 * Synthesizes natural speech using Google Cloud TTS.
 * @param {string} text - Text to synthesize
 * @param {string} [languageCode='en-US'] - Language code
 * @returns {Promise<Blob>} Audio blob (MP3)
 */
export async function synthesizeSpeech(text, languageCode = 'en-US') {
  const res = await fetch(`${API_BASE_URL}/tts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, language_code: languageCode }),
  });
  if (!res.ok) {
    throw await createApiError(res, 'TTS synthesis failed');
  }
  return res.blob();
}

/**
 * Transcribes audio recording using backend Groq Whisper STT API.
 * @param {Blob} audioBlob - Recorded audio blob
 * @param {string} [language='en'] - Language code
 * @returns {Promise<{ text: string, confidence: number, segments: Array }>}
 */
export async function transcribeAudio(audioBlob, language = 'en') {
  const formData = new FormData();
  formData.append('audio', audioBlob, 'recording.webm');
  formData.append('language', language);

  const res = await fetch(`${API_BASE_URL}/stt`, {
    method: 'POST',
    body: formData,
  });
  if (!res.ok) {
    throw await createApiError(res, 'STT transcription failed');
  }
  return res.json();
}

/**
 * Fetches full Q&A transcript with judge verdicts and literature chunk traceability.
 * @param {string} sessionId
 * @returns {Promise<Object>} SessionHistoryResponse
 */
export async function getSessionHistory(sessionId) {
  const res = await fetch(`${API_BASE_URL}/sessions/${sessionId}/history`);
  if (!res.ok) {
    throw await createApiError(res, 'Failed to fetch history');
  }
  return res.json();
}



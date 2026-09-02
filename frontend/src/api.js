/**
 * Aptus API boundary.
 *
 * Design principles:
 * - One request primitive for consistent errors/timeouts.
 * - Abort is always supported for mutable interview operations.
 * - No service-specific error parsing leaks into UI code.
 * - Secrets never belong in the browser bundle.
 */

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '/api').replace(/\/+$/, '');
const DEFAULT_TIMEOUT_MS = 30_000;

export class ApiError extends Error {
  constructor(message, { status = 0, code = 'UNKNOWN', details = null } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

async function parseResponseBody(response) {
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    return response.json().catch(() => null);
  }
  return response.text().catch(() => '');
}

async function request(path, {
  method = 'GET',
  body,
  headers = {},
  signal,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  retry = false,
} = {}) {
  const controller = new AbortController();
  let timeoutId;

  const abortFromCaller = () => controller.abort();
  signal?.addEventListener('abort', abortFromCaller, { once: true });

  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      body,
      headers,
      signal: controller.signal,
    });

    const payload = await parseResponseBody(response);

    if (!response.ok) {
      const detail = typeof payload === 'object' && payload
        ? (payload.detail || payload.message)
        : null;
      throw new ApiError(detail || `Request failed with status ${response.status}`, {
        status: response.status,
        code: response.headers.get('x-error-code') || 'HTTP_ERROR',
        details: payload,
      });
    }

    return payload;
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw error;
    }

    // Only GETs should ever be retried automatically. Interview mutations are not.
    if (retry && error instanceof TypeError) {
      return request(path, {
        method,
        body,
        headers,
        signal,
        timeoutMs,
        retry: false,
      });
    }

    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abortFromCaller);
  }
}

export async function checkHealth({ signal } = {}) {
  return request('/health', { signal, retry: true });
}

export async function fetchRoles({ signal } = {}) {
  return request('/roles', { signal, retry: true });
}

export async function startInterview({
  name,
  role,
  resumeText,
  resumeFile,
  signal,
}) {
  const formData = new FormData();
  formData.append('name', name || 'Candidate');
  formData.append('role', role);
  if (resumeText?.trim()) formData.append('resume_text', resumeText.trim());
  if (resumeFile) formData.append('resume_file', resumeFile);

  return request('/sessions/start', {
    method: 'POST',
    body: formData,
    signal,
    timeoutMs: 60_000,
  });
}

export async function getNextQuestion(sessionId, { signal } = {}) {
  return request(`/sessions/${encodeURIComponent(sessionId)}/next-question`, {
    signal,
    retry: true,
  });
}

export async function submitAnswer(sessionId, questionId, answerText, signal) {
  if (!sessionId || !questionId) {
    throw new ApiError('Missing session or question identifier.', { code: 'INVALID_ARGUMENT' });
  }
  if (!answerText?.trim()) {
    throw new ApiError('Answer cannot be empty.', { code: 'INVALID_ARGUMENT' });
  }

  return request(`/sessions/${encodeURIComponent(sessionId)}/answer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      question_id: questionId,
      answer_text: answerText.trim(),
    }),
    signal,
    timeoutMs: 60_000,
  });
}

export async function endSession(sessionId, { signal } = {}) {
  return request(`/sessions/${encodeURIComponent(sessionId)}/end`, {
    method: 'POST',
    signal,
    timeoutMs: 60_000,
  });
}

export async function getSessionSummary(sessionId, { signal } = {}) {
  return request(`/sessions/${encodeURIComponent(sessionId)}/summary`, {
    signal,
    retry: true,
  });
}

export async function synthesizeSpeech(text, languageCode = 'en-US', { signal } = {}) {
  if (!text?.trim()) throw new ApiError('TTS text cannot be empty.', { code: 'INVALID_ARGUMENT' });

  const response = await fetch(`${API_BASE_URL}/tts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: text.trim(), language_code: languageCode }),
    signal,
  });

  if (!response.ok) {
    const payload = await parseResponseBody(response);
    const detail = typeof payload === 'object' && payload
      ? (payload.detail || payload.message)
      : null;
    throw new ApiError(detail || `TTS failed with status ${response.status}`, {
      status: response.status,
      code: 'TTS_ERROR',
      details: payload,
    });
  }

  return response.blob();
}

export async function transcribeAudio(audioBlob, language = 'en', { signal } = {}) {
  if (!audioBlob?.size) {
    throw new ApiError('Audio recording is empty.', { code: 'EMPTY_AUDIO' });
  }

  const formData = new FormData();
  const type = audioBlob.type || 'audio/webm';
  const extension = type.includes('mp4') ? 'mp4' : type.includes('ogg') ? 'ogg' : 'webm';
  formData.append('audio', audioBlob, `recording.${extension}`);
  formData.append('language', language);

  return request('/stt', {
    method: 'POST',
    body: formData,
    signal,
    timeoutMs: 60_000,
  });
}

export async function getSessionHistory(sessionId, { signal } = {}) {
  return request(`/sessions/${encodeURIComponent(sessionId)}/history`, {
    signal,
    retry: true,
  });
}

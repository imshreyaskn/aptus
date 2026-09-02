import { transcribeAudio } from '../api';

const MIN_AUDIO_BYTES = 1_500;

function getRecorderMimeType() {
  if (typeof MediaRecorder === 'undefined') return '';
  return [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
  ].find((type) => MediaRecorder.isTypeSupported(type)) || '';
}

/**
 * Push-to-talk microphone controller.
 *
 * Contract:
 *   start() -> open microphone and collect audio
 *   stop()  -> finalize recording and return authoritative server transcript
 *
 * Browser SpeechRecognition is visualization-only. It never becomes the
 * authoritative answer source because browser implementations vary.
 */
export class VoiceListener {
  constructor(options = {}) {
    this.options = {
      lang: 'en-US',
      previewRecognition: true,
      ...options,
    };

    this.mediaStream = null;
    this.mediaRecorder = null;
    this.recognition = null;
    this.audioChunks = [];
    this.isRecording = false;
    this.interimTranscript = '';
    this.finalTranscript = '';
    this.hasSpoken = false;
    this._stopPromise = null;
    this._mimeType = 'audio/webm';

    this.onInterim = null;
    this.onFinal = null;
    this.onVolume = null;
    this.onError = null;
    this.onStart = null;
    this.onEnd = null;
  }

  static isSupported() {
    return typeof navigator !== 'undefined'
      && Boolean(navigator.mediaDevices?.getUserMedia)
      && typeof MediaRecorder !== 'undefined';
  }

  async start() {
    if (this.isRecording) return;

    if (!VoiceListener.isSupported()) {
      const error = new Error('Voice recording is not supported in this browser.');
      this.onError?.(error);
      throw error;
    }

    this._cleanup();
    this._resetTranscript();

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      this.mediaStream = stream;
      this._mimeType = getRecorderMimeType() || 'audio/webm';
      this.mediaRecorder = this._mimeType === 'audio/webm'
        ? new MediaRecorder(stream)
        : new MediaRecorder(stream, { mimeType: this._mimeType });

      this.mediaRecorder.addEventListener('dataavailable', (event) => {
        if (event.data?.size) this.audioChunks.push(event.data);
      });

      this.mediaRecorder.addEventListener('error', (event) => {
        this.onError?.(event.error || new Error('Audio recording failed.'));
      });

      this.mediaRecorder.start();
      this.isRecording = true;
      this.onStart?.();

      this._startPreviewRecognition();
      this._startVolumeMeter();
    } catch (error) {
      this._cleanup();
      this.onError?.(error);
      throw error;
    }
  }

  async stop() {
    if (this._stopPromise) return this._stopPromise;
    if (!this.isRecording) return this.finalTranscript.trim();

    this._stopPromise = this._stop();
    try {
      return await this._stopPromise;
    } finally {
      this._stopPromise = null;
    }
  }

  async _stop() {
    this.isRecording = false;
    this._stopPreviewRecognition();

    const recorder = this.mediaRecorder;
    if (recorder && recorder.state !== 'inactive') {
      await new Promise((resolve) => {
        const handleStop = () => {
          recorder.removeEventListener('stop', handleStop);
          resolve();
        };
        recorder.addEventListener('stop', handleStop, { once: true });
        try {
          recorder.stop();
        } catch {
          resolve();
        }
      });
    }

    const blob = this.audioChunks.length
      ? new Blob(this.audioChunks, { type: recorder?.mimeType || this._mimeType })
      : null;

    let authoritativeText = '';
    if (blob?.size >= MIN_AUDIO_BYTES) {
      try {
        const result = await transcribeAudio(
          blob,
          this.options.lang.split('-')[0] || 'en',
        );
        authoritativeText = result?.text?.trim() || '';
      } catch (error) {
        // Safe fallback: only use browser transcript when the server transcription
        // path itself failed. We still surface the failure to observability/UI.
        this.onError?.(error);
      }
    }

    const text = authoritativeText || this.finalTranscript.trim();

    this.mediaRecorder = null;
    this.audioChunks = [];
    this._cleanup();
    this.finalTranscript = text;
    this.interimTranscript = '';

    if (text) this.onFinal?.(text);
    this.onEnd?.();

    return text;
  }

  resetTranscript() {
    this._resetTranscript();
  }

  _resetTranscript() {
    this.interimTranscript = '';
    this.finalTranscript = '';
    this.hasSpoken = false;
    this.audioChunks = [];
  }

  _startPreviewRecognition() {
    if (!this.options.previewRecognition || typeof window === 'undefined') return;

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    try {
      const recognition = new SpeechRecognition();
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.lang = this.options.lang;

      recognition.onresult = (event) => {
        let finalText = '';
        let interimText = '';

        for (let i = 0; i < event.results.length; i += 1) {
          const result = event.results[i];
          const fragment = result?.[0]?.transcript || '';
          if (result.isFinal) finalText += `${fragment} `;
          else interimText += fragment;
        }

        this.finalTranscript = finalText.trim();
        this.interimTranscript = interimText.trim();
        const combined = `${this.finalTranscript} ${this.interimTranscript}`.trim();
        this.hasSpoken = Boolean(combined);

        if (combined) this.onInterim?.(combined);
      };

      recognition.onerror = () => {
        // Preview recognition is deliberately non-critical.
      };

      recognition.onend = () => {
        // Never restart automatically. The user owns microphone activation.
      };

      recognition.start();
      this.recognition = recognition;
    } catch {
      this.recognition = null;
    }
  }

  _stopPreviewRecognition() {
    if (!this.recognition) return;
    try { this.recognition.stop(); } catch {}
    this.recognition = null;
  }

  _startVolumeMeter() {
    if (!this.mediaStream || typeof window === 'undefined') return;

    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;

    try {
      const audioContext = new AudioContext();
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      const source = audioContext.createMediaStreamSource(this.mediaStream);
      source.connect(analyser);

      this.audioContext = audioContext;
      this.analyser = analyser;
      const data = new Uint8Array(analyser.frequencyBinCount);

      const tick = () => {
        if (!this.isRecording || !this.analyser) return;
        analyser.getByteFrequencyData(data);
        const average = data.reduce((sum, value) => sum + value, 0) / Math.max(1, data.length);
        const volume = Math.min(1, average / 128);
        if (volume > 0.05) this.hasSpoken = true;
        this.onVolume?.(volume);
        this.animationFrameId = requestAnimationFrame(tick);
      };

      this.animationFrameId = requestAnimationFrame(tick);
    } catch {
      // The volume meter is optional UI decoration.
    }
  }

  _cleanup() {
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }

    if (this.audioContext && this.audioContext.state !== 'closed') {
      this.audioContext.close().catch(() => {});
    }

    this.audioContext = null;
    this.analyser = null;
    this.onVolume?.(0);
  }
}

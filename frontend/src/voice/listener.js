// frontend/src/voice/listener.js
// Push-to-talk recorder. The button is the endpoint; no autonomous VAD is used.
import { transcribeAudio } from '../api';

export class VoiceListener {
  constructor(options = {}) {
    this.options = {
      lang: 'en-US',
      continuous: false,
      interimResults: true,
      autoVAD: false,
      ...options,
    };

    this.recognition = null;
    this.mediaStream = null;
    this.mediaRecorder = null;
    this.audioChunks = [];
    this.audioContext = null;
    this.analyser = null;
    this.animationFrameId = null;

    this.isRecording = false;
    this.interimTranscript = '';
    this.finalTranscript = '';
    this.hasSpoken = false;
    this._stopPromise = null;
    this._recordingMimeType = 'audio/webm';

    this.onInterim = null;
    this.onFinal = null;
    this.onVolume = null;
    this.onSilence = null; // retained for compatibility; never fired in PTT mode
    this.onError = null;
    this.onStart = null;
    this.onEnd = null;
  }

  static isSupported() {
    return typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia);
  }

  async start() {
    if (this.isRecording) return;

    this._cleanupAudioAnalyser();
    this._stopPreviewRecognition();
    this.resetTranscript();

    if (!VoiceListener.isSupported() || typeof MediaRecorder === 'undefined') {
      const err = new Error('Voice recording is not supported in this browser.');
      this.onError?.(err);
      throw err;
    }

    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      const candidates = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/mp4',
      ];
      const mimeType = candidates.find((type) => MediaRecorder.isTypeSupported(type)) || '';
      this._recordingMimeType = mimeType || 'audio/webm';
      this.mediaRecorder = mimeType
        ? new MediaRecorder(this.mediaStream, { mimeType })
        : new MediaRecorder(this.mediaStream);

      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data?.size) this.audioChunks.push(event.data);
      };

      this.mediaRecorder.onerror = (event) => {
        this.onError?.(event?.error || new Error('Audio recording failed.'));
      };

      this.mediaRecorder.start(250);
      this.isRecording = true;
      this.onStart?.();

      await this._startAudioAnalyser();
      this._startPreviewRecognition();

      console.log('[STT] Push-to-talk recording active.');
    } catch (err) {
      this._cleanupAudioAnalyser();
      this.isRecording = false;
      this.onError?.(err);
      throw err;
    }
  }

  async stop() {
    if (this._stopPromise) return this._stopPromise;
    if (!this.isRecording) return (this.finalTranscript || '').trim();

    this._stopPromise = this._stopInternal();
    try {
      return await this._stopPromise;
    } finally {
      this._stopPromise = null;
    }
  }

  async _stopInternal() {
    this.isRecording = false;
    this._stopPreviewRecognition();

    const recorder = this.mediaRecorder;
    const mimeType = recorder?.mimeType || this._recordingMimeType || 'audio/webm';

    if (recorder && recorder.state !== 'inactive') {
      await new Promise((resolve) => {
        const previousOnStop = recorder.onstop;
        recorder.onstop = (event) => {
          try { previousOnStop?.(event); } catch (_) {}
          resolve();
        };
        try {
          recorder.stop();
        } catch (_) {
          resolve();
        }
      });
    }

    let resultText = (this.finalTranscript || '').trim();
    const audioBlob = this.audioChunks.length
      ? new Blob(this.audioChunks, { type: mimeType })
      : null;

    if (audioBlob && audioBlob.size > 1500) {
      try {
        const sttData = await transcribeAudio(audioBlob, this.options.lang?.split('-')[0] || 'en');
        if (sttData?.text?.trim()) {
          resultText = sttData.text.trim();
        }
      } catch (err) {
        console.warn('[STT] Backend transcription failed; using browser preview transcript:', err);
      }
    }

    this.mediaRecorder = null;
    this.audioChunks = [];
    this._cleanupAudioAnalyser();
    this.onEnd?.();

    this.finalTranscript = resultText;
    this.interimTranscript = '';
    if (resultText) this.onFinal?.(resultText);
    return resultText;
  }

  resetTranscript() {
    this.interimTranscript = '';
    this.finalTranscript = '';
    this.audioChunks = [];
    this.hasSpoken = false;
  }

  _startPreviewRecognition() {
    const SpeechRec = typeof window !== 'undefined'
      ? (window.SpeechRecognition || window.webkitSpeechRecognition)
      : null;
    if (!SpeechRec) return;

    try {
      const recognition = new SpeechRec();
      recognition.continuous = this.options.continuous;
      recognition.interimResults = this.options.interimResults;
      recognition.lang = this.options.lang;

      recognition.onresult = (event) => {
        let finalStr = '';
        let interimStr = '';
        for (let i = 0; i < event.results.length; i += 1) {
          const item = event.results[i];
          const text = item?.[0]?.transcript || '';
          if (item.isFinal) finalStr += `${text} `;
          else interimStr += text;
        }

        this.finalTranscript = finalStr.trim();
        this.interimTranscript = interimStr.trim();
        const combined = `${this.finalTranscript} ${this.interimTranscript}`.trim();
        this.hasSpoken = Boolean(combined);
        if (combined) this.onInterim?.(combined);
      };

      recognition.onerror = (event) => {
        if (event?.error !== 'no-speech') {
          console.warn('[STT] Browser preview recognition:', event?.error || 'unknown error');
        }
      };

      recognition.onend = () => {
        // Browser preview is intentionally best-effort. Never restart automatically.
      };

      recognition.start();
      this.recognition = recognition;
    } catch (err) {
      console.warn('[STT] Browser preview unavailable; MediaRecorder remains authoritative.', err);
    }
  }

  _stopPreviewRecognition() {
    if (!this.recognition) return;
    try { this.recognition.stop(); } catch (_) {}
    this.recognition = null;
  }

  async _startAudioAnalyser() {
    try {
      if (!this.mediaStream || typeof window === 'undefined') return;
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;

      this.audioContext = new AudioCtx();
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 256;
      const source = this.audioContext.createMediaStreamSource(this.mediaStream);
      source.connect(this.analyser);

      const data = new Uint8Array(this.analyser.frequencyBinCount);
      const tick = () => {
        if (!this.isRecording || !this.analyser) return;
        this.analyser.getByteFrequencyData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i += 1) sum += data[i];
        const volume = Math.min(1, (sum / Math.max(1, data.length)) / 128);
        if (volume > 0.05) this.hasSpoken = true;
        this.onVolume?.(volume);
        this.animationFrameId = requestAnimationFrame(tick);
      };
      this.animationFrameId = requestAnimationFrame(tick);
    } catch (err) {
      console.warn('[STT] Audio analyser unavailable:', err);
    }
  }

  _cleanupAudioAnalyser() {
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    if (this.mediaStream) {
      for (const track of this.mediaStream.getTracks()) track.stop();
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

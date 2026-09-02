// frontend/src/voice/listener.js
// Native Web Speech API STT with AudioContext analyser, resource lifecycle management, and configurable silence/VAD detection.

export class VoiceListener {
  constructor(options = {}) {
    this.options = {
      lang: 'en-US',
      continuous: true,
      interimResults: true,
      silenceTimeoutMs: 2800, // auto-VAD silence detection threshold
      autoVAD: true,
      ...options
    };

    this.recognition = null;
    this.mediaStream = null;
    this.audioContext = null;
    this.analyser = null;
    this.animationFrameId = null;

    this.isRecording = false;
    this.interimTranscript = '';
    this.finalTranscript = '';
    this.silenceTimer = null;
    this.hasSpoken = false;

    // Callbacks
    this.onInterim = null;
    this.onFinal = null;
    this.onVolume = null;
    this.onSilence = null;
    this.onError = null;
    this.onStart = null;
    this.onEnd = null;
  }

  static isSupported() {
    return typeof window !== 'undefined' &&
      ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window);
  }

  async start() {
    if (this.isRecording) return;

    // Clean up any stale media streams or audio contexts before opening new ones
    this._cleanupAudioAnalyser();

    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRec) {
      const err = new Error('Web Speech API is not supported in this browser.');
      this.onError?.(err);
      throw err;
    }

    try {
      this.recognition = new SpeechRec();
      this.recognition.continuous = this.options.continuous;
      this.recognition.interimResults = this.options.interimResults;
      this.recognition.lang = this.options.lang;
      this.interimTranscript = '';
      this.hasSpoken = false;

      // Start microphone analyser for live volume levels
      await this._startAudioAnalyser();

      this.recognition.onstart = () => {
        this.isRecording = true;
        console.log('%c[STT] Listening active...', 'color: #10b981; font-weight: bold;');
        this.onStart?.();
      };

      this.recognition.onresult = (event) => {
        let finalStr = '';
        let interimStr = '';

        for (let i = 0; i < event.results.length; ++i) {
          const item = event.results[i];
          if (item.isFinal) {
            finalStr += item[0].transcript + ' ';
          } else {
            interimStr += item[0].transcript;
          }
        }

        this.finalTranscript = finalStr.trim();
        this.interimTranscript = interimStr.trim();
        this.hasSpoken = Boolean(this.finalTranscript || this.interimTranscript);

        const currentFull = (this.finalTranscript + (this.interimTranscript ? ' ' + this.interimTranscript : '')).trim();
        if (currentFull) {
          console.log(`%c[STT] Heard (${this.finalTranscript ? 'Final' : 'Interim'}): "${currentFull}"`, 'color: #06b6d4;');
        }
        this.onInterim?.(currentFull);

        if (this.finalTranscript) {
          console.log(`%c[STT] Finalized Turn: "${this.finalTranscript}"`, 'color: #3b82f6; font-weight: bold;');
          this.onFinal?.(this.finalTranscript);
        }

        // Reset silence timer on every new speech packet
        if (this.options.autoVAD && this.hasSpoken) {
          this._resetSilenceTimer();
        }
      };

      this.recognition.onerror = (event) => {
        // 'no-speech' is a normal timeout when waiting for user to speak
        if (event.error !== 'no-speech') {
          console.warn('[STT] Recognition event warning/error:', event.error);
          this.onError?.(event);
        }
      };

      this.recognition.onend = () => {
        console.log('%c[STT] Mic session ended', 'color: #94a3b8;');
        // If still flagged as recording, restart (keeps continuous listening alive)
        if (this.isRecording) {
          try {
            this.recognition.start();
          } catch (e) {
            this.isRecording = false;
            this.onEnd?.();
          }
        } else {
          this.onEnd?.();
        }
      };

      this.recognition.start();
    } catch (err) {
      console.error('[STT] Failed to start recognition or media stream:', err);
      this._cleanupAudioAnalyser();
      this.isRecording = false;
      this.onError?.(err);
      throw err;
    }
  }

  stop() {
    this.isRecording = false;
    this._clearSilenceTimer();

    if (this.recognition) {
      try {
        this.recognition.stop();
      } catch (e) {
        // ignore
      }
      this.recognition = null;
    }

    this._cleanupAudioAnalyser();
    this.onEnd?.();

    const fullTranscript = (this.finalTranscript + (this.interimTranscript ? ' ' + this.interimTranscript : '')).trim();
    return fullTranscript;
  }

  resetTranscript() {
    this.interimTranscript = '';
    this.finalTranscript = '';
    this.hasSpoken = false;
    this._clearSilenceTimer();
  }

  _resetSilenceTimer() {
    this._clearSilenceTimer();
    this.silenceTimer = setTimeout(() => {
      if (this.isRecording && this.hasSpoken) {
        const fullTranscript = (this.finalTranscript + (this.interimTranscript ? ' ' + this.interimTranscript : '')).trim();
        if (fullTranscript.length > 2) {
          this.onSilence?.(fullTranscript);
        }
      }
    }, this.options.silenceTimeoutMs);
  }

  _clearSilenceTimer() {
    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }
  }

  async _startAudioAnalyser() {
    try {
      if (!navigator.mediaDevices?.getUserMedia) return;
      this.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;

      this.audioContext = new AudioCtx();
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 256;
      const source = this.audioContext.createMediaStreamSource(this.mediaStream);
      source.connect(this.analyser);

      const bufferLength = this.analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      const updateVolume = () => {
        if (!this.isRecording || !this.analyser) return;

        this.analyser.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < bufferLength; i++) {
          sum += dataArray[i];
        }
        const avg = sum / bufferLength;
        const volume = Math.min(1.0, avg / 128); // Normalize 0.0 to 1.0

        this.onVolume?.(volume);
        this.animationFrameId = requestAnimationFrame(updateVolume);
      };

      this.animationFrameId = requestAnimationFrame(updateVolume);
    } catch (err) {
      console.warn('[STT] Mic volume analyser unavailable:', err);
    }
  }

  _cleanupAudioAnalyser() {
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(track => track.stop());
      this.mediaStream = null;
    }
    if (this.audioContext && this.audioContext.state !== 'closed') {
      this.audioContext.close().catch(() => {});
      this.audioContext = null;
    }
    this.analyser = null;
    this.onVolume?.(0);
  }
}

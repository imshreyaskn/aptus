// frontend/src/voice/listener.js
// Universal Voice Listener with MediaRecorder audio capture, Groq Whisper STT, and live visualizer.
import { transcribeAudio } from '../api';

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
    this.mediaRecorder = null;
    this.audioChunks = [];
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

  /**
   * Supported on ALL modern browsers with microphone access.
   */
  static isSupported() {
    return typeof navigator !== 'undefined' &&
      Boolean(navigator.mediaDevices?.getUserMedia);
  }

  async start() {
    if (this.isRecording) return;

    this._cleanupAudioAnalyser();
    this.audioChunks = [];
    this.interimTranscript = '';
    this.finalTranscript = '';
    this.hasSpoken = false;

    try {
      // 1. Capture microphone audio stream
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        }
      });

      // 2. Start MediaRecorder for backend Groq Whisper STT
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : (MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4');

      this.mediaRecorder = new MediaRecorder(this.mediaStream, { mimeType });
      this.audioChunks = [];

      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          this.audioChunks.push(event.data);
        }
      };

      this.mediaRecorder.start(250); // Slice into 250ms chunks

      // 3. Start AudioContext analyser for live volume visualizer
      await this._startAudioAnalyser();

      // 4. Optional parallel Web Speech API for live interim subtitle preview (if browser supports it)
      const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (SpeechRec) {
        try {
          this.recognition = new SpeechRec();
          this.recognition.continuous = this.options.continuous;
          this.recognition.interimResults = this.options.interimResults;
          this.recognition.lang = this.options.lang;

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
              console.log(`%c[STT] Interim preview: "${currentFull}"`, 'color: #06b6d4;');
              this.onInterim?.(currentFull);
            }

            if (this.options.autoVAD && this.hasSpoken) {
              this._resetSilenceTimer();
            }
          };

          this.recognition.onerror = (e) => {
            if (e.error !== 'no-speech') {
              console.warn('[STT] Browser recognition notice:', e.error);
            }
          };

          this.recognition.start();
        } catch (e) {
          console.warn('[STT] Browser SpeechRecognition unavailable, using pure MediaRecorder:', e);
        }
      }

      this.isRecording = true;
      console.log('%c[STT] Microphone recording active (Groq Whisper ready)...', 'color: #10b981; font-weight: bold;');
      this.onStart?.();

    } catch (err) {
      console.error('[STT] Failed to acquire microphone stream:', err);
      this._cleanupAudioAnalyser();
      this.isRecording = false;
      this.onError?.(err);
      throw err;
    }
  }

  async stop() {
    if (!this.isRecording) return this.finalTranscript;

    this.isRecording = false;
    this._clearSilenceTimer();

    if (this.recognition) {
      try {
        this.recognition.stop();
      } catch (e) {}
      this.recognition = null;
    }

    console.log('%c[STT] Stopped recording. Processing audio with Groq Whisper...', 'color: #3b82f6; font-weight: bold;');

    let finalResultText = this.finalTranscript;

    // Compile recorded audio chunks into a Blob
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      await new Promise((resolve) => {
        this.mediaRecorder.onstop = resolve;
        try {
          this.mediaRecorder.stop();
        } catch (e) {
          resolve();
        }
      });
    }

    if (this.audioChunks.length > 0) {
      const mimeType = this.mediaRecorder?.mimeType || 'audio/webm';
      const audioBlob = new Blob(this.audioChunks, { type: mimeType });

      if (audioBlob.size > 2000) { // More than 2KB of audio
        try {
          console.log(`%c[STT][Groq Whisper] Uploading ${audioBlob.size} bytes for transcription...`, 'color: #8b5cf6;');
          const sttData = await transcribeAudio(audioBlob);
          if (sttData && sttData.text && sttData.text.trim()) {
            finalResultText = sttData.text.trim();
            console.log(`%c[STT][Groq Whisper] Transcribed: "${finalResultText}" (Confidence: ${sttData.confidence})`, 'color: #10b981; font-weight: bold;');
          }
        } catch (err) {
          console.warn('[STT][Groq Whisper] Backend STT error, using local transcript fallback:', err);
        }
      }
    }

    this._cleanupAudioAnalyser();
    this.onEnd?.();

    if (finalResultText) {
      this.onFinal?.(finalResultText);
    }

    return finalResultText;
  }

  resetTranscript() {
    this.interimTranscript = '';
    this.finalTranscript = '';
    this.audioChunks = [];
    this.hasSpoken = false;
    this._clearSilenceTimer();
  }

  _resetSilenceTimer() {
    this._clearSilenceTimer();
    this.silenceTimer = setTimeout(async () => {
      if (this.isRecording && this.hasSpoken) {
        const fullText = await this.stop();
        if (fullText && fullText.length > 2) {
          this.onSilence?.(fullText);
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
      if (!this.mediaStream) return;
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

        if (volume > 0.08) {
          this.hasSpoken = true;
          if (this.options.autoVAD) {
            this._resetSilenceTimer();
          }
        }

        this.onVolume?.(volume);
        this.animationFrameId = requestAnimationFrame(updateVolume);
      };

      this.animationFrameId = requestAnimationFrame(updateVolume);
    } catch (err) {
      console.warn('[STT] Mic volume analyser notice:', err);
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

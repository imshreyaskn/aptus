// frontend/src/voice/speaker.js
// High-fidelity Google Cloud TTS player powered by Web Audio API.
import { synthesizeSpeech } from '../api';

let audioQueue = [];
let isPlaying = false;
let globalAudioCtx = null;
let currentSourceNode = null;
let currentAudioElement = null;

function getAudioContext() {
  if (typeof window === 'undefined') return null;
  if (!globalAudioCtx) {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (AudioCtx) {
      globalAudioCtx = new AudioCtx();
    }
  }
  if (globalAudioCtx && globalAudioCtx.state === 'suspended') {
    globalAudioCtx.resume().catch(() => {});
  }
  return globalAudioCtx;
}

function sanitizeTextForSpeech(text) {
  if (!text) return '';
  return text
    .replace(/\*\*(.*?)\*\*/g, '$1')       // bold
    .replace(/\*(.*?)\*/g, '$1')           // italic
    .replace(/`{1,3}[^`]*`{1,3}/g, '')     // code blocks
    .replace(/#+\s*/g, '')                 // headings
    .replace(/\[(.*?)\]\(.*?\)/g, '$1')    // links
    .replace(/[-*]\s+/g, '')               // list bullets
    .replace(/\s+/g, ' ')                  // normalize whitespace
    .trim();
}

/**
 * Synthesizes and plays speech using Google Cloud TTS backend endpoint via Web Audio API.
 */
async function cloudTTS(text, { onStart, onEnd } = {}) {
  const cleanText = sanitizeTextForSpeech(text);
  if (!cleanText) return;

  const startTime = Date.now();
  console.log(`%c[TTS][Google Cloud] Synthesizing speech: "${cleanText.slice(0, 70)}..."`, 'color: #8b5cf6; font-weight: bold;');

  try {
    const audioBlob = await synthesizeSpeech(cleanText);
    const audioCtx = getAudioContext();

    if (audioCtx) {
      if (audioCtx.state === 'suspended') {
        await audioCtx.resume();
      }

      const arrayBuffer = await audioBlob.arrayBuffer();
      const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);

      return new Promise((resolve) => {
        const source = audioCtx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(audioCtx.destination);
        currentSourceNode = source;

        let finished = false;
        const finish = () => {
          if (finished) return;
          finished = true;
          const elapsed = Date.now() - startTime;
          console.log(`%c[TTS][Google Cloud] Playback complete in ${elapsed}ms`, 'color: #10b981;');
          if (currentSourceNode === source) {
            currentSourceNode = null;
          }
          onEnd?.();
          resolve();
        };

        source.onended = finish;

        console.log(`%c[TTS][Google Cloud] Playing audio stream (${audioBlob.size} bytes)...`, 'color: #10b981; font-weight: bold;');
        onStart?.();
        source.start(0);
      });
    } else {
      // HTML5 Audio fallback if AudioContext is unsupported
      const audioUrl = URL.createObjectURL(audioBlob);
      const audio = new Audio(audioUrl);
      currentAudioElement = audio;

      return new Promise((resolve) => {
        audio.onplay = () => {
          console.log(`%c[TTS][Google Cloud] Playing stream (${audioBlob.size} bytes)...`, 'color: #10b981; font-weight: bold;');
          onStart?.();
        };

        const finish = () => {
          const elapsed = Date.now() - startTime;
          console.log(`%c[TTS][Google Cloud] Playback complete in ${elapsed}ms`, 'color: #a78bfa;');
          URL.revokeObjectURL(audioUrl);
          if (currentAudioElement === audio) {
            currentAudioElement = null;
          }
          onEnd?.();
          resolve();
        };

        audio.onended = finish;
        audio.onerror = (e) => {
          console.warn('[TTS][Google Cloud] Audio playback error:', e);
          finish();
        };

        audio.play().catch((err) => {
          console.warn('[TTS][Google Cloud] Audio play() prevented:', err);
          finish();
        });
      });
    }
  } catch (err) {
    console.error('[TTS][Google Cloud] Synthesis error:', err);
    onEnd?.();
  }
}

function getPreferredVoice() {
  if (typeof window === 'undefined' || !window.speechSynthesis) return null;
  const voices = window.speechSynthesis.getVoices();
  if (!voices || voices.length === 0) return null;

  return (
    voices.find(v => v.lang.startsWith('en') && (v.name.includes('Natural') || v.name.includes('Google') || v.name.includes('Samantha') || v.name.includes('Ava') || v.name.includes('Jenny'))) ||
    voices.find(v => v.lang.startsWith('en') && (v.name.includes('Zira') || v.name.includes('David') || v.name.includes('Daniel'))) ||
    voices.find(v => v.lang.startsWith('en')) ||
    voices[0]
  );
}

function browserTTS(text, { onStart, onEnd, rate = 1.0, pitch = 1.0 } = {}) {
  return new Promise((resolve) => {
    if (typeof window === 'undefined' || !window.speechSynthesis) {
      resolve();
      return;
    }

    const cleanText = sanitizeTextForSpeech(text);
    if (!cleanText) {
      resolve();
      return;
    }

    const utterance = new SpeechSynthesisUtterance(cleanText);
    currentUtterance = utterance;
    activeUtterances.add(utterance);

    const voices = window.speechSynthesis.getVoices();
    if (voices.length === 0) {
      let resolved = false;
      const handleVoices = () => {
        if (resolved) return;
        resolved = true;
        window.speechSynthesis.removeEventListener('voiceschanged', handleVoices);
        executeSpeech(utterance, resolve, { onStart, onEnd, rate, pitch, cleanText });
      };
      window.speechSynthesis.addEventListener('voiceschanged', handleVoices);

      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          window.speechSynthesis.removeEventListener('voiceschanged', handleVoices);
          executeSpeech(utterance, resolve, { onStart, onEnd, rate, pitch, cleanText });
        }
      }, 500);
    } else {
      executeSpeech(utterance, resolve, { onStart, onEnd, rate, pitch, cleanText });
    }
  });
}

function executeSpeech(utterance, resolve, { onStart, onEnd, rate, pitch, cleanText }) {
  const preferredVoice = getPreferredVoice();
  if (preferredVoice) {
    utterance.voice = preferredVoice;
  }
  utterance.lang = 'en-US';
  utterance.rate = rate;
  utterance.pitch = pitch;

  let finished = false;
  let watchdog = null;

  const cleanup = () => {
    if (watchdog) {
      clearTimeout(watchdog);
      watchdog = null;
    }
    activeUtterances.delete(utterance);
    if (currentUtterance === utterance) {
      currentUtterance = null;
    }
  };

  const finishSpeech = () => {
    if (finished) return;
    finished = true;
    cleanup();
    onEnd?.();
    resolve();
  };

  let startTime = Date.now();
  utterance.onstart = () => {
    startTime = Date.now();
    console.log(`%c[TTS] Speaking (${preferredVoice?.name || 'Default'}): "${cleanText.slice(0, 80)}${cleanText.length > 80 ? '...' : ''}"`, 'color: #8b5cf6; font-weight: bold;');
    onStart?.();
  };

  utterance.onend = () => {
    const elapsed = Date.now() - startTime;
    console.log(`%c[TTS] Finished playback in ${elapsed}ms`, 'color: #a78bfa;');
    finishSpeech();
  };

  utterance.onerror = (e) => {
    console.warn('[TTS] Synthesis event error/cancel:', e);
    finishSpeech();
  };

  const words = (cleanText || '').split(/\s+/).length;
  const estimatedMs = Math.max(4000, (words / 2.5) * 1000 + 4000);
  watchdog = setTimeout(() => {
    if (!finished) {
      console.warn('[TTS] Watchdog timeout reached; resolving speech item.');
      finishSpeech();
    }
  }, estimatedMs);

  try {
    window.speechSynthesis.speak(utterance);
  } catch (err) {
    console.error('[TTS] Speech call failed:', err);
    finishSpeech();
  }
}

async function processQueue() {
  if (audioQueue.length === 0) {
    isPlaying = false;
    return;
  }
  isPlaying = true;
  const nextItem = audioQueue.shift();
  if (nextItem) {
    await nextItem();
  }
  processQueue();
}

export function speakText(text, options = {}) {
  return new Promise((resolve) => {
    audioQueue.push(async () => {
      await cloudTTS(text, options);
      resolve();
    });

    if (!isPlaying) {
      processQueue();
    }
  });
}

export function stopAudio() {
  audioQueue = [];
  activeUtterances.clear();
  if (currentSourceNode) {
    try {
      currentSourceNode.stop();
      currentSourceNode.disconnect();
    } catch (e) {
      // ignore
    }
    currentSourceNode = null;
  }
  if (currentAudioElement) {
    try {
      currentAudioElement.pause();
      currentAudioElement.currentTime = 0;
    } catch (e) {
      // ignore
    }
    currentAudioElement = null;
  }
  if (typeof window !== 'undefined' && window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }
  isPlaying = false;
  currentUtterance = null;
}

export function isAudioPlaying() {
  return isPlaying || Boolean(currentSourceNode) || (typeof window !== 'undefined' && window.speechSynthesis?.speaking);
}


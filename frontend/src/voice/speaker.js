import { synthesizeSpeech } from '../api';

let audioContext = null;
let currentSource = null;
let currentAudioElement = null;
let currentResolve = null;
let playbackGeneration = 0;
let draining = false;
let queue = [];

const cleanSpeechText = (text) => String(text || '')
  .replace(/```[\s\S]*?```/g, ' ')
  .replace(/`([^`]+)`/g, '$1')
  .replace(/\*\*([^*]+)\*\*/g, '$1')
  .replace(/\*([^*]+)\*/g, '$1')
  .replace(/#+\s*/g, '')
  .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
  .replace(/[-*]\s+/g, '')
  .replace(/\s+/g, ' ')
  .trim();

function getAudioContext() {
  if (typeof window === 'undefined') return null;
  if (!audioContext) {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (AudioContext) audioContext = new AudioContext();
  }
  return audioContext;
}

function settleCurrent() {
  const resolve = currentResolve;
  currentResolve = null;
  if (resolve) resolve();
}

async function playCloud(text, { onStart, onEnd, generation }) {
  const cleanText = cleanSpeechText(text);
  if (!cleanText || generation !== playbackGeneration) return;

  const blob = await synthesizeSpeech(cleanText);
  if (generation !== playbackGeneration) return;

  const context = getAudioContext();
  if (!context) {
    const url = URL.createObjectURL(blob);
    await new Promise((resolve) => {
      const audio = new Audio(url);
      currentAudioElement = audio;
      currentResolve = resolve;
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        URL.revokeObjectURL(url);
        if (currentAudioElement === audio) currentAudioElement = null;
        if (currentResolve === resolve) currentResolve = null;
        onEnd?.();
        resolve();
      };
      audio.onplay = () => onStart?.();
      audio.onended = finish;
      audio.onerror = finish;
      audio.play().catch(finish);
    });
    return;
  }

  if (context.state === 'suspended') {
    await context.resume();
  }

  const buffer = await context.decodeAudioData(await blob.arrayBuffer());
  if (generation !== playbackGeneration) return;

  await new Promise((resolve) => {
    currentResolve = resolve;
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    currentSource = source;

    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      if (currentSource === source) currentSource = null;
      if (currentResolve === resolve) currentResolve = null;
      onEnd?.();
      resolve();
    };

    source.onended = finish;
    onStart?.();

    try {
      source.start(0);
    } catch {
      finish();
    }
  });
}

async function drainQueue() {
  if (draining) return;
  draining = true;

  while (queue.length) {
    const item = queue.shift();
    try {
      await item.run();
    } catch (error) {
      item.onError?.(error);
    } finally {
      item.resolve();
    }
  }

  draining = false;
}

export function speakText(text, options = {}) {
  const generation = playbackGeneration;
  const cleanText = cleanSpeechText(text);

  if (!cleanText) return Promise.resolve();

  return new Promise((resolve) => {
    queue.push({
      resolve,
      onError: options.onError,
      run: () => playCloud(cleanText, {
        ...options,
        generation,
      }),
    });

    drainQueue();
  });
}

export function stopAudio() {
  playbackGeneration += 1;

  const pending = queue.splice(0);
  pending.forEach((item) => item.resolve());

  try { currentSource?.stop(); } catch {}
  try { currentSource?.disconnect(); } catch {}
  currentSource = null;

  if (currentAudioElement) {
    try { currentAudioElement.pause(); } catch {}
    try { currentAudioElement.currentTime = 0; } catch {}
    currentAudioElement = null;
  }

  settleCurrent();
}

export function isAudioPlaying() {
  return Boolean(draining || currentSource || currentAudioElement);
}

/** Called after a user gesture to unlock the browser audio context. */
export async function primeAudio() {
  const context = getAudioContext();
  if (context?.state === 'suspended') {
    await context.resume().catch(() => {});
  }
}

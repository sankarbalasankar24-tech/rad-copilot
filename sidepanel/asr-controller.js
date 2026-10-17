// asr-controller.js — pluggable dictation backends, all free:
//
//   'webspeech'      → Chrome's built-in Web Speech API (fast; audio processed
//                      on Google's service per MDN).
//   'whisper-server' → fully local, fully free: any whisper.cpp server
//                      (or any OpenAI-compatible /v1/audio/transcriptions
//                      endpoint) running on this computer. Nothing leaves
//                      the machine. Run for example:
//                        whisper-server -m models/ggml-medium.bin -t 4 --port 8000
//
// The controller records ~9 s segments (MediaRecorder), decodes & downsamples
// to 16 kHz mono WAV in the browser, posts each segment, and emits final text
// chunks to the same onFinal interface the panel already consumes.

import { DictationService } from './speech.js';

const SEGMENT_SECONDS = 9;

// ---------------------------------------------------------------------------
// 16 kHz mono WAV encoding in browser
// ---------------------------------------------------------------------------

function audioBufferToWav(buffer) {
  const sampleRate = buffer.sampleRate;
  const from = buffer.getChannelData(0);
  // naive high-quality-enough downsample by linear interpolation
  const targetRate = 16000;
  const length = Math.round((from.length * targetRate) / sampleRate) | 0;
  const down = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const t = (i * (sampleRate / targetRate));
    const j = Math.floor(t);
    const frac = t - j;
    down[i] = j + 1 < from.length ? from[j] * (1 - frac) + from[j + 1] * frac : from[j];
  }
  const bytes = new DataView(new ArrayBuffer(44 + length * 2));
  const wstr = (off, s) => { for (let i = 0; i < s.length; i++) bytes.setUint8(off + i, s.charCodeAt(i)); };
  wstr(0, 'RIFF'); bytes.setUint32(4, 36 + length * 2, true); wstr(8, 'WAVE');
  wstr(12, 'fmt '); bytes.setUint32(16, 16, true); bytes.setUint16(20, 1, true);
  bytes.setUint16(22, 1, true); bytes.setUint32(24, targetRate, true);
  bytes.setUint32(28, targetRate * 2, true); bytes.setUint16(32, 2, true);
  bytes.setUint16(34, 16, true);
  wstr(36, 'data'); bytes.setUint32(40, length * 2, true);
  for (let i = 0; i < length; i++) {
    const s = Math.max(-1, Math.min(1, down[i]));
    bytes.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([bytes.buffer], { type: 'audio/wav' });
}

async function blobToWav(blob) {
  const arrayBuf = await blob.arrayBuffer();
  const ctx = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(1, 1, 44100);
  const audio = await ctx.decodeAudioData(arrayBuf);
  return audioBufferToWav(audio);
}

// ---------------------------------------------------------------------------
// whisper.cpp / OpenAI-compatible local server backend
// ---------------------------------------------------------------------------

class WhisperServerDictation {
  constructor({ endpoint, onFinal, onStatus }) {
    this.endpoint = (endpoint || '').replace(/\/+$/, '');
    this.onFinal = onFinal || (() => {});
    this.onStatus = onStatus || (() => {});
    this.listening = false;         // UI toggle contract mirrors DictationService
    this.wantListening = false;
    this.running = false;
    this.stream = null;
    this.recorder = null;
    this.chunks = [];
    this.segmentActive = false;
    this.lang = 'en-IN';
  }

  static isSupported() {
    return typeof navigator !== 'undefined'
      && navigator.mediaDevices && typeof MediaRecorder !== 'undefined';
  }

  async _postSegment(silenceHint) {
    if (!this.chunks.length) return;
    const blob = new Blob(this.chunks, { type: 'audio/webm' });
    this.chunks = [];
    if (blob.size < 12000) return; // ~silence
    try {
      this.onStatus('listening', 'Transcribing locally…');
      const wav = await blobToWav(blob);
      const fd = new FormData();
      fd.append('file', wav, 'segment.wav');
      fd.append('response_format', 'json');
      const res = await fetch(this.endpoint, { method: 'POST', body: fd });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const raw = await res.text();
      let text = raw;
      try {
        const json = JSON.parse(raw);
        text = json.text || json.transcription || '';
      } catch { /* plain text response */ }
      text = String(text || '').trim();
      if (text) this.onFinal(text, 0); // confidence 0 = unknown
      this.onStatus('listening', 'Listening… local model is processing.');
    } catch (err) {
      this.onStatus('error', `Local ASR server failed: ${err.message}. Keep the whisper-server running (see README) and press Start again.`);
      this.stop();
    }
  }

  start() {
    if (WhisperServerDictation.isSupported() === false) {
      this.onStatus('error', 'MediaRecorder unavailable in this browser.');
      return false;
    }
    if (this.running) return; // guard against double Start
    this.wantListening = true;
    navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1 } }).then((stream) => {
      this.stream = stream;
      this.recorder = new MediaRecorder(stream, { audioBitsPerSecond: 96000 });
      this.recorder.ondataavailable = (e) => {
        if (e.data && e.data.size) this.chunks.push(e.data);
      };
      this.recorder.start(1000);
      this.running = true;
      this.listening = true;
      this.segmentActive = true;
      this.onStatus('listening', `Listening… local (${SEGMENT_SECONDS}s segments).`);
      this.timer = setInterval(() => {
        // split current segment: restart recorder, transcribe in background
        if (this.segmentActive) {
          this.segmentActive = false;
          try { this.recorder.stop(); } catch {}
          const recorder = new MediaRecorder(stream, { audioBitsPerSecond: 96000 });
          this.recorder = recorder;
          recorder.ondataavailable = (e) => { if (e.data && e.data.size) this.chunks.push(e.data); };
          recorder.start(1000);
          this.segmentActive = true;
          this._postSegment();
        }
      }, SEGMENT_SECONDS * 1000);
    }).catch((err) => {
      this.onStatus('error', `Microphone blocked: ${err.message}`);
    });
    return true;
  }

  stop() {
    this.running = false;
    this.wantListening = false;
    this.listening = false;
    this.segmentActive = false;
    if (this.timer) clearInterval(this.timer);
    if (this.recorder && this.recorder.state !== 'inactive') {
      const recorder = this.recorder;
      this.recorder = null;
      try {
        recorder.onstop = () => this._postSegment();
        recorder.stop();
      } catch {}
    }
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.onStatus('idle', 'Dictation stopped.');
  }

  setLanguage(lang) { this.lang = lang; }
}

// ---------------------------------------------------------------------------

export async function createAsrController({ engine, endpoint, language, onFinal, onInterim, onStatus, onLowConfidence }) {
  if (engine === 'whisper-server') {
    return new WhisperServerDictation({ endpoint, onFinal, onStatus });
  }
  return new DictationService({ language, onFinal, onInterim, onStatus, onLowConfidence });
}

// speech.js — continuous dictation over Chrome's built-in Web Speech API
// (free, backend 'webspeech'). Handles interim captions, finalised results,
// low-confidence flags, and resilient auto-restart after silence or errors.
// NOTE: Chrome processes this audio on Google's service — see README.
// For a fully local, free pipeline use the whisper-server backend in
// asr-controller.js.

export class DictationService {
  constructor({ language = 'en-IN', onFinal, onInterim, onStatus, onLowConfidence }) {
    this.lang = language;
    this.onFinal = onFinal || (() => {});
    this.onInterim = onInterim || (() => {});
    this.onStatus = onStatus || (() => {});
    this.onLowConfidence = onLowConfidence || (() => {});
    this.recognition = null;
    this.listening = false;
    this.wantListening = false;
  }

  static isSupported() {
    return typeof window !== 'undefined'
      && ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window);
  }

  _create() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const r = new SR();
    r.lang = this.lang;
    r.continuous = true;
    r.interimResults = true;
    r.maxAlternatives = 1;

    r.onresult = (event) => {
      let finalText = '';
      let lowConf = false;
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const res = event.results[i];
        if (res.isFinal) {
          finalText += res[0].transcript;
          if (res[0].confidence && res[0].confidence < 0.75) lowConf = true;
        } else {
          this.onInterim(res[0].transcript);
        }
      }
      if (finalText.trim()) this.onFinal(finalText, lowConf ? -1 : 1);
    };

    r.onerror = (event) => {
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        this.listening = false;
        this.wantListening = false;
        this.onStatus('error', 'Microphone blocked. Grant mic permission for this extension and retry.');
      } else if (event.error === 'no-speech') {
        // benign — restart loop continues
      } else if (event.error !== 'aborted') {
        this.onStatus('warn', `Speech engine warning: ${event.error}`);
      }
    };

    r.onend = () => {
      this.listening = false;
      if (this.wantListening) {
        // Chrome ends the session periodically; restart to keep continuous flow
        setTimeout(() => this._start(), 150);
      } else {
        this.onStatus('idle', 'Dictation stopped.');
      }
    };
    return r;
  }

  _start() {
    if (!this.recognition) this.recognition = this._create();
    try {
      this.recognition.start();
      this.listening = true;
      this.onStatus('listening', 'Listening… dictate freely while you review images.');
    } catch (e) {
      // start() throws if already started — ignore
    }
  }

  start() {
    if (!DictationService.isSupported()) {
      this.onStatus('error', 'Chrome Speech Recognition not available.');
      return false;
    }
    this.wantListening = true;
    this._start();
    return true;
  }

  stop() {
    this.wantListening = false;
    if (this.recognition) {
      try { this.recognition.stop(); } catch (e) { /* already stopped */ }
    }
    this.listening = false;
    this.onStatus('idle', 'Dictation stopped.');
  }

  setLanguage(lang) {
    this.lang = lang;
    if (this.recognition) this.recognition.lang = lang;
  }
}

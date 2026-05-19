const { EventEmitter } = require("events");

/**
 * TtsProvider — single shape every provider implements.
 *
 * Events:
 *   "audio"     (Buffer pcm16, { sampleRate, channels, bitsPerSample })
 *   "complete"  ()                          // current synthesis finished
 *   "error"     (Error)
 *   "reconnect" ()                          // for streaming providers that reconnect
 *
 * Methods (all return Promise where async):
 *   connect()             open underlying connection / warm up
 *   sendText(text)        synthesize text chunk; audio arrives via "audio" events
 *   flush()               finalize the current utterance; "complete" fires after drain
 *   close()               release resources
 *   isReady()             boolean — safe to call sendText now?
 *
 * Providers must emit at least one "audio" event followed by "complete" per
 * complete utterance. PCM is little-endian signed 16-bit mono unless the
 * provider documents otherwise via the audio meta object.
 */
class TtsProvider extends EventEmitter {
  constructor(options = {}) {
    super();
    this.name = "base";
    this.languageCode = options.languageCode || "hi-IN";
    this.sampleRate = Number(options.sampleRate || 16000);
    this.voice = options.voice || null;
    this._ready = false;
    this._closed = false;
  }

  async connect() {
    throw new Error(`${this.name}: connect() not implemented`);
  }

  // eslint-disable-next-line no-unused-vars
  async sendText(text) {
    throw new Error(`${this.name}: sendText() not implemented`);
  }

  async flush() {
    throw new Error(`${this.name}: flush() not implemented`);
  }

  async close() {
    this._closed = true;
    this._ready = false;
  }

  isReady() {
    return this._ready && !this._closed;
  }
}

module.exports = { TtsProvider };

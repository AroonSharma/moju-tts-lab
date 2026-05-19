const WS = require("ws");
const { TtsProvider } = require("./base");
const { config } = require("../config");

// ElevenLabs streaming — wss://api.elevenlabs.io/v1/text-to-speech/{voice}/stream-input
// Send: { text: "", voice_settings, generation_config, xi_api_key } on open,
//       { text: "<chunk> " } per chunk,
//       { text: "" } to flush.
// Receive: { audio: "<base64 pcm/mp3>", isFinal?: bool, normalizedAlignment? }

class ElevenLabsProvider extends TtsProvider {
  constructor(options = {}) {
    super(options);
    this.name = "elevenlabs";
    this.apiKey = options.apiKey || config.elevenlabs.apiKey;
    this.model = options.model || config.elevenlabs.model;
    this.voice = options.voice || config.elevenlabs.voice;
    this.wsUrl = options.wsUrl || config.elevenlabs.wsUrl;
    this.languageCode = options.languageCode || "hi";
    this._ws = null;
    this._meta = { sampleRate: this.sampleRate, channels: 1, bitsPerSample: 16 };
  }

  async connect() {
    if (!this.apiKey) throw new Error("elevenlabs: ELEVENLABS_API_KEY is required");
    if (!this.voice) throw new Error("elevenlabs: ELEVENLABS_VOICE is required (voice id from your voice library)");

    const params = new URLSearchParams({
      model_id: this.model,
      output_format: `pcm_${this.sampleRate}`,
    });
    const url = `${this.wsUrl}/v1/text-to-speech/${encodeURIComponent(this.voice)}/stream-input?${params}`;

    return new Promise((resolve, reject) => {
      const ws = new WS(url);
      this._ws = ws;
      const timeout = setTimeout(() => {
        if (!this._ready) {
          reject(new Error("elevenlabs connect timeout"));
          try { ws.close(); } catch {}
        }
      }, 10000);

      ws.on("open", () => {
        // BOS message — sets up the session.
        ws.send(JSON.stringify({
          text: " ",
          voice_settings: { stability: 0.5, similarity_boost: 0.75 },
          generation_config: { chunk_length_schedule: [120, 160, 250, 290] },
          xi_api_key: this.apiKey,
        }));
        this._ready = true;
        clearTimeout(timeout);
        resolve();
      });

      ws.on("message", (raw) => this._handleMessage(raw));
      ws.on("error", (err) => {
        if (!this._ready) { clearTimeout(timeout); reject(err); return; }
        this.emit("error", err);
      });
      ws.on("close", () => {
        this._ready = false;
        if (!this._closed) this.emit("reconnect");
      });
    });
  }

  async sendText(text) {
    if (!this.isReady() || !text) return;
    // ElevenLabs requires a trailing space to flush their text buffer per chunk.
    const t = String(text).endsWith(" ") ? String(text) : `${text} `;
    this._ws.send(JSON.stringify({ text: t, try_trigger_generation: true }));
  }

  async flush() {
    if (!this.isReady()) return;
    // Empty text = EOS, server flushes remaining audio and closes the turn.
    this._ws.send(JSON.stringify({ text: "" }));
  }

  async close() {
    await super.close();
    if (this._ws) {
      try { this._ws.close(1000, "closed"); } catch {}
      this._ws = null;
    }
  }

  _handleMessage(raw) {
    let msg;
    try { msg = JSON.parse(Buffer.isBuffer(raw) ? raw.toString("utf8") : String(raw)); }
    catch { return; }

    if (msg.audio) {
      const pcm = Buffer.from(msg.audio, "base64");
      if (pcm.length > 0) this.emit("audio", pcm, this._meta);
    }
    if (msg.isFinal) {
      this.emit("complete");
    }
    if (msg.error) {
      this.emit("error", new Error(msg.error || msg.message || "elevenlabs error"));
    }
  }
}

module.exports = { ElevenLabsProvider };

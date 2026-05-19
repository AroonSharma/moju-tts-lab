const WS = require("ws");
const { TtsProvider } = require("./base");
const { config } = require("../config");

// Cartesia Sonic — native streaming WebSocket.
// API: wss://api.cartesia.ai/tts/websocket?cartesia_version=…&api_key=…
// Send: { "model_id", "voice", "transcript", "language", "output_format", "continue": bool, "context_id" }
// Receive: { "type": "chunk", "data": <base64 pcm>, "context_id" } and { "type": "done" }

class CartesiaProvider extends TtsProvider {
  constructor(options = {}) {
    super(options);
    this.name = "cartesia";
    this.apiKey = options.apiKey || config.cartesia.apiKey;
    this.version = options.version || config.cartesia.version;
    this.model = options.model || config.cartesia.model;
    this.voice = options.voice || config.cartesia.voice;
    this.wsUrl = options.wsUrl || config.cartesia.wsUrl;
    this.languageCode = options.languageCode || "hi";
    this._ws = null;
    this._contextId = null;
    this._meta = { sampleRate: this.sampleRate, channels: 1, bitsPerSample: 16 };
  }

  async connect() {
    if (!this.apiKey) throw new Error("cartesia: CARTESIA_API_KEY is required");
    if (!this.voice) throw new Error("cartesia: CARTESIA_VOICE is required (a voice id from cartesia.ai/voices)");

    const url = `${this.wsUrl}?cartesia_version=${encodeURIComponent(this.version)}&api_key=${encodeURIComponent(this.apiKey)}`;
    return new Promise((resolve, reject) => {
      const ws = new WS(url);
      this._ws = ws;
      const timeout = setTimeout(() => {
        if (!this._ready) {
          reject(new Error("cartesia connect timeout"));
          try { ws.close(); } catch {}
        }
      }, 10000);

      ws.on("open", () => {
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

  _payload(text, isContinuation) {
    const langShort = String(this.languageCode || "hi").split("-")[0].toLowerCase();
    return {
      model_id: this.model,
      voice: { mode: "id", id: this.voice },
      transcript: text,
      language: langShort,
      output_format: {
        container: "raw",
        encoding: "pcm_s16le",
        sample_rate: this.sampleRate,
      },
      context_id: this._contextId,
      continue: !!isContinuation,
    };
  }

  async sendText(text) {
    if (!this.isReady() || !text) return;
    if (!this._contextId) {
      this._contextId = `ctx_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    }
    this._ws.send(JSON.stringify(this._payload(String(text), true)));
  }

  async flush() {
    if (!this.isReady()) return;
    // Send an empty continuation = false to signal end-of-utterance.
    this._ws.send(JSON.stringify(this._payload("", false)));
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

    if (msg.type === "chunk" && msg.data) {
      const pcm = Buffer.from(msg.data, "base64");
      if (pcm.length > 0) this.emit("audio", pcm, this._meta);
      return;
    }

    if (msg.type === "done") {
      this._contextId = null;
      this.emit("complete");
      return;
    }

    if (msg.type === "error") {
      this.emit("error", new Error(msg.error || msg.message || "cartesia error"));
    }
  }
}

module.exports = { CartesiaProvider };

const WS = require("ws");
const { TtsProvider } = require("./base");
const { config } = require("../config");

// Native streaming WebSocket. Audio arrives as base64-encoded WAV or raw PCM16
// inside JSON "audio" messages; a final "event" message of type "final"
// signals completion.

function parseWavHeader(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 44) return null;
  if (buf.toString("ascii", 0, 4) !== "RIFF") return null;
  if (buf.toString("ascii", 8, 12) !== "WAVE") return null;
  let offset = 12;
  let channels = 1;
  let sampleRate = 16000;
  let bitsPerSample = 16;
  while (offset + 8 <= buf.length) {
    const id = buf.toString("ascii", offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    const dataStart = offset + 8;
    if (id === "fmt " && size >= 16 && dataStart + 16 <= buf.length) {
      channels = buf.readUInt16LE(dataStart + 2);
      sampleRate = buf.readUInt32LE(dataStart + 4);
      bitsPerSample = buf.readUInt16LE(dataStart + 14);
    } else if (id === "data") {
      return { dataOffset: dataStart, channels, sampleRate, bitsPerSample };
    }
    const next = dataStart + size + (size % 2);
    if (next <= offset || next > buf.length) break;
    offset = next;
  }
  return { dataOffset: 44, channels, sampleRate, bitsPerSample };
}

class SarvamProvider extends TtsProvider {
  constructor(options = {}) {
    super(options);
    this.name = "sarvam";
    this.apiKey = options.apiKey || config.sarvam.apiKey;
    this.voice = (options.voice || config.sarvam.voice || "Shubh").toLowerCase();
    this.model = options.model || config.sarvam.model;
    this.pace = Number(options.pace ?? config.sarvam.pace);
    this.wsUrl = options.wsUrl || config.sarvam.wsUrl;
    this.languageCode = options.languageCode || "hi-IN";
    this._ws = null;
    this._audioMeta = { sampleRate: this.sampleRate, channels: 1, bitsPerSample: 16 };
  }

  async connect() {
    if (!this.apiKey) throw new Error("sarvam: SARVAM_API_KEY is required");
    const url = `${this.wsUrl}?model=${encodeURIComponent(this.model)}&send_completion_event=true`;

    return new Promise((resolve, reject) => {
      const ws = new WS(url, { headers: { "Api-Subscription-Key": this.apiKey } });
      this._ws = ws;
      const timeout = setTimeout(() => {
        if (!this._ready) {
          reject(new Error("sarvam connect timeout"));
          try { ws.close(); } catch {}
        }
      }, 10000);

      ws.on("open", () => {
        ws.send(JSON.stringify({
          type: "config",
          data: {
            speaker: this.voice,
            target_language_code: this.languageCode,
            output_audio_codec: "linear16",
            speech_sample_rate: this.sampleRate,
            pace: this.pace,
          },
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
    const chunk = String(text);
    if (!/[\p{L}\p{N}]/u.test(chunk)) return;
    this._ws.send(JSON.stringify({ type: "text", data: { text: chunk } }));
  }

  async flush() {
    if (!this.isReady()) return;
    this._ws.send(JSON.stringify({ type: "flush" }));
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

    if (msg.type === "audio" && msg.data?.audio) {
      let pcm = Buffer.from(msg.data.audio, "base64");
      if (pcm.length >= 12 && pcm.toString("ascii", 0, 4) === "RIFF") {
        const hdr = parseWavHeader(pcm);
        if (hdr) {
          this._audioMeta = { sampleRate: hdr.sampleRate, channels: hdr.channels, bitsPerSample: hdr.bitsPerSample };
          pcm = pcm.subarray(hdr.dataOffset);
        }
      }
      if (pcm.length > 0) this.emit("audio", pcm, this._audioMeta);
      return;
    }

    if (msg.type === "event" && msg.data?.event_type === "final") {
      this.emit("complete");
      return;
    }

    if (msg.type === "error") {
      this.emit("error", new Error(msg.data?.message || msg.message || "sarvam error"));
    }
  }
}

module.exports = { SarvamProvider };

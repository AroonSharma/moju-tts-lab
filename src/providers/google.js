const { TtsProvider } = require("./base");
const { config } = require("../config");

// Google Cloud TTS v1 REST. Not natively streaming — the API returns the
// full audio in one response. We accumulate text chunks until flush(), then
// POST, decode the base64, strip the WAV header, and emit the PCM in
// 20 ms frames so downstream code thinks it is streaming.

const FRAME_MS = 20;

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

class GoogleProvider extends TtsProvider {
  constructor(options = {}) {
    super(options);
    this.name = "google";
    this.apiKey = options.apiKey || config.google.apiKey;
    this.voice = options.voice || config.google.voice;
    this.speakingRate = Number(options.speakingRate ?? config.google.speakingRate);
    this.endpoint = options.endpoint || config.google.endpoint;
    this.languageCode = options.languageCode || "hi-IN";
    this._buffer = "";
  }

  async connect() {
    if (!this.apiKey) throw new Error("google: GOOGLE_TTS_API_KEY is required");
    this._ready = true;
  }

  async sendText(text) {
    if (!this.isReady() || !text) return;
    this._buffer += String(text);
  }

  async flush() {
    if (!this.isReady()) return;
    const text = this._buffer.trim();
    this._buffer = "";
    if (!text) {
      this.emit("complete");
      return;
    }

    const body = {
      input: { text },
      voice: { languageCode: this.languageCode, name: this.voice },
      audioConfig: {
        audioEncoding: "LINEAR16",
        sampleRateHertz: this.sampleRate,
        speakingRate: this.speakingRate,
      },
    };

    try {
      const res = await fetch(`${this.endpoint}?key=${encodeURIComponent(this.apiKey)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`google tts ${res.status}: ${errText.slice(0, 200)}`);
      }
      const json = await res.json();
      const audioB64 = json?.audioContent;
      if (!audioB64) throw new Error("google tts returned empty audioContent");

      let pcm = Buffer.from(audioB64, "base64");
      let meta = { sampleRate: this.sampleRate, channels: 1, bitsPerSample: 16 };
      if (pcm.length >= 12 && pcm.toString("ascii", 0, 4) === "RIFF") {
        const hdr = parseWavHeader(pcm);
        if (hdr) {
          meta = { sampleRate: hdr.sampleRate, channels: hdr.channels, bitsPerSample: hdr.bitsPerSample };
          pcm = pcm.subarray(hdr.dataOffset);
        }
      }
      await this._emitInFrames(pcm, meta);
      this.emit("complete");
    } catch (err) {
      this.emit("error", err);
    }
  }

  async _emitInFrames(pcm, meta) {
    const bytesPerSample = (meta.bitsPerSample / 8) * meta.channels;
    const frameBytes = Math.max(2, Math.floor(meta.sampleRate * (FRAME_MS / 1000)) * bytesPerSample);
    for (let i = 0; i < pcm.length; i += frameBytes) {
      const slice = pcm.subarray(i, Math.min(i + frameBytes, pcm.length));
      this.emit("audio", slice, meta);
      // tiny gap so the WS client sees genuine streaming behaviour
      await new Promise((r) => setImmediate(r));
    }
  }
}

module.exports = { GoogleProvider };

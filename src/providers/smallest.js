const { TtsProvider } = require("./base");
const { config } = require("../config");

// Smallest.ai Lightning — POST returns the full WAV (no native streaming in
// REST). Same chunking trick as Google.

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

class SmallestProvider extends TtsProvider {
  constructor(options = {}) {
    super(options);
    this.name = "smallest";
    this.apiKey = options.apiKey || config.smallest.apiKey;
    this.model = options.model || config.smallest.model || "lightning-v3.1";
    this.voice = options.voice || config.smallest.voice || "";
    this.endpoint = (options.endpoint || config.smallest.endpoint).replace(/\/$/, "");
    this.languageCode = options.languageCode || "hi";
    this._buffer = "";
  }

  async connect() {
    if (!this.apiKey) throw new Error("smallest: SMALLEST_API_KEY is required");
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

    const url = `${this.endpoint}/${encodeURIComponent(this.model)}/get_speech`;
    const payload = {
      text,
      sample_rate: this.sampleRate,
      // Per Smallest docs the v3.1 endpoint takes voice_id + output_format
      // (string). add_wav_header is a legacy v2 flag that v3.1 rejects.
      output_format: "wav",
    };
    if (this.voice) payload.voice_id = this.voice;

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`smallest tts ${res.status} ${url}: ${errText.slice(0, 300)}`);
      }
      let pcm = Buffer.from(await res.arrayBuffer());
      let meta = { sampleRate: this.sampleRate, channels: 1, bitsPerSample: 16 };
      if (pcm.length >= 12 && pcm.toString("ascii", 0, 4) === "RIFF") {
        const hdr = parseWavHeader(pcm);
        if (hdr) {
          meta = { sampleRate: hdr.sampleRate, channels: hdr.channels, bitsPerSample: hdr.bitsPerSample };
          pcm = pcm.subarray(hdr.dataOffset);
        }
      }
      const bytesPerSample = (meta.bitsPerSample / 8) * meta.channels;
      const frameBytes = Math.max(2, Math.floor(meta.sampleRate * (FRAME_MS / 1000)) * bytesPerSample);
      for (let i = 0; i < pcm.length; i += frameBytes) {
        this.emit("audio", pcm.subarray(i, Math.min(i + frameBytes, pcm.length)), meta);
        await new Promise((r) => setImmediate(r));
      }
      this.emit("complete");
    } catch (err) {
      this.emit("error", err);
    }
  }
}

module.exports = { SmallestProvider };

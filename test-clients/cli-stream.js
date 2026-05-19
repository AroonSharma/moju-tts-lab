#!/usr/bin/env node
/* eslint-disable no-console */
// CLI test: connect to the gateway, send text, write PCM out to a WAV file.
//
// Usage:
//   node test-clients/cli-stream.js --provider google --text "एक छोटा खरगोश..." --out out.wav
//   node test-clients/cli-stream.js --provider cartesia --voice <voice_id> --text "..."
//
// Requires the gateway server to be running (npm start).

const fs = require("fs");
const path = require("path");
const WS = require("ws");

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const val = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : "true";
      out[key] = val;
    }
  }
  return out;
}

function writeWav(filePath, pcm, sampleRate = 16000, channels = 1, bitsPerSample = 16) {
  const byteRate = sampleRate * channels * (bitsPerSample / 8);
  const blockAlign = channels * (bitsPerSample / 8);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  fs.writeFileSync(filePath, Buffer.concat([header, pcm]));
}

async function main() {
  const args = parseArgs(process.argv);
  const provider = args.provider || process.env.TTS_PROVIDER || "google";
  const text = args.text || "नमस्ते, यह एक परीक्षण है।";
  const outFile = args.out || path.resolve(`out_${provider}_${Date.now()}.wav`);
  const host = args.host || "localhost";
  const port = args.port || process.env.TTS_PORT || 8090;
  const sampleRate = Number(args.sample_rate || 16000);

  const params = new URLSearchParams({
    provider,
    sample_rate: String(sampleRate),
    language: args.language || "hi-IN",
  });
  if (args.voice) params.set("voice", args.voice);
  if (args.model) params.set("model", args.model);

  const wsUrl = `ws://${host}:${port}/tts?${params.toString()}`;
  console.log(`→ connecting ${wsUrl}`);

  const ws = new WS(wsUrl);
  const chunks = [];
  let metaSampleRate = sampleRate;
  let ttfb = null;
  const startedAt = Date.now();

  ws.on("open", () => {
    console.log("← open");
  });

  ws.on("message", (data, isBinary) => {
    if (isBinary) {
      chunks.push(Buffer.isBuffer(data) ? data : Buffer.from(data));
      return;
    }
    let msg;
    try { msg = JSON.parse(String(data)); } catch { return; }
    if (msg.type === "ready") {
      console.log(`← ready provider=${msg.provider} voice=${msg.voice || "default"} sr=${msg.sample_rate}`);
      metaSampleRate = msg.sample_rate || sampleRate;
      ws.send(JSON.stringify({ type: "text", text }));
      ws.send(JSON.stringify({ type: "flush" }));
    } else if (msg.type === "ttfb") {
      ttfb = msg.ms;
      console.log(`← ttfb ${ttfb}ms`);
    } else if (msg.type === "complete") {
      const totalBytes = chunks.reduce((s, b) => s + b.length, 0);
      const audioSec = totalBytes / (metaSampleRate * 2); // s16 mono
      const wallMs = Date.now() - startedAt;
      const pcm = Buffer.concat(chunks);
      writeWav(outFile, pcm, metaSampleRate, 1, 16);
      console.log(`← complete bytes=${totalBytes} (${audioSec.toFixed(2)}s audio, wall=${wallMs}ms, ttfb=${ttfb ?? "n/a"}ms)`);
      console.log(`✓ wrote ${outFile}`);
      ws.close(1000, "done");
    } else if (msg.type === "error") {
      console.error(`✗ error: ${msg.message}`);
      ws.close(1011, msg.message.slice(0, 80));
      process.exitCode = 1;
    }
  });

  ws.on("close", () => process.exit());
  ws.on("error", (err) => { console.error("ws error:", err.message); process.exit(1); });
}

main().catch((err) => { console.error(err); process.exit(1); });

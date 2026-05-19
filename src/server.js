const http = require("http");
const path = require("path");
const fs = require("fs");
const url = require("url");
const { WebSocketServer } = require("ws");
const { config } = require("./config");
const { createProvider, listProviders } = require("./factory");

// Single uniform WebSocket protocol for every TTS backend:
//
//   GET /tts?provider=google&voice=hi-IN-Neural2-A&language=hi-IN&sample_rate=16000
//
//   Client → server (JSON):
//     { "type": "text",  "text": "..." }    one chunk of text to synthesize
//     { "type": "flush" }                   finalize the current utterance
//     { "type": "close" }                   tear down
//
//   Server → client:
//     binary frames                         raw PCM16 LE mono at sample_rate
//     { "type": "ready", "provider": "...", "sample_rate": 16000, "voice": "..." }
//     { "type": "complete" }                emitted after each utterance finishes
//     { "type": "error",  "message": "..." }
//     { "type": "ttfb",   "ms": 312 }       first audio chunk latency since flush()

const PUBLIC_DIR = path.join(__dirname, "..", "test-clients");
const PORT = config.port;

const httpServer = http.createServer((req, res) => {
  const u = url.parse(req.url || "/", true);
  if (req.method === "GET" && (u.pathname === "/" || u.pathname === "/index.html")) {
    serveStatic("index.html", res);
    return;
  }
  if (req.method === "GET" && u.pathname === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, providers: listProviders(), defaultProvider: config.defaultProvider }));
    return;
  }
  res.writeHead(404).end("not found");
});

function serveStatic(name, res) {
  const file = path.join(PUBLIC_DIR, name);
  fs.readFile(file, (err, body) => {
    if (err) { res.writeHead(404).end("missing"); return; }
    const ext = path.extname(file).toLowerCase();
    const type = ext === ".html" ? "text/html; charset=utf-8" : ext === ".js" ? "text/javascript" : "application/octet-stream";
    res.writeHead(200, { "Content-Type": type });
    res.end(body);
  });
}

const wss = new WebSocketServer({ server: httpServer, path: "/tts" });

wss.on("connection", async (ws, req) => {
  const u = url.parse(req.url || "/", true);
  const q = u.query || {};
  const providerName = String(q.provider || config.defaultProvider).toLowerCase();
  const opts = {
    languageCode: String(q.language || config.defaultLanguage),
    sampleRate: Number(q.sample_rate || config.defaultSampleRate),
    voice: q.voice ? String(q.voice) : undefined,
    model: q.model ? String(q.model) : undefined,
  };

  let provider;
  try {
    provider = createProvider(providerName, opts);
    await provider.connect();
  } catch (err) {
    sendJson(ws, { type: "error", message: err.message });
    try { ws.close(1011, err.message.slice(0, 120)); } catch {}
    return;
  }

  const connectedAt = Date.now();
  let lastFlushAt = 0;
  let firstAudioReported = false;
  let totalAudioBytes = 0;

  provider.on("audio", (pcm) => {
    if (!firstAudioReported && lastFlushAt) {
      sendJson(ws, { type: "ttfb", ms: Date.now() - lastFlushAt });
      firstAudioReported = true;
    }
    totalAudioBytes += pcm.length;
    if (ws.readyState === ws.OPEN) ws.send(pcm, { binary: true });
  });

  provider.on("complete", () => {
    sendJson(ws, { type: "complete", bytes: totalAudioBytes });
    firstAudioReported = false;
    totalAudioBytes = 0;
  });

  provider.on("error", (err) => {
    sendJson(ws, { type: "error", message: err.message || String(err) });
  });

  provider.on("reconnect", () => {
    sendJson(ws, { type: "reconnect" });
  });

  sendJson(ws, {
    type: "ready",
    provider: provider.name,
    voice: provider.voice,
    language: provider.languageCode,
    sample_rate: provider.sampleRate,
  });

  ws.on("message", async (raw) => {
    let msg;
    try { msg = JSON.parse(String(raw)); }
    catch { sendJson(ws, { type: "error", message: "invalid json" }); return; }

    try {
      if (msg.type === "text") {
        await provider.sendText(String(msg.text || ""));
      } else if (msg.type === "flush") {
        lastFlushAt = Date.now();
        firstAudioReported = false;
        totalAudioBytes = 0;
        await provider.flush();
      } else if (msg.type === "close") {
        await provider.close();
        try { ws.close(1000, "client_close"); } catch {}
      }
    } catch (err) {
      sendJson(ws, { type: "error", message: err.message });
    }
  });

  ws.on("close", async () => {
    try { await provider.close(); } catch {}
    const lifeMs = Date.now() - connectedAt;
    process.stdout.write(`[tts-gateway] session ended provider=${provider.name} life_ms=${lifeMs}\n`);
  });
});

function sendJson(ws, obj) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
}

httpServer.listen(PORT, () => {
  process.stdout.write(`[tts-gateway] listening :${PORT} providers=${listProviders().join(",")} default=${config.defaultProvider}\n`);
  process.stdout.write(`[tts-gateway] open http://localhost:${PORT}/ for the audition page\n`);
});

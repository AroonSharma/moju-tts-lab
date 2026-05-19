require("dotenv").config();

function env(name, fallback = "") {
  const v = process.env[name];
  return v === undefined || v === null || v === "" ? fallback : v;
}

function envNum(name, fallback) {
  const v = process.env[name];
  if (v === undefined || v === null || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

const config = {
  port: envNum("TTS_PORT", 8090),
  defaultProvider: env("TTS_PROVIDER", "google").toLowerCase(),
  defaultLanguage: env("TTS_LANGUAGE", "hi-IN"),
  defaultSampleRate: envNum("TTS_SAMPLE_RATE", 16000),

  sarvam: {
    apiKey: env("SARVAM_API_KEY"),
    voice: env("SARVAM_VOICE", "Shubh"),
    model: env("SARVAM_MODEL", "bulbul:v3"),
    pace: envNum("SARVAM_PACE", 0.85),
    wsUrl: env("SARVAM_WS_URL", "wss://api.sarvam.ai/text-to-speech/ws"),
  },

  google: {
    apiKey: env("GOOGLE_TTS_API_KEY"),
    voice: env("GOOGLE_TTS_VOICE", "hi-IN-Neural2-A"),
    speakingRate: envNum("GOOGLE_TTS_SPEAKING_RATE", 0.85),
    endpoint: env("GOOGLE_TTS_ENDPOINT", "https://texttospeech.googleapis.com/v1/text:synthesize"),
  },

  cartesia: {
    apiKey: env("CARTESIA_API_KEY"),
    version: env("CARTESIA_VERSION", "2024-11-13"),
    model: env("CARTESIA_MODEL", "sonic-2"),
    voice: env("CARTESIA_VOICE"),
    wsUrl: env("CARTESIA_WS_URL", "wss://api.cartesia.ai/tts/websocket"),
  },

  smallest: {
    apiKey: env("SMALLEST_API_KEY"),
    // Default to lightning-v2 because the popular Indic voices ("diya",
    // "raj", etc.) live there. Override with SMALLEST_MODEL=lightning-v3.1
    // (and the new endpoint) for the newer roster.
    model: env("SMALLEST_MODEL", "lightning-v2"),
    voice: env("SMALLEST_VOICE", "diya"),
    endpoint: env("SMALLEST_ENDPOINT", "https://waves-api.smallest.ai/api/v1"),
  },

  elevenlabs: {
    apiKey: env("ELEVENLABS_API_KEY"),
    model: env("ELEVENLABS_MODEL", "eleven_multilingual_v2"),
    voice: env("ELEVENLABS_VOICE"),
    wsUrl: env("ELEVENLABS_WS_URL", "wss://api.elevenlabs.io"),
  },
};

module.exports = { config };

#!/usr/bin/env node
/* eslint-disable no-console */
// Discover available voices for any provider. Filter by language.
//
// Usage:
//   node scripts/list-voices.js --provider smallest --language hi
//   node scripts/list-voices.js --provider elevenlabs
//
// Reads API keys from .env.

require("dotenv").config();

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

async function listSmallest({ apiKey, language }) {
  if (!apiKey) throw new Error("SMALLEST_API_KEY missing");
  const model = process.env.SMALLEST_MODEL || "lightning-v3.1";
  const base = (process.env.SMALLEST_ENDPOINT || "https://api.smallest.ai/waves/v1").replace(/\/$/, "");
  const url = `${base}/${model}/get_voices`;

  const res = await fetch(url, {
    method: "GET",
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) {
    throw new Error(`get_voices ${res.status}: ${(await res.text()).slice(0, 400)}`);
  }
  const json = await res.json();
  const list = Array.isArray(json) ? json : (json.voices || json.data || []);
  const lang = String(language || "").toLowerCase();

  const filtered = list.filter((v) => {
    if (!lang) return true;
    const tags = Array.isArray(v.tags) ? v.tags.map((t) => String(t).toLowerCase()) : [];
    const langs = Array.isArray(v.languages) ? v.languages.map((t) => String(t).toLowerCase()) : [];
    const tagMatch = tags.some((t) => t.includes(lang) || t.includes("hindi") || t === lang);
    const langMatch = langs.some((t) => t.includes(lang) || t.includes("hindi") || t === lang);
    return tagMatch || langMatch;
  });

  console.log(`smallest ${model}: ${list.length} voices total, ${filtered.length} match language=${lang || "*"}\n`);
  for (const v of filtered) {
    const id = v.voiceId || v.voice_id || v.id || "?";
    const name = v.displayName || v.name || "";
    const tags = Array.isArray(v.tags) ? v.tags.join(", ") : "";
    console.log(`  ${id.padEnd(28)}  ${name.padEnd(24)}  ${tags}`);
  }
}

async function listElevenlabs({ apiKey, language }) {
  if (!apiKey) throw new Error("ELEVENLABS_API_KEY missing");
  const res = await fetch("https://api.elevenlabs.io/v1/voices", {
    method: "GET",
    headers: { "xi-api-key": apiKey },
  });
  if (!res.ok) throw new Error(`elevenlabs voices ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = await res.json();
  const list = json.voices || [];
  const lang = String(language || "").toLowerCase();

  const filtered = list.filter((v) => {
    if (!lang) return true;
    const labels = v.labels || {};
    return Object.values(labels).some((val) => String(val).toLowerCase().includes(lang) || String(val).toLowerCase().includes("hindi"))
      || (v.high_quality_base_model_ids || []).some((m) => /multilingual/i.test(m));
  });

  console.log(`elevenlabs: ${list.length} voices total, showing ${filtered.length}\n`);
  for (const v of filtered) {
    const id = v.voice_id;
    const name = v.name || "";
    const labels = Object.entries(v.labels || {}).map(([k, val]) => `${k}=${val}`).join(", ");
    console.log(`  ${id.padEnd(28)}  ${name.padEnd(24)}  ${labels}`);
  }
}

async function listCartesia({ apiKey, language }) {
  if (!apiKey) throw new Error("CARTESIA_API_KEY missing");
  const version = process.env.CARTESIA_VERSION || "2024-11-13";
  const res = await fetch("https://api.cartesia.ai/voices", {
    headers: { "X-API-Key": apiKey, "Cartesia-Version": version },
  });
  if (!res.ok) throw new Error(`cartesia voices ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const list = await res.json();
  const lang = String(language || "").toLowerCase();

  const filtered = list.filter((v) => {
    if (!lang) return true;
    const langs = Array.isArray(v.language) ? v.language : [v.language].filter(Boolean);
    return langs.some((l) => String(l).toLowerCase().startsWith(lang));
  });

  console.log(`cartesia: ${list.length} voices total, ${filtered.length} match language=${lang || "*"}\n`);
  for (const v of filtered) {
    console.log(`  ${(v.id || "").padEnd(36)}  ${(v.name || "").padEnd(28)}  lang=${v.language}`);
  }
}

async function listGoogle({ apiKey, language }) {
  if (!apiKey) throw new Error("GOOGLE_TTS_API_KEY missing");
  const url = `https://texttospeech.googleapis.com/v1/voices?languageCode=${encodeURIComponent(language || "hi-IN")}&key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`google voices ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = await res.json();
  const list = json.voices || [];
  console.log(`google: ${list.length} voices for ${language || "hi-IN"}\n`);
  for (const v of list) {
    console.log(`  ${(v.name || "").padEnd(38)}  ${v.ssmlGender}`);
  }
}

async function listSarvam(_) {
  // Sarvam has a fixed roster — list what we know is valid for bulbul:v3.
  console.log("sarvam bulbul:v3 voices (static list):\n");
  for (const v of ["meera", "pavithra", "maitreyi", "arvind", "amol", "amartya", "diya", "neel", "misha", "vian", "arjun", "maya", "anushka", "abhilash", "manisha", "vidya", "arya", "karun", "hitesh", "shubh"]) {
    console.log(`  ${v}`);
  }
}

async function main() {
  const args = parseArgs(process.argv);
  const provider = (args.provider || "smallest").toLowerCase();
  const language = args.language || "hi";

  const apiKeyByProvider = {
    smallest: process.env.SMALLEST_API_KEY,
    elevenlabs: process.env.ELEVENLABS_API_KEY,
    cartesia: process.env.CARTESIA_API_KEY,
    google: process.env.GOOGLE_TTS_API_KEY,
    sarvam: process.env.SARVAM_API_KEY,
  };

  const dispatch = {
    smallest: listSmallest,
    elevenlabs: listElevenlabs,
    cartesia: listCartesia,
    google: listGoogle,
    sarvam: listSarvam,
  };

  if (!dispatch[provider]) {
    console.error(`unknown provider "${provider}". Use one of: ${Object.keys(dispatch).join(", ")}`);
    process.exit(1);
  }

  try {
    await dispatch[provider]({ apiKey: apiKeyByProvider[provider], language });
  } catch (err) {
    console.error(`✗ ${provider}: ${err.message}`);
    process.exit(1);
  }
}

main();

# moju-tts-lab

Provider-agnostic streaming TTS gateway. One WebSocket protocol; swap
between **Sarvam**, **Google Cloud TTS**, **Cartesia Sonic**,
**Smallest.ai Lightning**, and **ElevenLabs** with a query-string flag.

Built to let us A/B-audition voices for the [Moju](https://github.com/AroonSharma/moju)
kids' companion device — same Hindi line, every provider, side by side —
and to pick separate winners for *demo* (best quality) and *production*
(best price/latency) without touching the live `moju-redis` server.

## Quick start

```bash
git clone https://github.com/AroonSharma/moju-tts-lab.git
cd moju-tts-lab
npm install
cp .env.example .env       # fill in whichever provider keys you have
npm start                  # boots the gateway on :8090
open http://localhost:8090 # browser audition UI
```

Set only the keys you want to test — providers without a key are simply
unreachable, not fatal.

## Wire protocol

`GET ws://localhost:8090/tts?provider=<name>&voice=<id>&language=hi-IN&sample_rate=16000`

| Direction | Payload | Meaning |
| --- | --- | --- |
| `→` | `{ "type": "text", "text": "…" }` | Append text to the current utterance |
| `→` | `{ "type": "flush" }` | Finalize; server starts streaming audio |
| `→` | `{ "type": "close" }` | Tear down |
| `←` | `{ "type": "ready", "provider": …, "voice": …, "sample_rate": … }` | Backend connected |
| `←` | _binary frame_ | Raw PCM16 LE mono at `sample_rate` |
| `←` | `{ "type": "ttfb", "ms": 312 }` | First-audio latency since `flush` |
| `←` | `{ "type": "complete", "bytes": N }` | Current utterance drained |
| `←` | `{ "type": "error", "message": "…" }` | Provider/transport failure |

This intentionally mirrors the shape `Server/src/services/sarvam-stream.js`
exposes in the main moju repo, so when we pick winners we can repoint the
production `sarvamStream` instance at this gateway with a one-line URL
change (or lift the adapter classes wholesale).

## Providers

| Key | Backend | Connectivity | Notes |
| --- | --- | --- | --- |
| `sarvam` | Bulbul v3 | native WS | Baseline. Port of the moju adapter. |
| `google` | TTS v1 REST | REST → chunked | Voices: `hi-IN-Neural2-A/B/D`, `hi-IN-Chirp3-HD-Aoede/Kore/Puck`, `hi-IN-Wavenet-D` |
| `cartesia` | Sonic-2 / Sonic-3 | native WS | Needs a voice id from cartesia.ai/voices |
| `smallest` | Lightning V2 / V3.1 | REST → chunked | Indian provider, Hindi-first |
| `elevenlabs` | Multilingual v2 / Flash v2.5 | native WS | Needs a voice id from your voice library |

For REST providers we chunk the returned WAV into 20 ms PCM frames so the
client side sees the same streaming behaviour as the native-WS backends.

## CLI test

```bash
# In one terminal:
npm start

# In another:
node test-clients/cli-stream.js \
  --provider google \
  --voice hi-IN-Neural2-A \
  --text "एक छोटा खरगोश जंगल में अपनी माँ को ढूंढ रहा था।" \
  --out google-neural2-a.wav

open google-neural2-a.wav
```

Add `--provider sarvam` / `cartesia` / `smallest` / `elevenlabs` to
compare. The CLI prints `ttfb`, total wall time, and audio duration so
you can eyeball latency and cost-per-second.

## Browser audition

Open `http://localhost:8090/` after `npm start`. Type any Hindi or
English line, click **Generate on all enabled providers**, and each
provider/voice gets its own card with an HTML5 audio player + the TTFB
and wall-time metrics inline. Drop or add voices in the `PROVIDERS`
array at the bottom of `test-clients/index.html`.

## Picking winners

- **Demo voice:** optimise for warmth, prosody, kid-friendliness.
  Tradeoff acceptable: higher cost, slightly higher latency.
- **Production voice:** optimise for cost per hour + reliable TTFB.
  Latency should beat 400 ms to feel responsive on the ESP32.

Once you've picked, the next step is lifting the chosen adapter
(`src/providers/<name>.js`) into the moju Server behind a
`TtsStreamingProvider` factory alongside the existing Sarvam path.

## Repo layout

```
moju-tts-lab/
├── README.md
├── package.json
├── .env.example
├── src/
│   ├── server.js             # WS gateway
│   ├── config.js
│   ├── factory.js
│   └── providers/
│       ├── base.js           # Provider interface (EventEmitter)
│       ├── sarvam.js
│       ├── google.js
│       ├── cartesia.js
│       ├── smallest.js
│       └── elevenlabs.js
└── test-clients/
    ├── cli-stream.js         # Node CLI → WAV file
    └── index.html            # Browser audition UI (served at /)
```

## Status

- All five adapter classes implement the unified `TtsProvider` interface
  and have been syntax-checked. Sarvam and Google paths are the most
  exercised so far; Cartesia, Smallest, and ElevenLabs may need minor
  tweaks once each is wired with a real API key + voice id.
- The gateway has no auth and is intended for local audition only —
  **do not expose it on a public host with your API keys baked in.**

## License

MIT (we'll formalize when this graduates from playground to integration).

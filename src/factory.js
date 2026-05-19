const { SarvamProvider } = require("./providers/sarvam");
const { GoogleProvider } = require("./providers/google");
const { CartesiaProvider } = require("./providers/cartesia");
const { SmallestProvider } = require("./providers/smallest");
const { ElevenLabsProvider } = require("./providers/elevenlabs");

const REGISTRY = {
  sarvam: SarvamProvider,
  google: GoogleProvider,
  cartesia: CartesiaProvider,
  smallest: SmallestProvider,
  elevenlabs: ElevenLabsProvider,
};

function listProviders() {
  return Object.keys(REGISTRY);
}

function createProvider(name, options = {}) {
  const key = String(name || "").trim().toLowerCase();
  const Ctor = REGISTRY[key];
  if (!Ctor) {
    throw new Error(`unknown provider "${name}". Available: ${listProviders().join(", ")}`);
  }
  return new Ctor(options);
}

module.exports = { createProvider, listProviders };

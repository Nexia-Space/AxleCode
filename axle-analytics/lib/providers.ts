export interface ProviderInfo {
  id: string;
  name: string;
  url: string | null;
}

/**
 * Upstream providers reachable through the desktop's `axle` provider instance.
 * The usage events record the instance id (`axle`), so the real upstream is the
 * prefix of the model id (`tokenhabour/deepseek-v4.1-flash:free`).
 */
const PROVIDER_INFO: Record<string, { name: string; url: string | null }> = {
  axle: {
    name: "Axle Gateway",
    url: "https://axle-gateway.axle-download-worker.workers.dev/v1",
  },
  tokenhabour: {
    name: "Token Harbor",
    url: "https://tokenharbor.ai/v1",
  },
  "agent-router": {
    name: "Agent Router",
    url: "https://agentrouter.org/v1",
  },
  iteracompute: {
    name: "IteraCompute",
    url: "https://api.iteracompute.com/v1",
  },
  freetheai: {
    name: "FreeTheAI",
    url: "https://api.freetheai.org/v1",
  },
  "nvidia-nim": {
    name: "NVIDIA NIM",
    url: "https://integrate.api.nvidia.com/v1",
  },
  openai: { name: "OpenAI", url: "https://api.openai.com/v1" },
  anthropic: { name: "Anthropic", url: "https://api.anthropic.com/v1" },
  google: { name: "Google", url: "https://generativelanguage.googleapis.com/v1beta" },
  groq: { name: "Groq", url: "https://api.groq.com/openai/v1" },
  cerebras: { name: "Cerebras", url: "https://api.cerebras.ai/v1" },
  fireworks: { name: "Fireworks", url: "https://api.fireworks.ai/inference/v1" },
  openrouter: { name: "OpenRouter", url: "https://openrouter.ai/api/v1" },
  deepseek: { name: "DeepSeek", url: "https://api.deepseek.com/v1" },
  mistral: { name: "Mistral", url: "https://api.mistral.ai/v1" },
  xai: { name: "xAI", url: "https://api.x.ai/v1" },
  together: { name: "Together AI", url: "https://api.together.xyz/v1" },
  perplexity: { name: "Perplexity", url: "https://api.perplexity.ai" },
  moonshot: { name: "Moonshot AI", url: "https://api.moonshot.cn/v1" },
  dashscope: {
    name: "Alibaba DashScope",
    url: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
  },
  "ollama-cloud": { name: "Ollama Cloud", url: "https://ollama.com" },
  ollama: { name: "Ollama", url: null },
};

const PROVIDER_ALIASES: Record<string, string> = {
  tokenharbor: "tokenhabour",
  "token-harbor": "tokenhabour",
  agentrouter: "agent-router",
  agent_router: "agent-router",
  "itera-compute": "iteracompute",
  nvidia: "nvidia-nim",
  "nvidia_nim": "nvidia-nim",
  "free-the-ai": "freetheai",
  "free_the_ai": "freetheai",
};

export function normalizeProviderId(value: string): string {
  const id = value.trim().toLowerCase();
  if (id.length === 0) return "unknown";
  return PROVIDER_ALIASES[id] ?? id;
}

/** Real upstream from a usage event: model prefix first, then the recorded provider. */
export function providerFromModel(provider: unknown, model: unknown): string {
  const modelId = typeof model === "string" ? model.trim() : "";
  const slash = modelId.indexOf("/");
  if (slash > 0) return normalizeProviderId(modelId.slice(0, slash));
  return normalizeProviderId(typeof provider === "string" ? provider : "unknown");
}

export function providerInfo(value: string): ProviderInfo {
  const id = normalizeProviderId(value);
  const info = PROVIDER_INFO[id];
  return { id, name: info?.name ?? id, url: info?.url ?? null };
}

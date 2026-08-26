export type OAuthKind = "xai-device" | "openrouter-pkce" | "codex-device";

export type ProviderModel = { id: string; name: string };

export type ProviderDef = {
  id: string;
  label: string;
  base: string;
  modelHint: string;
  host: RegExp;
  chat: RegExp;
  recommend: string[];
  fallback: ProviderModel[];
  oauth?: OAuthKind;
};

export const PROVIDERS: ProviderDef[] = [
  {
    id: "openai",
    label: "OpenAI",
    base: "https://api.openai.com/v1",
    modelHint: "gpt-4o",
    host: /openai\.com/i,
    chat: /gpt|o[1-9]|chatgpt|codex/,
    recommend: ["gpt-4o", "gpt-4.1", "o3"],
    fallback: [
      { id: "gpt-4o", name: "GPT-4o" },
      { id: "gpt-4o-mini", name: "GPT-4o mini" },
      { id: "o3", name: "o3" },
    ],
  },
  {
    id: "codex",
    label: "Codex (ChatGPT)",
    base: "https://chatgpt.com/backend-api/codex",
    modelHint: "gpt-5.6-sol",
    host: /chatgpt\.com/i,
    chat: /codex|gpt-5/,
    // Doubles as the fallback ladder when the backend rejects a model with
    // the "not supported" 400 (retired slugs, plan-entitlement lag).
    recommend: ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna", "gpt-5.5", "gpt-5.2"],
    fallback: [
      { id: "gpt-5.6-sol", name: "GPT-5.6 Sol" },
      { id: "gpt-5.6-terra", name: "GPT-5.6 Terra" },
      { id: "gpt-5.6-luna", name: "GPT-5.6 Luna" },
      { id: "gpt-5.5", name: "GPT-5.5" },
      { id: "gpt-5.2", name: "GPT-5.2" },
    ],
    oauth: "codex-device",
  },
  {
    id: "anthropic",
    label: "Anthropic",
    base: "https://api.anthropic.com",
    modelHint: "claude-sonnet-4-5",
    host: /anthropic\.com/i,
    chat: /claude/,
    recommend: ["claude-sonnet-4", "claude-3-7-sonnet", "claude-3-5-sonnet"],
    fallback: [
      { id: "claude-sonnet-4-5", name: "Claude Sonnet 4.5" },
      { id: "claude-opus-4-1", name: "Claude Opus 4.1" },
    ],
  },
  {
    id: "xai",
    label: "xAI Grok",
    base: "https://api.x.ai/v1",
    modelHint: "grok-4.6",
    host: /(?:^|\.)x\.ai/i,
    chat: /grok/,
    recommend: ["grok-4.6", "grok-code-fast-1", "grok-4.5"],
    fallback: [
      { id: "grok-4.6", name: "Grok 4.6" },
      { id: "grok-4.5", name: "Grok 4.5" },
      { id: "grok-4.3", name: "Grok 4.3" },
      { id: "grok-code-fast-1", name: "Grok Code Fast" },
      { id: "grok-4-fast-reasoning", name: "Grok 4 Fast Reasoning" },
    ],
    oauth: "xai-device",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    base: "https://openrouter.ai/api/v1",
    modelHint: "any/* model id",
    host: /openrouter\.ai/i,
    chat: /./,
    recommend: ["anthropic/claude-sonnet", "openai/gpt-4o", "x-ai/grok-4.6"],
    fallback: [
      { id: "x-ai/grok-4.6", name: "Grok 4.6 (OpenRouter)" },
      { id: "anthropic/claude-sonnet-4.5", name: "Claude Sonnet 4.5" },
      { id: "openai/gpt-4o", name: "GPT-4o" },
    ],
    oauth: "openrouter-pkce",
  },
  {
    id: "google",
    label: "Google Gemini",
    base: "https://generativelanguage.googleapis.com/v1beta/openai",
    modelHint: "gemini-2.5-flash",
    host: /googleapis\.com|generativelanguage/i,
    chat: /gemini/,
    recommend: ["gemini-2.5-pro", "gemini-2.5-flash"],
    fallback: [
      { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash" },
      { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro" },
      { id: "gemini-2.0-flash", name: "Gemini 2.0 Flash" },
    ],
  },
  {
    id: "groq",
    label: "Groq",
    base: "https://api.groq.com/openai/v1",
    modelHint: "llama-3.3-70b-versatile",
    host: /groq\.com/i,
    chat: /llama|mixtral|gemma|qwen|deepseek|gpt/,
    recommend: ["llama-3.3-70b-versatile", "llama-3.1-8b-instant"],
    fallback: [
      { id: "llama-3.3-70b-versatile", name: "Llama 3.3 70B" },
      { id: "llama-3.1-8b-instant", name: "Llama 3.1 8B Instant" },
      { id: "mixtral-8x7b-32768", name: "Mixtral 8x7B" },
    ],
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    base: "https://api.deepseek.com",
    modelHint: "deepseek-chat",
    host: /deepseek\.com/i,
    chat: /deepseek/,
    recommend: ["deepseek-chat", "deepseek-reasoner"],
    fallback: [
      { id: "deepseek-chat", name: "DeepSeek Chat" },
      { id: "deepseek-reasoner", name: "DeepSeek Reasoner" },
    ],
  },
  {
    id: "mistral",
    label: "Mistral",
    base: "https://api.mistral.ai/v1",
    modelHint: "mistral-large-latest",
    host: /mistral\.ai/i,
    chat: /mistral|codestral|pixtral|ministral/,
    recommend: ["mistral-large-latest", "codestral-latest"],
    fallback: [
      { id: "mistral-large-latest", name: "Mistral Large" },
      { id: "mistral-small-latest", name: "Mistral Small" },
      { id: "codestral-latest", name: "Codestral" },
    ],
  },
  {
    id: "together",
    label: "Together",
    base: "https://api.together.xyz/v1",
    modelHint: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
    host: /together\.xyz/i,
    chat: /llama|qwen|deepseek|mistral|gemma/,
    recommend: ["meta-llama/Llama-3.3-70B-Instruct-Turbo"],
    fallback: [
      { id: "meta-llama/Llama-3.3-70B-Instruct-Turbo", name: "Llama 3.3 70B Turbo" },
      { id: "Qwen/Qwen2.5-72B-Instruct-Turbo", name: "Qwen 2.5 72B" },
    ],
  },
  {
    id: "fireworks",
    label: "Fireworks",
    base: "https://api.fireworks.ai/inference/v1",
    modelHint: "accounts/fireworks/models/llama-v3p3-70b-instruct",
    host: /fireworks\.ai/i,
    chat: /llama|qwen|deepseek|mixtral/,
    recommend: ["accounts/fireworks/models/llama-v3p3-70b-instruct"],
    fallback: [
      { id: "accounts/fireworks/models/llama-v3p3-70b-instruct", name: "Llama 3.3 70B" },
      { id: "accounts/fireworks/models/deepseek-v3", name: "DeepSeek V3" },
    ],
  },
  {
    id: "minimax",
    label: "MiniMax",
    base: "https://api.minimax.io/v1",
    modelHint: "MiniMax-M3",
    host: /minimax\.io|minimax\.chat|minimaxi\.com/i,
    chat: /minimax-m/i,
    recommend: ["MiniMax-M3", "MiniMax-M2.7"],
    fallback: [
      { id: "MiniMax-M3", name: "MiniMax M3" },
      { id: "MiniMax-M2.7", name: "MiniMax M2.7" },
      { id: "MiniMax-M2.7-highspeed", name: "MiniMax M2.7 highspeed" },
      { id: "MiniMax-M2.5", name: "MiniMax M2.5" },
    ],
  },
  {
    id: "zai",
    label: "Z.ai (GLM)",
    base: "https://api.z.ai/api/paas/v4",
    modelHint: "glm-4.7",
    host: /z\.ai/i,
    chat: /glm/i,
    recommend: ["glm-4.7", "glm-4.6"],
    fallback: [
      { id: "glm-4.7", name: "GLM-4.7" },
      { id: "glm-4.6", name: "GLM-4.6" },
      { id: "glm-4.5-air", name: "GLM-4.5 Air" },
    ],
  },
  {
    id: "moonshot",
    label: "Moonshot (Kimi)",
    base: "https://api.moonshot.ai/v1",
    modelHint: "kimi-k2-0905-preview",
    host: /moonshot\.(ai|cn)/i,
    chat: /kimi|moonshot/i,
    recommend: ["kimi-k2", "kimi-latest"],
    fallback: [
      { id: "kimi-k2-0905-preview", name: "Kimi K2" },
      { id: "kimi-latest", name: "Kimi Latest" },
    ],
  },
  {
    id: "qwen",
    label: "Qwen (DashScope)",
    base: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    modelHint: "qwen3-max",
    host: /dashscope\.aliyuncs\.com|aliyun/i,
    chat: /qwen/i,
    recommend: ["qwen3-max", "qwen3-coder"],
    fallback: [
      { id: "qwen3-max", name: "Qwen3 Max" },
      { id: "qwen3-coder", name: "Qwen3 Coder" },
      { id: "qwen-plus", name: "Qwen Plus" },
    ],
  },
  {
    id: "cerebras",
    label: "Cerebras",
    base: "https://api.cerebras.ai/v1",
    modelHint: "llama-3.3-70b",
    host: /cerebras\.ai/i,
    chat: /llama|qwen|gpt/i,
    recommend: ["llama-3.3-70b", "qwen-3-235b"],
    fallback: [
      { id: "llama-3.3-70b", name: "Llama 3.3 70B" },
      { id: "qwen-3-235b-a22b-instruct-2507", name: "Qwen 3 235B" },
    ],
  },
  {
    id: "deepinfra",
    label: "DeepInfra",
    base: "https://api.deepinfra.com/v1/openai",
    modelHint: "meta-llama/Llama-3.3-70B-Instruct",
    host: /deepinfra\.com/i,
    chat: /llama|qwen|deepseek|mistral|gemma/i,
    recommend: ["meta-llama/Llama-3.3-70B-Instruct"],
    fallback: [
      { id: "meta-llama/Llama-3.3-70B-Instruct", name: "Llama 3.3 70B" },
      { id: "deepseek-ai/DeepSeek-V3", name: "DeepSeek V3" },
    ],
  },
  {
    id: "ollama",
    label: "Ollama (local)",
    base: "http://localhost:11434/v1",
    modelHint: "llama3.2",
    host: /localhost:11434|127\.0\.0\.1:11434/i,
    chat: /./,
    recommend: ["llama3.2", "qwen3"],
    fallback: [
      { id: "llama3.2", name: "Llama 3.2 (local)" },
      { id: "qwen3", name: "Qwen 3 (local)" },
      { id: "deepseek-r1", name: "DeepSeek R1 (local)" },
    ],
  },
  {
    id: "lmstudio",
    label: "LM Studio (local)",
    base: "http://localhost:1234/v1",
    modelHint: "loaded model id",
    host: /localhost:1234|127\.0\.0\.1:1234/i,
    chat: /./,
    recommend: [],
    fallback: [],
  },
  {
    id: "vllm",
    label: "vLLM / llama.cpp (local)",
    base: "http://localhost:8000/v1",
    modelHint: "served model id",
    host: /localhost:8000|127\.0\.0\.1:8000/i,
    chat: /./,
    recommend: [],
    fallback: [],
  },
  {
    id: "custom",
    label: "Custom",
    base: "",
    modelHint: "local / proxy model",
    host: /$never^/,
    chat: /./,
    recommend: [],
    fallback: [],
  },
];

export const providerById = (id: string): ProviderDef =>
  PROVIDERS.find((p) => p.id === id) ?? PROVIDERS[PROVIDERS.length - 1]!;

export function detectProvider(provider: string, baseUrl?: string): ProviderDef {
  const host = baseUrl ?? "";
  const fromHost = PROVIDERS.find((p) => p.id !== "custom" && p.host.test(host));
  if (fromHost) return fromHost;
  return providerById(provider);
}

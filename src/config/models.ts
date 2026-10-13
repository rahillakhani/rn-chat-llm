// Models are downloaded on first launch, never bundled in the app binary.
// All files are GGUF so a single runtime (llama.rn / llama.cpp) handles both chat and embeddings.

export type ModelSpec = {
  id: string;
  label: string;
  fileName: string;
  url: string;
  sizeBytes: number;
};

export type ChatModelSpec = ModelSpec & {
  contextTokens: number;
};

export type EmbeddingModelSpec = ModelSpec & {
  dimensions: number;
};

// paraphrase-multilingual-MiniLM-L12-v2: maps English and Spanish (and ~50 other languages) into the
// same 384-dim space, so a question matches its FAQ in either language. Chosen by measurement on
// src/rag/__fixtures__/retrieval-eval.json: Q4_K_M scored the same as Q8_0 and is 7 MB smaller.
// Most of its size is the multilingual vocabulary, so heavier quantization barely shrinks it.
export const EMBEDDING_MODEL: EmbeddingModelSpec = {
  id: 'paraphrase-multilingual-minilm-l12-v2-q4km',
  label: 'Multilingual MiniLM (search)',
  fileName: 'paraphrase-multilingual-MiniLM-L12-118M-v2-Q4_K_M.gguf',
  url: 'https://huggingface.co/mykor/paraphrase-multilingual-MiniLM-L12-v2.gguf/resolve/main/paraphrase-multilingual-MiniLM-L12-118M-v2-Q4_K_M.gguf',
  sizeBytes: 124_835_104,
  dimensions: 384,
};

// Optional chat model for AI features, downloaded only when the user asks for it. The app works
// without it (search only).
// Heavier, better-quality alternatives (swap the fields below to try one):
// - SmolLM2-360M-Instruct Q4_K_M, 271 MB:
//   https://huggingface.co/bartowski/SmolLM2-360M-Instruct-GGUF/resolve/main/SmolLM2-360M-Instruct-Q4_K_M.gguf
// - Qwen2.5-0.5B-Instruct Q4_K_M, 491 MB:
//   https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/qwen2.5-0.5b-instruct-q4_k_m.gguf
export const CHAT_MODEL: ChatModelSpec = {
  id: 'smollm2-135m-q4km',
  label: 'SmolLM2 135M Instruct',
  fileName: 'SmolLM2-135M-Instruct-Q4_K_M.gguf',
  url: 'https://huggingface.co/bartowski/SmolLM2-135M-Instruct-GGUF/resolve/main/SmolLM2-135M-Instruct-Q4_K_M.gguf',
  sizeBytes: 105_454_432,
  contextTokens: 2048,
};

/** Downloaded automatically on first launch: enough for search-only answers. */
export const REQUIRED_MODELS: readonly ModelSpec[] = [EMBEDDING_MODEL];

/** Optional, downloaded only when the user asks for AI features. */
export const OPTIONAL_MODELS: readonly ModelSpec[] = [CHAT_MODEL];

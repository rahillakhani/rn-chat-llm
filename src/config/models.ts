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

// all-MiniLM-L6-v2: tiny (25 MB) sentence-embedding model, 384-dim vectors.
export const EMBEDDING_MODEL: EmbeddingModelSpec = {
  id: 'all-minilm-l6-v2-q8',
  label: 'all-MiniLM-L6-v2 (embeddings)',
  fileName: 'all-MiniLM-L6-v2-Q8_0.gguf',
  url: 'https://huggingface.co/second-state/All-MiniLM-L6-v2-Embedding-GGUF/resolve/main/all-MiniLM-L6-v2-Q8_0.gguf',
  sizeBytes: 25_008_064,
  dimensions: 384,
};

// The app always uses the lightest chat model. It is downloaded automatically on first launch.
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

/** Everything the app downloads on first launch, in order. */
export const REQUIRED_MODELS: readonly ModelSpec[] = [EMBEDDING_MODEL, CHAT_MODEL];

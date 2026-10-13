import { initLlama, type LlamaContext } from 'llama.rn';

import type { ChatModelSpec, EmbeddingModelSpec } from '../config/models';
import type { ChatMessage } from '../rag/prompt';

// Thin wrapper over llama.rn so the rest of the app doesn't depend on its API directly.
// Two separate contexts: a tiny embedding model for retrieval, and a tiny chat model for generation.

const STOP_WORDS = [
  '</s>',
  '<|end|>',
  '<|eot_id|>',
  '<|end_of_text|>',
  '<|im_end|>',
  '<|endoftext|>',
  '<end_of_turn>',
];

export type Embedder = {
  embed: (text: string) => Promise<Float32Array>;
  release: () => Promise<void>;
};

/** Where the chat model actually runs. GPU is used only if the phone's driver supports it. */
export type Accelerator = { kind: 'GPU'; devices: string[] } | { kind: 'CPU'; reason: string };

export type Generator = {
  accelerator: Accelerator;
  generate: (messages: ChatMessage[], onToken: (token: string) => void) => Promise<string>;
  stop: () => Promise<void>;
  release: () => Promise<void>;
};

export async function loadEmbedder(spec: EmbeddingModelSpec, path: string): Promise<Embedder> {
  const ctx: LlamaContext = await initLlama({
    model: path,
    embedding: true,
    pooling_type: 'mean',
    n_ctx: 512,
    n_batch: 512,
    n_ubatch: 512,
    n_gpu_layers: 0,
  });
  return {
    async embed(text) {
      // embd_normalize: 2 => L2-normalised vectors, so cosine == dot product.
      const { embedding } = await ctx.embedding(text, { embd_normalize: 2 });
      if (embedding.length !== spec.dimensions) {
        throw new Error(`Expected ${spec.dimensions}-dim embedding, got ${embedding.length}`);
      }
      return Float32Array.from(embedding);
    },
    release: () => ctx.release(),
  };
}

export async function loadGenerator(spec: ChatModelSpec, path: string): Promise<Generator> {
  const ctx: LlamaContext = await initLlama({
    model: path,
    n_ctx: spec.contextTokens,
    // Offload all layers: Metal on iOS, OpenCL on Android (Qualcomm Adreno 700+).
    // llama.cpp falls back to CPU by itself when no supported GPU is found.
    n_gpu_layers: 99,
    use_mlock: false,
  });
  return {
    accelerator: ctx.gpu
      ? { kind: 'GPU', devices: ctx.devices ?? [] }
      : { kind: 'CPU', reason: ctx.reasonNoGPU },
    async generate(messages, onToken) {
      const result = await ctx.completion(
        {
          messages,
          n_predict: 160,
          temperature: 0.2,
          top_p: 0.9,
          stop: STOP_WORDS,
        },
        (data) => onToken(data.token),
      );
      return result.text;
    },
    stop: () => ctx.stopCompletion(),
    release: () => ctx.release(),
  };
}

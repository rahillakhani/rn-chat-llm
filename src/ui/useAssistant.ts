import { useCallback, useEffect, useRef, useState } from 'react';

import { CHAT_MODEL, EMBEDDING_MODEL, REQUIRED_MODELS, type ChatModelSpec } from '../config/models';
import faqJson from '../data/faq.json';
import { FaqDatasetSchema, type FaqItem } from '../data/faqSchema';
import { openFaqStore, type FaqStore, type VectorBackend } from '../db/faqStore';
import {
  loadEmbedder,
  loadGenerator,
  type Accelerator,
  type Embedder,
  type Generator,
} from '../llm/engine';
import {
  downloadModel,
  isModelDownloaded,
  modelFile,
  type DownloadProgress,
} from '../models/modelFiles';
import { answerQuestion, prepareIndex, type BotAnswer } from '../rag/faqBot';

export type AssistantState =
  | { status: 'DOWNLOADING'; label: string; progress: DownloadProgress }
  | { status: 'PAUSED' }
  | { status: 'LOADING'; message: string }
  | { status: 'INDEXING'; done: number; total: number }
  | {
      status: 'READY';
      chatModel: ChatModelSpec;
      backend: VectorBackend;
      accelerator: Accelerator;
      faqCount: number;
    }
  | { status: 'ERROR'; message: string };

type Runtime = { store: FaqStore; embedder: Embedder; generator: Generator };

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

const LOADING_STATE: AssistantState = {
  status: 'LOADING',
  message: 'Loading FAQ database and models…',
};

/**
 * App lifecycle: on launch, download any missing model (first boot only), build the FAQ
 * vector index if needed, load the models, then hand over to the chat screen.
 */
export function useAssistant() {
  const [state, setState] = useState<AssistantState>(LOADING_STATE);
  const runtime = useRef<Runtime | null>(null);
  const abort = useRef<AbortController | null>(null);

  const loadRuntime = useCallback(async () => {
    const dataset = FaqDatasetSchema.parse(faqJson);
    const store = openFaqStore(EMBEDDING_MODEL.dimensions);
    const embedder = await loadEmbedder(EMBEDDING_MODEL, modelFile(EMBEDDING_MODEL).uri);

    await prepareIndex(store, embedder, dataset, EMBEDDING_MODEL, (done, total) =>
      setState({ status: 'INDEXING', done, total }),
    );

    setState({ status: 'LOADING', message: `Loading ${CHAT_MODEL.label}…` });
    const generator = await loadGenerator(CHAT_MODEL, modelFile(CHAT_MODEL).uri);

    runtime.current = { store, embedder, generator };
    setState({
      status: 'READY',
      chatModel: CHAT_MODEL,
      backend: store.backend,
      accelerator: generator.accelerator,
      faqCount: await store.count(),
    });
  }, []);

  const setup = useCallback(async () => {
    const controller = new AbortController();
    abort.current = controller;
    try {
      for (const spec of REQUIRED_MODELS.filter((m) => !isModelDownloaded(m))) {
        setState({
          status: 'DOWNLOADING',
          label: spec.label,
          progress: { bytesWritten: 0, totalBytes: spec.sizeBytes },
        });
        await downloadModel(
          spec,
          (progress) => setState({ status: 'DOWNLOADING', label: spec.label, progress }),
          controller.signal,
        );
      }
      abort.current = null;
      setState(LOADING_STATE);
      await loadRuntime();
    } catch (e) {
      setState(
        controller.signal.aborted
          ? { status: 'PAUSED' }
          : { status: 'ERROR', message: errorMessage(e) },
      );
    } finally {
      if (abort.current === controller) abort.current = null;
    }
  }, [loadRuntime]);

  useEffect(() => {
    // Starts the download / native model loading on launch; state updates land after awaits.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void setup();
    return () => {
      abort.current?.abort();
      const rt = runtime.current;
      runtime.current = null;
      void rt?.embedder.release();
      void rt?.generator.release();
    };
  }, [setup]);

  const cancelDownload = useCallback(() => abort.current?.abort(), []);

  const ask = useCallback(
    async (question: string, onToken: (partial: string) => void): Promise<BotAnswer> => {
      const rt = runtime.current;
      if (!rt) throw new Error('Assistant is not ready yet.');
      return answerQuestion(question, rt, onToken);
    },
    [],
  );

  const listFaqs = useCallback(async (): Promise<FaqItem[]> => {
    const rt = runtime.current;
    if (!rt) throw new Error('Assistant is not ready yet.');
    return rt.store.allItems();
  }, []);

  const stopGenerating = useCallback(() => {
    void runtime.current?.generator.stop();
  }, []);

  return { state, retry: setup, cancelDownload, ask, listFaqs, stopGenerating };
}

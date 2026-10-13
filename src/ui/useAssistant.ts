import { useCallback, useEffect, useRef, useState } from 'react';

import { CHAT_MODEL, EMBEDDING_MODEL, OPTIONAL_MODELS, REQUIRED_MODELS } from '../config/models';
import faqJson from '../data/faq.json';
import { FaqDatasetSchema, type FaqItem } from '../data/faqSchema';
import { openFaqStore, type VectorBackend } from '../db/faqStore';
import type { Lang } from '../i18n/lang';
import { loadEmbedder, loadGenerator, type Accelerator } from '../llm/engine';
import {
  deleteModel,
  deleteUnusedModels,
  downloadModel,
  isModelDownloaded,
  modelFile,
  type DownloadProgress,
} from '../models/modelFiles';
import {
  answerQuestion,
  prepareIndex,
  type AnswerMode,
  type BotAnswer,
  type BotDeps,
} from '../rag/faqBot';

/** Search setup: required before the chat screen opens. */
export type AssistantState =
  | { status: 'DOWNLOADING'; label: string; progress: DownloadProgress }
  | { status: 'PAUSED' }
  | { status: 'LOADING' }
  | { status: 'INDEXING'; done: number; total: number }
  | { status: 'READY'; backend: VectorBackend; faqCount: number }
  | { status: 'ERROR'; message: string };

/** The optional LLM. The chat works in every state; AI features only in READY. */
export type AiState =
  | { status: 'NOT_DOWNLOADED' }
  | { status: 'DOWNLOADING'; progress: DownloadProgress }
  | { status: 'LOADING' }
  | { status: 'READY'; label: string; accelerator: Accelerator }
  | { status: 'ERROR'; message: string };

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * App lifecycle: on launch, download the search model if missing (first boot only), build the FAQ
 * vector index if needed, and open the chat in search-only mode. If the user has downloaded the
 * optional LLM, it is loaded in the background and AI features switch on when it is ready.
 */
export function useAssistant() {
  const [state, setState] = useState<AssistantState>({ status: 'LOADING' });
  const [ai, setAi] = useState<AiState>({ status: 'NOT_DOWNLOADED' });
  const runtime = useRef<BotDeps | null>(null);
  const abort = useRef<AbortController | null>(null);
  const aiAbort = useRef<AbortController | null>(null);

  const loadAi = useCallback(async () => {
    const rt = runtime.current;
    if (!rt) return;
    setAi({ status: 'LOADING' });
    try {
      const generator = await loadGenerator(CHAT_MODEL, modelFile(CHAT_MODEL).uri);
      rt.generator = generator;
      setAi({ status: 'READY', label: CHAT_MODEL.label, accelerator: generator.accelerator });
    } catch (e) {
      setAi({ status: 'ERROR', message: errorMessage(e) });
    }
  }, []);

  const setup = useCallback(async () => {
    const controller = new AbortController();
    abort.current = controller;
    try {
      deleteUnusedModels([...REQUIRED_MODELS, ...OPTIONAL_MODELS]);
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
      setState({ status: 'LOADING' });

      const dataset = FaqDatasetSchema.parse(faqJson);
      const store = openFaqStore(EMBEDDING_MODEL.dimensions);
      const embedder = await loadEmbedder(EMBEDDING_MODEL, modelFile(EMBEDDING_MODEL).uri);
      const { lexical, vocabulary } = await prepareIndex(
        store,
        embedder,
        dataset,
        EMBEDDING_MODEL,
        (done, total) => setState({ status: 'INDEXING', done, total }),
      );
      runtime.current = { store, embedder, generator: null, lexical, vocabulary };
      setState({ status: 'READY', backend: store.backend, faqCount: await store.count() });

      // Chat is usable now; bring up AI features in the background if the user downloaded them.
      if (isModelDownloaded(CHAT_MODEL)) void loadAi();
    } catch (e) {
      setState(
        controller.signal.aborted
          ? { status: 'PAUSED' }
          : { status: 'ERROR', message: errorMessage(e) },
      );
    } finally {
      if (abort.current === controller) abort.current = null;
    }
  }, [loadAi]);

  useEffect(() => {
    // Starts the download / native model loading on launch; state updates land after awaits.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void setup();
    return () => {
      abort.current?.abort();
      aiAbort.current?.abort();
      const rt = runtime.current;
      runtime.current = null;
      void rt?.embedder.release();
      void rt?.generator?.release();
    };
  }, [setup]);

  const cancelDownload = useCallback(() => abort.current?.abort(), []);

  const downloadAi = useCallback(async () => {
    const controller = new AbortController();
    aiAbort.current = controller;
    try {
      setAi({
        status: 'DOWNLOADING',
        progress: { bytesWritten: 0, totalBytes: CHAT_MODEL.sizeBytes },
      });
      await downloadModel(
        CHAT_MODEL,
        (progress) => setAi({ status: 'DOWNLOADING', progress }),
        controller.signal,
      );
      aiAbort.current = null;
      await loadAi();
    } catch (e) {
      setAi(
        controller.signal.aborted
          ? { status: 'NOT_DOWNLOADED' }
          : { status: 'ERROR', message: errorMessage(e) },
      );
    } finally {
      if (aiAbort.current === controller) aiAbort.current = null;
    }
  }, [loadAi]);

  const cancelAiDownload = useCallback(() => aiAbort.current?.abort(), []);

  /** Back to search only: unload the LLM and delete its file to free the space. */
  const removeAi = useCallback(async () => {
    const rt = runtime.current;
    const generator = rt?.generator;
    if (rt) rt.generator = null;
    await generator?.release();
    deleteModel(CHAT_MODEL);
    setAi({ status: 'NOT_DOWNLOADED' });
  }, []);

  const ask = useCallback(
    async (
      question: string,
      uiLang: Lang,
      mode: AnswerMode,
      onToken: (partial: string) => void,
    ): Promise<BotAnswer> => {
      const rt = runtime.current;
      if (!rt) throw new Error('Assistant is not ready yet.');
      return answerQuestion(question, uiLang, mode, rt, onToken);
    },
    [],
  );

  const listFaqs = useCallback(async (lang: Lang): Promise<FaqItem[]> => {
    const rt = runtime.current;
    if (!rt) throw new Error('Assistant is not ready yet.');
    return rt.store.allItems(lang);
  }, []);

  const stopGenerating = useCallback(() => {
    void runtime.current?.generator?.stop();
  }, []);

  return {
    state,
    ai,
    retry: setup,
    cancelDownload,
    downloadAi,
    cancelAiDownload,
    removeAi,
    ask,
    listFaqs,
    stopGenerating,
  };
}

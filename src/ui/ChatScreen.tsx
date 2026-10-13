import { useCallback, useRef, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import type { FaqItem } from '../data/faqSchema';
import type { BotAnswer } from '../rag/faqBot';
import type { RetrievedFaq } from '../rag/retrieval';
import { FaqListModal } from './FaqListModal';
import { colors } from './theme';
import type { AssistantState } from './useAssistant';

type Message =
  | { id: string; role: 'user'; text: string }
  | { id: string; role: 'bot'; text: string; pending: boolean; sources: RetrievedFaq[] };

type Props = {
  state: Extract<AssistantState, { status: 'READY' }>;
  ask: (question: string, onToken: (partial: string) => void) => Promise<BotAnswer>;
  listFaqs: () => Promise<FaqItem[]>;
  onStop: () => void;
};

const SUGGESTIONS = [
  'How do I reset my password?',
  'When do I get my refund?',
  'Do you ship abroad?',
];

export function ChatScreen({ state, ask, listFaqs, onStop }: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [showFaqs, setShowFaqs] = useState(false);
  const nextId = useRef(0);
  const listRef = useRef<FlatList<Message>>(null);

  const updateBot = useCallback((id: string, patch: Partial<Extract<Message, { role: 'bot' }>>) => {
    setMessages((prev) =>
      prev.map((m) => (m.id === id && m.role === 'bot' ? { ...m, ...patch } : m)),
    );
  }, []);

  const send = useCallback(
    async (raw: string) => {
      const question = raw.trim();
      if (!question || busy) return;
      setInput('');
      setBusy(true);
      const userId = String(nextId.current++);
      const botId = String(nextId.current++);
      setMessages((prev) => [
        ...prev,
        { id: userId, role: 'user', text: question },
        { id: botId, role: 'bot', text: '', pending: true, sources: [] },
      ]);
      try {
        const answer = await ask(question, (partial) => updateBot(botId, { text: partial }));
        updateBot(botId, {
          text: answer.text,
          pending: false,
          sources: answer.kind === 'ANSWER' ? answer.sources : [],
        });
      } catch (e) {
        updateBot(botId, {
          text: `Something went wrong: ${e instanceof Error ? e.message : String(e)}`,
          pending: false,
        });
      } finally {
        setBusy(false);
      }
    },
    [ask, busy, updateBot],
  );

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.header}>
        <View style={styles.flex}>
          <Text style={styles.headerTitle}>FAQ Assistant</Text>
          <Text style={styles.headerSub}>
            {state.chatModel.label} · {state.accelerator.kind} · {state.faqCount} FAQs ·{' '}
            {state.backend}
          </Text>
        </View>
        <View style={styles.headerActions}>
          <Pressable onPress={() => setShowFaqs(true)} accessibilityRole="button">
            <Text style={styles.link}>FAQ list</Text>
          </Pressable>
        </View>
      </View>

      <FaqListModal
        visible={showFaqs}
        listFaqs={listFaqs}
        onClose={() => setShowFaqs(false)}
        onAsk={(question) => {
          setShowFaqs(false);
          void send(question);
        }}
      />

      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(m) => m.id}
        contentContainerStyle={styles.list}
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.muted}>Ask anything about orders, shipping, returns…</Text>
            <Pressable style={styles.chip} onPress={() => setShowFaqs(true)}>
              <Text style={styles.chipText}>Browse all FAQs</Text>
            </Pressable>
            {SUGGESTIONS.map((s) => (
              <Pressable key={s} style={styles.chip} onPress={() => void send(s)}>
                <Text style={styles.chipText}>{s}</Text>
              </Pressable>
            ))}
          </View>
        }
        renderItem={({ item }) =>
          item.role === 'user' ? (
            <View style={[styles.bubble, styles.userBubble]}>
              <Text style={styles.userText}>{item.text}</Text>
            </View>
          ) : (
            <View style={[styles.bubble, styles.botBubble]}>
              <Text style={styles.botText}>
                {item.text || (item.pending ? 'Searching the FAQ…' : '')}
              </Text>
              {item.sources.length > 0 && (
                <View style={styles.sources}>
                  {item.sources.map((s) => (
                    <Text key={s.id} style={styles.sourceText}>
                      ↳ {s.question} ({(s.similarity * 100).toFixed(0)}% match)
                    </Text>
                  ))}
                </View>
              )}
            </View>
          )
        }
      />

      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          value={input}
          onChangeText={setInput}
          placeholder="Type your question"
          accessibilityLabel="Question"
          editable={!busy}
          onSubmitEditing={() => void send(input)}
          returnKeyType="send"
        />
        {busy ? (
          <Pressable style={styles.sendButton} onPress={onStop} accessibilityRole="button">
            <Text style={styles.sendText}>Stop</Text>
          </Pressable>
        ) : (
          <Pressable
            style={styles.sendButton}
            onPress={() => void send(input)}
            accessibilityRole="button"
          >
            <Text style={styles.sendText}>Send</Text>
          </Pressable>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
  },
  headerTitle: { fontSize: 18, fontWeight: '700', color: colors.text },
  headerSub: { fontSize: 12, color: colors.muted },
  headerActions: { alignItems: 'flex-end', gap: 6 },
  link: { color: colors.primary, fontSize: 14 },
  list: { padding: 16, gap: 10, flexGrow: 1 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 },
  muted: { color: colors.muted, fontSize: 14 },
  chip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: colors.surface,
  },
  chipText: { color: colors.text },
  bubble: { maxWidth: '85%', borderRadius: 14, padding: 12 },
  userBubble: { alignSelf: 'flex-end', backgroundColor: colors.userBubble },
  botBubble: {
    alignSelf: 'flex-start',
    backgroundColor: colors.botBubble,
    borderWidth: 1,
    borderColor: colors.border,
  },
  userText: { color: colors.primaryText, fontSize: 15 },
  botText: { color: colors.text, fontSize: 15 },
  sources: { marginTop: 8, gap: 2 },
  sourceText: { color: colors.muted, fontSize: 12 },
  inputRow: {
    flexDirection: 'row',
    gap: 8,
    padding: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
    color: colors.text,
  },
  sendButton: {
    backgroundColor: colors.primary,
    borderRadius: 20,
    paddingHorizontal: 18,
    justifyContent: 'center',
  },
  sendText: { color: colors.primaryText, fontWeight: '600' },
});

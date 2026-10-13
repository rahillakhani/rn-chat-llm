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
import type { Lang } from '../i18n/lang';
import { STRINGS, type Strings } from '../i18n/strings';
import type { BotAnswer } from '../rag/faqBot';
import { FaqListModal } from './FaqListModal';
import { colors } from './theme';
import type { AssistantState } from './useAssistant';

type BotMessage = {
  id: string;
  role: 'bot';
  text: string;
  pending: boolean;
  /** Language of the reply (follows the question), for its labels. */
  lang: Lang;
  source?: { question: string; similarity: number };
  /** Tappable questions: "Did you mean…" runners-up, or the choices when the bot isn't sure. */
  related: FaqItem[];
  relatedIsChoice?: boolean;
};

type Message = { id: string; role: 'user'; text: string } | BotMessage;

type Props = {
  state: Extract<AssistantState, { status: 'READY' }>;
  lang: Lang;
  t: Strings;
  onChangeLang: (lang: Lang) => void;
  ask: (question: string, uiLang: Lang, onToken: (partial: string) => void) => Promise<BotAnswer>;
  listFaqs: (lang: Lang) => Promise<FaqItem[]>;
  onStop: () => void;
};

export function ChatScreen({ state, lang, t, onChangeLang, ask, listFaqs, onStop }: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [showFaqs, setShowFaqs] = useState(false);
  const nextId = useRef(0);
  const listRef = useRef<FlatList<Message>>(null);

  const updateBot = useCallback((id: string, patch: Partial<BotMessage>) => {
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
        { id: botId, role: 'bot', text: '', pending: true, lang, related: [] },
      ]);
      try {
        const answer = await ask(question, lang, (partial) => updateBot(botId, { text: partial }));
        updateBot(
          botId,
          answer.kind === 'ANSWER'
            ? {
                text: answer.text,
                pending: false,
                lang: answer.lang,
                source: answer.source,
                related: answer.related,
              }
            : answer.kind === 'SUGGEST'
              ? {
                  text: STRINGS[answer.lang].notSure,
                  pending: false,
                  lang: answer.lang,
                  related: answer.options,
                  relatedIsChoice: true,
                }
              : { text: STRINGS[answer.lang].noMatch, pending: false, lang: answer.lang },
        );
      } catch (e) {
        updateBot(botId, {
          text: t.error(e instanceof Error ? e.message : String(e)),
          pending: false,
        });
      } finally {
        setBusy(false);
      }
    },
    [ask, busy, lang, t, updateBot],
  );

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.header}>
        <View style={styles.flex}>
          <Text style={styles.headerTitle}>{t.chatTitle}</Text>
          <Text style={styles.headerSub}>
            {state.chatModel.label} · {state.accelerator.kind} · {state.faqCount} FAQs ·{' '}
            {state.backend}
          </Text>
        </View>
        <View style={styles.headerActions}>
          <View style={styles.langToggle} accessibilityRole="radiogroup">
            {(['en', 'es'] as const).map((l) => (
              <Pressable
                key={l}
                onPress={() => onChangeLang(l)}
                accessibilityRole="radio"
                accessibilityState={{ selected: l === lang }}
                style={[styles.langOption, l === lang && styles.langOptionActive]}
              >
                <Text style={[styles.langText, l === lang && styles.langTextActive]}>
                  {l.toUpperCase()}
                </Text>
              </Pressable>
            ))}
          </View>
          <Pressable onPress={() => setShowFaqs(true)} accessibilityRole="button">
            <Text style={styles.link}>{t.faqList}</Text>
          </Pressable>
        </View>
      </View>

      <FaqListModal
        visible={showFaqs}
        lang={lang}
        t={t}
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
            <Text style={styles.muted}>{t.emptyHint}</Text>
            <Pressable style={styles.chip} onPress={() => setShowFaqs(true)}>
              <Text style={styles.chipText}>{t.browseFaqs}</Text>
            </Pressable>
            {t.suggestions.map((s) => (
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
                {item.text || (item.pending ? STRINGS[item.lang].searching : '')}
              </Text>
              {item.source && (
                <Text style={styles.sourceText}>
                  {STRINGS[item.lang].sourceLabel(
                    item.source.question,
                    Math.round(item.source.similarity * 100),
                  )}
                </Text>
              )}
              {item.related.length > 0 && (
                <View style={styles.sources}>
                  {!item.relatedIsChoice && (
                    <Text style={styles.sourceText}>{STRINGS[item.lang].didYouMean}</Text>
                  )}
                  {item.related.map((r) => (
                    <Pressable
                      key={r.id}
                      style={styles.chip}
                      onPress={() => void send(r.question)}
                      accessibilityRole="button"
                    >
                      <Text style={styles.chipText}>{r.question}</Text>
                    </Pressable>
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
          placeholder={t.placeholder}
          accessibilityLabel={t.placeholder}
          editable={!busy}
          onSubmitEditing={() => void send(input)}
          returnKeyType="send"
        />
        {busy ? (
          <Pressable style={styles.sendButton} onPress={onStop} accessibilityRole="button">
            <Text style={styles.sendText}>{t.stop}</Text>
          </Pressable>
        ) : (
          <Pressable
            style={styles.sendButton}
            onPress={() => void send(input)}
            accessibilityRole="button"
          >
            <Text style={styles.sendText}>{t.send}</Text>
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
  langToggle: {
    flexDirection: 'row',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    overflow: 'hidden',
  },
  langOption: { paddingHorizontal: 10, paddingVertical: 4 },
  langOptionActive: { backgroundColor: colors.primary },
  langText: { fontSize: 12, fontWeight: '600', color: colors.muted },
  langTextActive: { color: colors.primaryText },
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
  sources: { marginTop: 8, gap: 6, alignItems: 'flex-start' },
  sourceText: { color: colors.muted, fontSize: 12, marginTop: 6 },
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

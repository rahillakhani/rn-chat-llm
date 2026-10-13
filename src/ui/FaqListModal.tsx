import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  SectionList,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { FaqItem } from '../data/faqSchema';
import { colors } from './theme';

type Props = {
  visible: boolean;
  listFaqs: () => Promise<FaqItem[]>;
  onAsk: (question: string) => void;
  onClose: () => void;
};

type LoadState =
  | { status: 'LOADING' }
  | { status: 'LOADED'; items: FaqItem[] }
  | { status: 'ERROR'; message: string };

/** Tester reference: every FAQ stored in SQLite, grouped by category. Tap a question to ask it. */
export function FaqListModal({ visible, listFaqs, onAsk, onClose }: Props) {
  const [load, setLoad] = useState<LoadState>({ status: 'LOADING' });
  const [filter, setFilter] = useState('');

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    listFaqs().then(
      (items) => !cancelled && setLoad({ status: 'LOADED', items }),
      (e: unknown) =>
        !cancelled &&
        setLoad({ status: 'ERROR', message: e instanceof Error ? e.message : String(e) }),
    );
    return () => {
      cancelled = true;
    };
  }, [visible, listFaqs]);

  const sections = useMemo(() => {
    if (load.status !== 'LOADED') return [];
    const needle = filter.trim().toLowerCase();
    const byCategory = new Map<string, FaqItem[]>();
    for (const item of load.items) {
      if (needle && !item.question.toLowerCase().includes(needle)) continue;
      byCategory.set(item.category, [...(byCategory.get(item.category) ?? []), item]);
    }
    return [...byCategory].map(([title, data]) => ({ title, data }));
  }, [load, filter]);

  const total = load.status === 'LOADED' ? load.items.length : 0;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.root}>
        <View style={styles.header}>
          <View style={styles.flex}>
            <Text style={styles.title}>FAQ list</Text>
            <Text style={styles.sub}>{total} questions · tap one to ask the chatbot</Text>
          </View>
          <Pressable onPress={onClose} accessibilityRole="button">
            <Text style={styles.link}>Close</Text>
          </Pressable>
        </View>

        <TextInput
          style={styles.search}
          value={filter}
          onChangeText={setFilter}
          placeholder="Filter questions"
          accessibilityLabel="Filter questions"
        />

        {load.status === 'LOADING' && (
          <ActivityIndicator style={styles.pad} color={colors.primary} />
        )}
        {load.status === 'ERROR' && <Text style={styles.error}>{load.message}</Text>}
        {load.status === 'LOADED' && (
          <SectionList
            sections={sections}
            keyExtractor={(item) => String(item.id)}
            contentContainerStyle={styles.list}
            stickySectionHeadersEnabled
            ListEmptyComponent={<Text style={styles.sub}>No questions match “{filter}”.</Text>}
            renderSectionHeader={({ section }) => (
              <Text style={styles.sectionHeader}>
                {section.title} ({section.data.length})
              </Text>
            )}
            renderItem={({ item }) => (
              <Pressable
                style={styles.row}
                onPress={() => onAsk(item.question)}
                accessibilityRole="button"
                accessibilityHint="Asks this question in the chat"
              >
                <Text style={styles.question}>
                  <Text style={styles.id}>#{item.id} </Text>
                  {item.question}
                </Text>
                <Text style={styles.answer}>{item.answer}</Text>
              </Pressable>
            )}
          />
        )}
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
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
  title: { fontSize: 18, fontWeight: '700', color: colors.text },
  sub: { fontSize: 12, color: colors.muted },
  link: { color: colors.primary, fontSize: 14 },
  search: {
    margin: 12,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: colors.surface,
    color: colors.text,
  },
  pad: { padding: 24 },
  error: { color: colors.danger, padding: 16 },
  list: { paddingHorizontal: 12, paddingBottom: 24 },
  sectionHeader: {
    backgroundColor: colors.bg,
    paddingVertical: 6,
    fontSize: 13,
    fontWeight: '700',
    color: colors.muted,
    textTransform: 'uppercase',
  },
  row: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
    gap: 4,
  },
  id: { color: colors.muted, fontWeight: '400' },
  question: { fontSize: 15, fontWeight: '600', color: colors.text },
  answer: { fontSize: 13, color: colors.muted },
});

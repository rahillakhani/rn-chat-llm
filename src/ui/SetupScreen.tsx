import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { CHAT_MODEL, EMBEDDING_MODEL } from '../config/models';
import { formatBytes } from '../models/modelFiles';
import { colors } from './theme';
import type { AssistantState } from './useAssistant';

type Props = {
  state: Exclude<AssistantState, { status: 'READY' }>;
  onRetry: () => void;
  onCancel: () => void;
};

const TOTAL_DOWNLOAD_BYTES = CHAT_MODEL.sizeBytes + EMBEDDING_MODEL.sizeBytes;

/** Shown until the chatbot is ready: first-launch download progress, then model loading. */
export function SetupScreen({ state, onRetry, onCancel }: Props) {
  if (state.status === 'DOWNLOADING') {
    const { bytesWritten, totalBytes } = state.progress;
    const pct = totalBytes > 0 ? Math.min(100, (bytesWritten / totalBytes) * 100) : 0;
    return (
      <View style={styles.center}>
        <Text style={styles.title}>Setting up the offline assistant</Text>
        <Text style={styles.muted}>
          One-time download of the AI models ({formatBytes(TOTAL_DOWNLOAD_BYTES)} total). After
          this, the chatbot works without internet.
        </Text>
        <Text style={styles.label}>Downloading {state.label}</Text>
        <View style={styles.track} accessibilityRole="progressbar">
          <View style={[styles.fill, { width: `${pct}%` }]} />
        </View>
        <Text style={styles.muted}>
          {formatBytes(bytesWritten)} / {formatBytes(totalBytes)} ({pct.toFixed(0)}%)
        </Text>
        <Pressable style={styles.secondaryButton} onPress={onCancel} accessibilityRole="button">
          <Text style={styles.secondaryButtonText}>Pause</Text>
        </Pressable>
      </View>
    );
  }

  if (state.status === 'PAUSED' || state.status === 'ERROR') {
    return (
      <View style={styles.center}>
        <Text style={styles.title}>
          {state.status === 'PAUSED' ? 'Download paused' : 'Setup failed'}
        </Text>
        <Text style={state.status === 'ERROR' ? styles.error : styles.muted}>
          {state.status === 'ERROR'
            ? state.message
            : 'The chatbot needs the AI models before it can answer questions.'}
        </Text>
        <Pressable style={styles.primaryButton} onPress={onRetry} accessibilityRole="button">
          <Text style={styles.primaryButtonText}>
            {state.status === 'PAUSED' ? 'Resume download' : 'Try again'}
          </Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.center}>
      <ActivityIndicator size="large" color={colors.primary} />
      <Text style={styles.muted}>
        {state.status === 'LOADING'
          ? state.message
          : `Building vector index… ${state.done}/${state.total}`}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 16 },
  title: { fontSize: 22, fontWeight: '700', color: colors.text, textAlign: 'center' },
  label: { fontSize: 15, fontWeight: '600', color: colors.text },
  muted: { fontSize: 14, color: colors.muted, textAlign: 'center' },
  error: { color: colors.danger, fontSize: 14, textAlign: 'center' },
  track: {
    width: '100%',
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.border,
    overflow: 'hidden',
  },
  fill: { height: '100%', backgroundColor: colors.primary },
  primaryButton: {
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 28,
    alignItems: 'center',
  },
  primaryButtonText: { color: colors.primaryText, fontSize: 16, fontWeight: '600' },
  secondaryButton: { paddingVertical: 10, paddingHorizontal: 20 },
  secondaryButtonText: { color: colors.primary, fontSize: 16 },
});

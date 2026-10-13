import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { REQUIRED_MODELS } from '../config/models';
import type { Strings } from '../i18n/strings';
import { formatBytes } from '../models/modelFiles';
import { colors } from './theme';
import type { AssistantState } from './useAssistant';

type Props = {
  state: Exclude<AssistantState, { status: 'READY' }>;
  t: Strings;
  onRetry: () => void;
  onCancel: () => void;
};

const TOTAL_DOWNLOAD_BYTES = REQUIRED_MODELS.reduce((sum, m) => sum + m.sizeBytes, 0);

/** Shown until the chatbot is ready: first-launch download progress, then model loading. */
export function SetupScreen({ state, t, onRetry, onCancel }: Props) {
  if (state.status === 'DOWNLOADING') {
    const { bytesWritten, totalBytes } = state.progress;
    const pct = totalBytes > 0 ? Math.min(100, (bytesWritten / totalBytes) * 100) : 0;
    return (
      <View style={styles.center}>
        <Text style={styles.title}>{t.setupTitle}</Text>
        <Text style={styles.muted}>{t.setupBody(formatBytes(TOTAL_DOWNLOAD_BYTES))}</Text>
        <Text style={styles.label}>{t.downloading(state.label)}</Text>
        <View style={styles.track} accessibilityRole="progressbar">
          <View style={[styles.fill, { width: `${pct}%` }]} />
        </View>
        <Text style={styles.muted}>
          {formatBytes(bytesWritten)} / {formatBytes(totalBytes)} ({pct.toFixed(0)}%)
        </Text>
        <Pressable style={styles.secondaryButton} onPress={onCancel} accessibilityRole="button">
          <Text style={styles.secondaryButtonText}>{t.pause}</Text>
        </Pressable>
      </View>
    );
  }

  if (state.status === 'PAUSED' || state.status === 'ERROR') {
    const paused = state.status === 'PAUSED';
    return (
      <View style={styles.center}>
        <Text style={styles.title}>{paused ? t.pausedTitle : t.failedTitle}</Text>
        <Text style={paused ? styles.muted : styles.error}>
          {state.status === 'ERROR' ? state.message : t.pausedBody}
        </Text>
        <Pressable style={styles.primaryButton} onPress={onRetry} accessibilityRole="button">
          <Text style={styles.primaryButtonText}>{paused ? t.resume : t.tryAgain}</Text>
        </Pressable>
      </View>
    );
  }

  const message = state.status === 'INDEXING' ? t.indexing(state.done, state.total) : t.loading;

  return (
    <View style={styles.center}>
      <ActivityIndicator size="large" color={colors.primary} />
      <Text style={styles.muted}>{message}</Text>
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

import { StatusBar } from 'expo-status-bar';
import { StyleSheet } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import { ChatScreen } from './src/ui/ChatScreen';
import { SetupScreen } from './src/ui/SetupScreen';
import { colors } from './src/ui/theme';
import { useAssistant } from './src/ui/useAssistant';

export default function App() {
  const { state, retry, cancelDownload, ask, listFaqs, stopGenerating } = useAssistant();

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.root}>
        <StatusBar style="dark" />
        {state.status === 'READY' ? (
          <ChatScreen state={state} ask={ask} listFaqs={listFaqs} onStop={stopGenerating} />
        ) : (
          <SetupScreen state={state} onRetry={() => void retry()} onCancel={cancelDownload} />
        )}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
});

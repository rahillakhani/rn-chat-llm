import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { StyleSheet } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import type { Lang } from './src/i18n/lang';
import { STRINGS, deviceLang } from './src/i18n/strings';
import { ChatScreen } from './src/ui/ChatScreen';
import { SetupScreen } from './src/ui/SetupScreen';
import { colors } from './src/ui/theme';
import { useAssistant } from './src/ui/useAssistant';

export default function App() {
  const {
    state,
    ai,
    retry,
    cancelDownload,
    downloadAi,
    cancelAiDownload,
    removeAi,
    ask,
    listFaqs,
    stopGenerating,
  } = useAssistant();
  // UI language starts from the phone's language and can be switched in the chat header.
  // Answers follow the language the question is written in.
  const [lang, setLang] = useState<Lang>(deviceLang);
  const t = STRINGS[lang];

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.root}>
        <StatusBar style="dark" />
        {state.status === 'READY' ? (
          <ChatScreen
            state={state}
            lang={lang}
            t={t}
            onChangeLang={setLang}
            ask={ask}
            listFaqs={listFaqs}
            onStop={stopGenerating}
            ai={ai}
            onDownloadAi={() => void downloadAi()}
            onCancelAiDownload={cancelAiDownload}
            onRemoveAi={() => void removeAi()}
          />
        ) : (
          <SetupScreen state={state} t={t} onRetry={() => void retry()} onCancel={cancelDownload} />
        )}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
});

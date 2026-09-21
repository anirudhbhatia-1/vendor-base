import { StatusBar } from 'expo-status-bar';
import { StyleSheet } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { HostedWorkspace } from '@neighbourhood-store/app-shell';
import { colors } from '@neighbourhood-store/ui-tokens/native';

/**
 * The partner Android app: the partner PWA, hosted.
 *
 * Every workflow is the web's; this shell adds what the device has -- the
 * back button, an offline state, external links, the location permission --
 * and points at the company-test deployment unless `EXPO_PUBLIC_WORKSPACE_URL`
 * says otherwise. The release it was built from is stamped on the page as
 * `window.__nativeShell`.
 */
export default function App() {
  return (
    <SafeAreaProvider>
      <SafeAreaView edges={['top', 'bottom']} style={styles.safe}>
        <StatusBar style="dark" />
        <HostedWorkspace
          env={process.env as Record<string, string | undefined>}
          needsLocation
          release={process.env['EXPO_PUBLIC_RELEASE_VERSION'] ?? 'development'}
          role="partner"
          scheme="neighbourhood-partner"
        />
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.canvas },
});

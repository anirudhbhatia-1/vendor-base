import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { WebView, type WebViewNavigation } from 'react-native-webview';
import * as Location from 'expo-location';
import { useNetworkState } from 'expo-network';
import { colors, radii, spacing } from '@neighbourhood-store/ui-tokens/native';
import {
  WORKSPACE_TITLES,
  deepLinkToPath,
  offlineSentence,
  resolveWorkspaceUrl,
  staysInWorkspace,
  type WorkspaceRole,
} from './workspace-config';

export interface HostedWorkspaceProps {
  readonly role: WorkspaceRole;
  /** The app's own URL scheme, for deep links into the workspace. */
  readonly scheme: string;
  /** Build-time environment (`process.env` in Expo). */
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** Ask for the foreground location permission on start (the partner's arrivals need it). */
  readonly needsLocation?: boolean;
  /** The release the shell was built from, so the workspace can say so. */
  readonly release?: string;
}

/**
 * The role's workspace, hosted.
 *
 * The web app does the work; the shell keeps the device states around it:
 * the hardware back button walks the workspace's history before it leaves
 * the app, a lost connection is said in the shell's own words (the workspace
 * has its own held-work states beneath), links that leave the workspace --
 * the map handoff, a call -- are handed to the device, a failed load offers a
 * retry rather than a blank page, and the location permission is asked for
 * up front where the workflow needs it, so the web's own geolocation prompt
 * can be answered.
 */
export function HostedWorkspace({
  role,
  scheme,
  env = {},
  needsLocation = false,
  release = 'development',
}: HostedWorkspaceProps) {
  const workspace = useMemo(() => resolveWorkspaceUrl(role, env), [role, env]);
  const webview = useRef<WebView>(null);
  const [canGoBack, setCanGoBack] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [initialPath, setInitialPath] = useState<string>('/');
  const [attempt, setAttempt] = useState(0);
  const network = useNetworkState();
  const offline = network.isInternetReachable === false || network.isConnected === false;

  // A deep link that opened the app names the page to start on.
  useEffect(() => {
    let cancelled = false;
    void Linking.getInitialURL().then((link) => {
      if (cancelled || !link) return;
      const path = deepLinkToPath(link, scheme);
      if (path) setInitialPath(path);
    });
    const subscription = Linking.addEventListener('url', ({ url }) => {
      const path = deepLinkToPath(url, scheme);
      if (path)
        webview.current?.injectJavaScript(`window.location.assign(${JSON.stringify(path)}); true;`);
    });
    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, [scheme]);

  useEffect(() => {
    if (!needsLocation) return;
    void Location.requestForegroundPermissionsAsync().catch(() => undefined);
  }, [needsLocation]);

  // The hardware back button walks the workspace's history first.
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const handler = BackHandler.addEventListener('hardwareBackPress', () => {
      if (canGoBack) {
        webview.current?.goBack();
        return true;
      }
      return false;
    });
    return () => handler.remove();
  }, [canGoBack]);

  const onNavigation = useCallback((state: WebViewNavigation) => {
    setCanGoBack(state.canGoBack);
  }, []);

  const uri = `${workspace}${initialPath}`;
  const marker = `window.__nativeShell = ${JSON.stringify({ role, release, platform: Platform.OS })}; true;`;

  return (
    <View style={styles.root}>
      {offline ? (
        <View accessibilityRole="alert" style={styles.offline}>
          <Text style={styles.offlineText}>{offlineSentence(role)}</Text>
        </View>
      ) : null}
      {failure ? (
        <View style={styles.failure}>
          <Text style={styles.failureTitle}>{WORKSPACE_TITLES[role]} could not be loaded</Text>
          <Text style={styles.failureCopy}>{failure}</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              setFailure(null);
              setAttempt((count) => count + 1);
            }}
            style={styles.retry}
          >
            <Text style={styles.retryText}>Try again</Text>
          </Pressable>
        </View>
      ) : (
        <WebView
          allowsBackForwardNavigationGestures
          geolocationEnabled
          injectedJavaScriptBeforeContentLoaded={marker}
          key={attempt}
          onError={(event) => setFailure(event.nativeEvent.description || 'The connection failed.')}
          onHttpError={(event) =>
            setFailure(`The workspace answered HTTP ${event.nativeEvent.statusCode}.`)
          }
          onNavigationStateChange={onNavigation}
          onShouldStartLoadWithRequest={(request) => {
            if (staysInWorkspace(request.url, workspace)) return true;
            void Linking.openURL(request.url).catch(() => undefined);
            return false;
          }}
          pullToRefreshEnabled
          ref={webview}
          renderLoading={() => (
            <View style={styles.loading}>
              <ActivityIndicator color={colors.evergreen} size="large" />
            </View>
          )}
          setSupportMultipleWindows={false}
          source={{ uri }}
          startInLoadingState
          style={styles.web}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.canvas },
  web: { flex: 1, backgroundColor: colors.canvas },
  loading: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.canvas,
  },
  offline: {
    backgroundColor: colors.warning,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  offlineText: { color: colors.surface, fontSize: 13, fontWeight: '600' },
  failure: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
    gap: spacing.sm,
  },
  failureTitle: { color: colors.textPrimary, fontSize: 18, fontWeight: '700', textAlign: 'center' },
  failureCopy: { color: colors.textSecondary, fontSize: 14, textAlign: 'center' },
  retry: {
    backgroundColor: colors.evergreen,
    borderRadius: radii.control,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  retryText: { color: colors.surface, fontWeight: '700' },
});

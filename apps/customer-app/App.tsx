import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors, spacing } from '@neighbourhood-store/ui-tokens/native';
import { Marketplace } from './Marketplace';
import { Orders } from './Orders';
import { CustomerSignInPanel } from './SignInPanel';
import type { SessionTokens } from '@neighbourhood-store/contracts';
import { loadPersistedSession, persistSession } from './token-storage';

export default function App() {
  const [screen, setScreen] = useState('Home');
  const [accessToken, setAccessTokenRaw] = useState('');

  // Try to restore a previously stored token so re-opening the app keeps the
  // user signed in when AsyncStorage is available.
  useEffect(() => {
    void loadPersistedSession().then((stored) => {
      if (stored) setAccessTokenRaw(stored.access_token);
    });
  }, []);

  const setAccessToken = (tokens: SessionTokens | null) => {
    setAccessTokenRaw(tokens?.access_token ?? '');
    void persistSession(tokens);
  };
  const screenCopy: Record<string, [string, string]> = {
    Home: [
      'What does your home need today?',
      'Prices, stock and fees are confirmed by the server.',
    ],
    Categories: [
      'Browse aisle by aisle.',
      'Fast categories, truthful availability and named stores.',
    ],
    Orders: ['Every store has its own promise.', 'Track order state without false countdowns.'],
    'My Stores': [
      'Shop where you already trust.',
      'Favourite, preferred and recently used stores live here.',
    ],
    Account: [
      'Your preferences stay yours.',
      'Manage sign-in, addresses, language and notifications.',
    ],
  };
  const [title, summary] = screenCopy[screen] ?? [
    'What does your home need today?',
    'Prices, stock and fees are confirmed by the server.',
  ];

  return (
    <View style={styles.safe}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={styles.shell}>
        <View accessibilityRole="header" style={styles.masthead}>
          <View style={styles.customerMark}>
            <Text style={styles.darkMarkText}>न</Text>
          </View>
          <View>
            <Text style={styles.product}>Neighbourhood</Text>
            <Text style={styles.eyebrow}>JAIPUR MARKET · COMPANY TEST</Text>
          </View>
        </View>
        <View style={styles.locationStrip}>
          <View style={styles.locationDot} />
          <View>
            <Text style={styles.locationLabel}>Delivering around Mansarovar</Text>
            <Text style={styles.locationMeta}>Honest windows from named local stores</Text>
          </View>
        </View>
        <View style={styles.hero}>
          <Text style={styles.heroKicker}>NAMASTE, JAIPUR</Text>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.summary}>{summary}</Text>
        </View>
        <View style={styles.tabs}>
          {['Home', 'Categories', 'Orders', 'My Stores', 'Account'].map((tab) => (
            <Pressable
              accessibilityRole="tab"
              accessibilityState={{ selected: screen === tab }}
              key={tab}
              onPress={() => setScreen(tab)}
              style={[styles.tab, screen === tab && styles.activeTab]}
            >
              <Text style={[styles.tabText, screen === tab && styles.activeTabText]}>{tab}</Text>
            </Pressable>
          ))}
        </View>
        <CustomerSignInPanel onSignIn={setAccessToken} />
        {screen === 'Home' && <Marketplace accessToken={accessToken} />}
        {screen === 'Categories' && <Marketplace accessToken={accessToken} />}
        {screen === 'Orders' && <Orders accessToken={accessToken} />}
        {screen === 'My Stores' && (
          <View style={styles.screenPanel}>
            <Text style={styles.panelKicker}>PREFERRED STORE</Text>
            <Text style={styles.panelTitle}>
              {accessToken ? 'Signed in' : 'Sign in to see your stores'}
            </Text>
            <Text style={styles.panelCopy}>
              Preferred and favourite stores appear here after a first successful discovery search.
            </Text>
          </View>
        )}
        {screen === 'Account' && (
          <View style={styles.screenPanel}>
            <Text style={styles.panelKicker}>COMPANY-TEST ACCOUNT</Text>
            <Text style={styles.panelTitle}>
              {accessToken ? 'Session active' : 'Sign in above'}
            </Text>
            <Text style={styles.panelCopy}>
              Sign in with OTP (SYNTH-PHONE-*) or a password provisioned by an admin.
            </Text>
          </View>
        )}
        <Text style={styles.boundary}>
          Company-local synthetic data only · no real OTP, payment or customer data
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.canvas },
  shell: { flexGrow: 1, padding: spacing.md, paddingTop: spacing.xl, paddingBottom: spacing.xxl },
  masthead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingBottom: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  customerMark: {
    width: 46,
    height: 46,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 13,
    backgroundColor: colors.customerMango,
    borderWidth: 2,
    borderColor: colors.textPrimary,
  },
  darkMarkText: { color: colors.textPrimary, fontWeight: '800' },
  eyebrow: { color: colors.textSecondary, fontSize: 10, fontWeight: '700', letterSpacing: 0.6 },
  product: { marginTop: 3, color: colors.textPrimary, fontSize: 18, fontWeight: '800' },
  locationStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: spacing.md,
    paddingHorizontal: 4,
  },
  locationDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: colors.success },
  locationLabel: { color: colors.textPrimary, fontSize: 12, fontWeight: '800' },
  locationMeta: { marginTop: 2, color: colors.textSecondary, fontSize: 10 },
  hero: {
    marginTop: spacing.lg,
    padding: spacing.lg,
    borderRadius: 26,
    backgroundColor: colors.customerMango,
  },
  heroKicker: { color: colors.textPrimary, fontSize: 10, fontWeight: '900', letterSpacing: 0.8 },
  title: {
    marginTop: spacing.sm,
    color: colors.textPrimary,
    fontSize: 38,
    lineHeight: 40,
    fontWeight: '900',
    letterSpacing: -1.2,
  },
  summary: { marginTop: spacing.sm, color: colors.textPrimary, fontSize: 14, lineHeight: 21 },
  tabs: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.md,
    padding: 6,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    backgroundColor: colors.surface,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: 3,
    paddingVertical: 8,
    borderRadius: 10,
  },
  activeTab: { backgroundColor: colors.customerMango },
  tabText: { color: colors.textSecondary, fontSize: 10, fontWeight: '700' },
  activeTabText: { color: colors.textPrimary },
  screenPanel: {
    marginTop: spacing.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 20,
    backgroundColor: colors.surface,
  },
  panelKicker: { color: colors.evergreen, fontSize: 10, fontWeight: '900', letterSpacing: 0.8 },
  panelTitle: { marginTop: 10, color: colors.textPrimary, fontSize: 26, fontWeight: '900' },
  panelCopy: { marginTop: 8, color: colors.textSecondary, fontSize: 14, lineHeight: 21 },
  panelAction: { marginTop: spacing.lg, color: colors.evergreen, fontWeight: '800' },
  boundary: {
    marginTop: spacing.xl,
    color: colors.textSecondary,
    fontSize: 11,
    textAlign: 'center',
  },
});

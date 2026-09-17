import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors, spacing } from '@neighbourhood-store/ui-tokens/native';
import { PartnerJob } from './PartnerJob';
import { PartnerSignInPanel } from './SignInPanel';
import { loadPersistedToken, persistToken } from './token-storage';

export default function App() {
  const [screen, setScreen] = useState('Home');
  const [accessToken, setAccessTokenRaw] = useState('');

  useEffect(() => {
    void loadPersistedToken().then((t) => {
      if (t) setAccessTokenRaw(t);
    });
  }, []);
  const setAccessToken = (t: string) => {
    setAccessTokenRaw(t);
    void persistToken(t);
  };
  return (
    <View style={styles.safe}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={styles.shell}>
        <View accessibilityRole="header" style={styles.masthead}>
          <View style={styles.partnerMark}>
            <Text style={styles.lightMarkText}>DP</Text>
          </View>
          <View>
            <Text style={styles.product}>Delivery partner</Text>
            <Text style={styles.eyebrow}>JAIPUR · COMPANY TEST</Text>
          </View>
          <View style={styles.offlineChip}>
            <Text style={styles.offlineText}>OFFLINE</Text>
          </View>
        </View>
        <View style={styles.hero}>
          <Text style={styles.heroKicker}>
            {screen === 'Home' ? 'YOUR NEXT SAFE STEP' : screen.toUpperCase()}
          </Text>
          <Text style={styles.title}>
            {screen === 'Home'
              ? 'One active job. Every handoff recorded.'
              : screen === 'Earnings'
                ? 'Know what every trip paid.'
                : 'Your work. Your safety. Your record.'}
          </Text>
          <Text style={styles.summary}>
            The server keeps custody, proof, wait time and earnings together.
          </Text>
        </View>
        <View style={styles.tabs}>
          {['Home', 'Earnings', 'Profile'].map((tab) => (
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
        <PartnerSignInPanel onSignIn={setAccessToken} />
        {screen === 'Home' && <PartnerJob accessToken={accessToken} />}
        {screen === 'Earnings' && (
          <View style={styles.screenPanel}>
            <Text style={styles.panelKicker}>EARNINGS</Text>
            <Text style={styles.panelTitle}>Live statement</Text>
            <Text style={styles.panelCopy}>
              Open the partner PWA for the live finance statement. A mobile parity pass will surface
              the same data here.
            </Text>
          </View>
        )}
        {screen === 'Profile' && (
          <View style={styles.screenPanel}>
            <Text style={styles.panelKicker}>ID VERIFIED</Text>
            <Text style={styles.panelTitle}>Cycle · Jaipur South</Text>
            <Text style={styles.panelCopy}>Documents current · training 4 of 4 complete</Text>
            <View style={styles.helpCard}>
              <Text style={styles.helpTitle}>Need help?</Text>
              <Text style={styles.panelCopy}>
                Support and emergency options remain available during every job.
              </Text>
            </View>
          </View>
        )}
        <Text style={styles.boundary}>
          Synthetic jobs and payouts only · no real routes or people
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
  partnerMark: {
    width: 46,
    height: 46,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 13,
    backgroundColor: colors.evergreen,
  },
  lightMarkText: { color: '#fff', fontWeight: '800' },
  eyebrow: { color: colors.textSecondary, fontSize: 9, fontWeight: '700', letterSpacing: 0.6 },
  product: { marginTop: 3, color: colors.textPrimary, fontSize: 18, fontWeight: '800' },
  offlineChip: {
    marginLeft: 'auto',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: '#FFF1D7',
  },
  offlineText: { color: colors.warning, fontSize: 10, fontWeight: '900' },
  hero: {
    marginTop: spacing.lg,
    padding: spacing.lg,
    borderRadius: 24,
    backgroundColor: colors.evergreenTint,
  },
  heroKicker: { color: colors.evergreen, fontSize: 10, fontWeight: '900', letterSpacing: 0.8 },
  title: {
    marginTop: spacing.sm,
    color: colors.textPrimary,
    fontSize: 34,
    lineHeight: 38,
    fontWeight: '900',
    letterSpacing: -1,
  },
  summary: { marginTop: spacing.sm, color: colors.textSecondary, fontSize: 15, lineHeight: 22 },
  tabs: {
    flexDirection: 'row',
    gap: 6,
    marginTop: spacing.md,
    padding: 6,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    backgroundColor: colors.surface,
  },
  tab: { flex: 1, paddingVertical: 9, alignItems: 'center', borderRadius: 10 },
  activeTab: { backgroundColor: colors.evergreen },
  tabText: { color: colors.textSecondary, fontSize: 11, fontWeight: '700' },
  activeTabText: { color: '#fff' },
  screenPanel: {
    marginTop: spacing.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 20,
    backgroundColor: colors.surface,
  },
  panelKicker: { color: colors.evergreen, fontSize: 10, fontWeight: '900', letterSpacing: 0.8 },
  panelTitle: { marginTop: 10, color: colors.textPrimary, fontSize: 28, fontWeight: '900' },
  panelCopy: { marginTop: 7, color: colors.textSecondary, fontSize: 14, lineHeight: 21 },
  ledgerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  ledgerValue: { color: colors.textPrimary, fontWeight: '900' },
  helpCard: {
    marginTop: spacing.lg,
    padding: spacing.md,
    backgroundColor: colors.evergreenTint,
    borderRadius: 14,
  },
  helpTitle: { color: colors.textPrimary, fontSize: 18, fontWeight: '900' },
  boundary: {
    marginTop: spacing.xl,
    color: colors.textSecondary,
    fontSize: 11,
    textAlign: 'center',
  },
});

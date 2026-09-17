import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors, spacing } from '@neighbourhood-store/ui-tokens/native';
import { ControlPlane } from './ControlPlane';
import { AdminSignInPanel } from './SignInPanel';
import { loadPersistedToken, persistToken } from './token-storage';

export default function App() {
  const [screen, setScreen] = useState('Overview');
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
  const screenCopy: Record<string, [string, string]> = {
    Overview: [
      'Act on server truth.',
      'Safety, money and live-order exceptions stay ahead of routine work.',
    ],
    Vendors: [
      'Move trustworthy stores toward live.',
      'Review readiness and publication as separate decisions.',
    ],
    Partners: [
      'Verify people before dispatch.',
      'Identity, vehicle, bank and training checks stay accountable.',
    ],
    Orders: [
      'Keep every order moving honestly.',
      'Exceptions rank by customer, custody and money impact.',
    ],
    Catalogue: [
      'Moderate what customers can buy.',
      'Policy and evidence remain visible beside every decision.',
    ],
    'Zones & fees': [
      'Change rules with control.',
      'Versioned proposals require validation and approval.',
    ],
    Support: [
      'Resolve the issue. Preserve the trail.',
      'Cases keep evidence, ownership and outcomes together.',
    ],
    Audit: ['Who changed what, and why.', 'Immutable evidence closes every intervention.'],
  };
  const [title, summary] = screenCopy[screen] ?? [
    'Act on server truth.',
    'Safety, money and live-order exceptions stay ahead of routine work.',
  ];
  return (
    <View style={styles.safe}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={styles.shell}>
        <View accessibilityRole="header" style={styles.masthead}>
          <View style={styles.adminMark}>
            <Text style={styles.lightMarkText}>AO</Text>
          </View>
          <View>
            <Text style={styles.product}>Control room</Text>
            <Text style={styles.eyebrow}>ADMIN · COMPANY TEST</Text>
          </View>
        </View>
        <View style={styles.riskBanner}>
          <Text style={styles.heroKicker}>RISK-RANKED OPERATIONS</Text>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.summary}>{summary}</Text>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.navScroll}>
          <View style={styles.navRow}>
            {[
              'Overview',
              'Vendors',
              'Partners',
              'Orders',
              'Catalogue',
              'Zones & fees',
              'Support',
              'Audit',
            ].map((tab) => (
              <Pressable
                accessibilityRole="tab"
                accessibilityState={{ selected: screen === tab }}
                key={tab}
                onPress={() => setScreen(tab)}
                style={[styles.navItem, screen === tab && styles.navItemActive]}
              >
                <Text style={[styles.navText, screen === tab && styles.navTextActive]}>{tab}</Text>
              </Pressable>
            ))}
          </View>
        </ScrollView>
        <AdminSignInPanel onSignIn={setAccessToken} />
        {screen === 'Overview' && <ControlPlane accessToken={accessToken} />}
        {screen !== 'Overview' && (
          <View style={styles.modulePanel}>
            <Text style={styles.moduleKicker}>{screen.toUpperCase()}</Text>
            <Text style={styles.moduleTitle}>
              {accessToken ? 'Available in the admin PWA' : 'Sign in above'}
            </Text>
            <Text style={styles.moduleCopy}>
              The Android admin surface exposes only the Overview control plane. Deep drill-ins
              (onboarding, vendors, partners, orders, finance) live in the admin PWA and use the
              same session tokens.
            </Text>
          </View>
        )}
        <Text style={styles.boundary}>
          Synthetic company environment · production intervention authority remains disabled
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F4F6F4' },
  shell: { flexGrow: 1, padding: spacing.md, paddingTop: spacing.xl, paddingBottom: spacing.xxl },
  masthead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingBottom: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  adminMark: {
    width: 46,
    height: 46,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    backgroundColor: colors.textPrimary,
  },
  lightMarkText: { color: '#fff', fontWeight: '800' },
  eyebrow: { color: colors.textSecondary, fontSize: 9, fontWeight: '700', letterSpacing: 0.6 },
  product: { marginTop: 3, color: colors.textPrimary, fontSize: 18, fontWeight: '800' },
  riskBanner: {
    marginTop: spacing.lg,
    padding: spacing.lg,
    borderRadius: 22,
    borderLeftWidth: 6,
    borderLeftColor: '#B94F38',
    backgroundColor: '#FFF1EC',
  },
  heroKicker: { color: '#98412D', fontSize: 10, fontWeight: '900', letterSpacing: 0.8 },
  title: {
    marginTop: spacing.sm,
    color: colors.textPrimary,
    fontSize: 34,
    lineHeight: 38,
    fontWeight: '900',
    letterSpacing: -1,
  },
  summary: { marginTop: spacing.sm, color: colors.textSecondary, fontSize: 15, lineHeight: 22 },
  navScroll: { marginTop: spacing.md },
  navRow: { flexDirection: 'row', gap: 6 },
  navItem: { paddingHorizontal: 13, paddingVertical: 9, borderRadius: 8 },
  navItemActive: { backgroundColor: colors.textPrimary },
  navText: { color: colors.textSecondary, fontSize: 11, fontWeight: '700' },
  navTextActive: { color: '#fff' },
  modulePanel: {
    marginTop: spacing.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 18,
    backgroundColor: '#fff',
  },
  moduleKicker: { color: '#98412D', fontSize: 10, fontWeight: '900', letterSpacing: 0.8 },
  moduleTitle: { marginTop: 10, color: colors.textPrimary, fontSize: 28, fontWeight: '900' },
  moduleCopy: { marginTop: 8, color: colors.textSecondary, fontSize: 14, lineHeight: 21 },
  moduleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  moduleRowLabel: { color: colors.textSecondary, fontSize: 12 },
  moduleRowValue: { color: colors.textPrimary, fontSize: 12, fontWeight: '800' },
  boundary: {
    marginTop: spacing.xl,
    color: colors.textSecondary,
    fontSize: 11,
    textAlign: 'center',
  },
});

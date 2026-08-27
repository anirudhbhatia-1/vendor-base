import { StatusBar } from 'expo-status-bar';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors, spacing } from '@neighbourhood-store/ui-tokens/native';
import { PartnerJob } from './PartnerJob';

export default function App() {
  return (
    <View style={styles.safe}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={styles.shell}>
        <View accessibilityRole="header" style={styles.masthead}>
          <View style={styles.partnerMark}>
            <Text style={styles.lightMarkText}>DP</Text>
          </View>
          <View>
            <Text style={styles.eyebrow}>DELIVERY PARTNER ANDROID · COMPANY TEST</Text>
            <Text style={styles.product}>Custody desk</Text>
          </View>
        </View>
        <Text style={styles.title}>One active job. Every handoff recorded.</Text>
        <Text style={styles.summary}>
          Assignment state, package custody, exceptions, delivery proof and earnings come from the
          local server and resume after an app restart.
        </Text>
        <PartnerJob />
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
    borderRadius: 23,
    backgroundColor: colors.evergreen,
  },
  lightMarkText: { color: '#fff', fontWeight: '800' },
  eyebrow: { color: colors.textSecondary, fontSize: 9, fontWeight: '700', letterSpacing: 0.6 },
  product: { marginTop: 3, color: colors.textPrimary, fontSize: 18, fontWeight: '800' },
  title: {
    marginTop: spacing.xl,
    color: colors.textPrimary,
    fontSize: 34,
    lineHeight: 38,
    fontWeight: '800',
  },
  summary: { marginTop: spacing.sm, color: colors.textSecondary, fontSize: 15, lineHeight: 22 },
  boundary: {
    marginTop: spacing.xl,
    color: colors.textSecondary,
    fontSize: 11,
    textAlign: 'center',
  },
});

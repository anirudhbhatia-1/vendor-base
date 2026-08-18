import { StatusBar } from 'expo-status-bar';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors, radii, spacing } from '@neighbourhood-store/ui-tokens/native';

const checkpoints = [
  ['Shell', 'Running locally'],
  ['Assignment feed', 'Not connected'],
  ['Real delivery', 'Disabled'],
] as const;

export default function App() {
  return (
    <View style={styles.safe}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={styles.shell}>
        <View accessibilityRole="header" style={styles.masthead}>
          <View style={styles.roleMark}>
            <Text style={styles.roleMarkText}>DP</Text>
          </View>
          <View>
            <Text style={styles.eyebrow}>Delivery Partner Android app · Internal build</Text>
            <Text style={styles.productName}>Route desk</Text>
          </View>
        </View>

        <View style={styles.intro}>
          <Text style={styles.localNote}>Company test workspace · Synthetic routes only</Text>
          <Text accessibilityRole="header" style={styles.title}>
            One clear job. Every handoff accounted for.
          </Text>
          <Text style={styles.summary}>
            This is the partner Android foundation. Availability, offers, navigation, proof and
            earnings are intentionally not active yet.
          </Text>
        </View>

        <View accessibilityLabel="Build readiness" style={styles.marketLane}>
          {checkpoints.map(([label, value], index) => (
            <View key={label} style={[styles.checkpoint, index > 0 && styles.checkpointBorder]}>
              <View style={styles.stop}>
                <Text style={styles.stopText}>{index + 1}</Text>
              </View>
              <View style={styles.checkpointCopy}>
                <Text style={styles.checkpointLabel}>{label}</Text>
                <Text style={styles.checkpointValue}>{value}</Text>
              </View>
            </View>
          ))}
        </View>

        <Text style={styles.boundary}>
          No real partners, locations, routes, proofs or payouts are used.
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.canvas },
  shell: {
    flexGrow: 1,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.xl,
    paddingBottom: spacing.xxl,
  },
  masthead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingBottom: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  roleMark: {
    width: 46,
    height: 46,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    backgroundColor: colors.evergreen,
  },
  roleMarkText: { color: colors.surface, fontSize: 14, fontWeight: '700' },
  eyebrow: { color: colors.textSecondary, fontSize: 12, fontWeight: '600' },
  productName: { marginTop: 2, color: colors.textPrimary, fontSize: 16, fontWeight: '700' },
  intro: { paddingTop: 52, paddingBottom: 36 },
  localNote: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 7,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '600',
  },
  title: {
    marginTop: spacing.lg,
    color: colors.textPrimary,
    fontSize: 42,
    fontWeight: '700',
    letterSpacing: -1.2,
    lineHeight: 44,
  },
  summary: { marginTop: spacing.md, color: colors.textSecondary, fontSize: 16, lineHeight: 25 },
  marketLane: {
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.panel,
    backgroundColor: colors.surface,
  },
  checkpoint: {
    minHeight: 88,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  checkpointBorder: { borderTopWidth: 1, borderTopColor: colors.border },
  stop: {
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 21,
    backgroundColor: colors.evergreen,
  },
  stopText: { color: colors.surface, fontSize: 12, fontWeight: '700' },
  checkpointCopy: { flex: 1 },
  checkpointLabel: { color: colors.textSecondary, fontSize: 13 },
  checkpointValue: { marginTop: 4, color: colors.textPrimary, fontSize: 17, fontWeight: '700' },
  boundary: {
    marginTop: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 14,
    overflow: 'hidden',
    borderRadius: radii.control,
    backgroundColor: colors.evergreenTint,
    color: colors.textPrimary,
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 20,
  },
});

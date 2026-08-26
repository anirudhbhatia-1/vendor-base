import { useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors, radii, spacing } from '@neighbourhood-store/ui-tokens/native';

const stops = [
  { action: 'Confirm arrival', label: 'Vendor arrival', state: 'ASSIGNED' },
  { action: 'Verify 2 packages', label: 'Pickup check', state: 'AT_VENDOR' },
  { action: 'Begin route', label: 'In your custody', state: 'PICKED_UP' },
  { action: 'Confirm arrival', label: 'Customer area', state: 'EN_ROUTE' },
  { action: 'Record delivery', label: 'Handoff', state: 'ARRIVED' },
] as const;

export default function App() {
  const [step, setStep] = useState(2);
  const delivered = step === stops.length;
  const current = stops[step];

  return (
    <View style={styles.safe}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={styles.shell}>
        <View accessibilityRole="header" style={styles.masthead}>
          <View style={styles.roleMark}>
            <Text style={styles.roleMarkText}>DP</Text>
          </View>
          <View style={styles.headerCopy}>
            <Text style={styles.eyebrow}>DELIVERY PARTNER · INTERNAL BUILD</Text>
            <Text style={styles.productName}>Custody desk</Text>
          </View>
          <Text style={styles.localBadge}>LOCAL · SYNTH</Text>
        </View>

        <View style={styles.intro}>
          <Text style={styles.assignmentRef}>SYNTH-JOB-302020-055</Text>
          <Text accessibilityRole="header" style={styles.title}>
            Two packages. One accountable handoff.
          </Text>
          <Text style={styles.summary}>
            Approximate areas only. No real customer, route, proof or payout data.
          </Text>
        </View>

        <View
          accessibilityLabel={delivered ? 'Custody closed' : 'Two packages in your custody'}
          style={[styles.custodySeal, delivered && styles.custodySealClosed]}
        >
          <Text style={styles.sealCount}>02</Text>
          <View style={styles.sealCopy}>
            <Text style={styles.sealTitle}>{delivered ? 'Custody closed' : 'In your custody'}</Text>
            <Text style={styles.sealMeta}>COUNT VERIFIED</Text>
          </View>
        </View>

        <View style={styles.routeCard}>
          <View style={styles.routePlace}>
            <Text style={styles.routeLabel}>PICK UP NEAR</Text>
            <Text style={styles.routeValue}>SYNTH Mansarovar sector</Text>
          </View>
          <Text style={styles.routeArrow}>↓</Text>
          <View style={styles.routePlace}>
            <Text style={styles.routeLabel}>DROP NEAR</Text>
            <Text style={styles.routeValue}>SYNTH Ajmer Road sector</Text>
          </View>
        </View>

        <View accessibilityLabel="Custody progress" style={styles.lane}>
          {stops.map((stop, index) => {
            const done = delivered || index < step;
            const active = index === step;
            return (
              <View
                key={stop.state}
                style={[styles.stopRow, index < stops.length - 1 && styles.stopRail]}
              >
                <View style={[styles.node, (done || active) && styles.nodeActive]}>
                  <Text style={[styles.nodeText, (done || active) && styles.nodeTextActive]}>
                    {done ? '✓' : index + 1}
                  </Text>
                </View>
                <View style={styles.stopCopy}>
                  <Text style={styles.stopState}>{stop.state}</Text>
                  <Text style={[styles.stopLabel, !done && !active && styles.stopMuted]}>
                    {stop.label}
                  </Text>
                </View>
              </View>
            );
          })}
        </View>

        <View style={styles.actionDock}>
          <Text style={styles.dockLabel}>CURRENT STATE</Text>
          <Text style={styles.dockState}>{delivered ? 'DELIVERED' : current?.state}</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => setStep(delivered ? 0 : step + 1)}
            style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
          >
            <Text style={styles.buttonText}>
              {delivered ? 'Reset synthetic job' : current?.action}
            </Text>
          </Pressable>
        </View>

        <View style={styles.failureNote}>
          <Text style={styles.failureTitle}>Delivery cannot be completed?</Text>
          <Text style={styles.failureBody}>
            Record failure first. Operations must authorize a synthetic return destination.
          </Text>
        </View>
        <View style={styles.moneyStrip} accessibilityLabel="Synthetic trip earnings">
          <Text style={styles.moneyLabel}>TRIP EARNING · FAKE PAYOUT</Text>
          <Text style={styles.moneyValue}>₹49.00</Text>
          <Text style={styles.moneyBody}>
            Outbound ₹39 · wait ₹0 · tip ₹10 · eligible after 24 hours
          </Text>
        </View>
        <Text style={styles.boundary}>Interactive local fixture · No API command is sent</Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  moneyStrip: {
    marginTop: spacing.md,
    padding: spacing.md,
    borderTopWidth: 5,
    borderTopColor: colors.evergreen,
    backgroundColor: colors.surface,
  },
  moneyLabel: { color: colors.textSecondary, fontSize: 10, fontWeight: '700', letterSpacing: 0.6 },
  moneyValue: { marginTop: spacing.xs, color: colors.textPrimary, fontSize: 28, fontWeight: '800' },
  moneyBody: { marginTop: spacing.xs, color: colors.textSecondary, fontSize: 12, lineHeight: 18 },
  safe: { flex: 1, backgroundColor: colors.canvas },
  shell: {
    flexGrow: 1,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  masthead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  roleMark: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 22,
    backgroundColor: colors.evergreen,
  },
  roleMarkText: { color: colors.surface, fontSize: 12, fontWeight: '800' },
  headerCopy: { flex: 1 },
  eyebrow: { color: colors.textSecondary, fontSize: 9, fontWeight: '700', letterSpacing: 0.7 },
  productName: { marginTop: 2, color: colors.textPrimary, fontSize: 16, fontWeight: '700' },
  localBadge: {
    paddingHorizontal: 8,
    paddingVertical: 6,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.evergreen,
    borderRadius: radii.pill,
    color: colors.evergreen,
    fontSize: 9,
    fontWeight: '700',
  },
  intro: { paddingTop: spacing.xl, paddingBottom: spacing.lg },
  assignmentRef: { color: colors.evergreen, fontSize: 11, fontWeight: '700', letterSpacing: 0.6 },
  title: {
    marginTop: spacing.sm,
    color: colors.textPrimary,
    fontSize: 40,
    fontWeight: '800',
    letterSpacing: -1.5,
    lineHeight: 41,
  },
  summary: { marginTop: spacing.md, color: colors.textSecondary, fontSize: 15, lineHeight: 23 },
  custodySeal: {
    minHeight: 118,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.panel,
    backgroundColor: colors.evergreen,
  },
  custodySealClosed: { backgroundColor: colors.textPrimary },
  sealCount: { color: colors.surface, fontSize: 58, fontWeight: '800', letterSpacing: -3 },
  sealCopy: { flex: 1, paddingLeft: spacing.md, borderLeftWidth: 1, borderLeftColor: '#FFFFFF66' },
  sealTitle: { color: colors.surface, fontSize: 17, fontWeight: '700' },
  sealMeta: {
    marginTop: spacing.xs,
    color: '#FFFFFFB8',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.7,
  },
  routeCard: {
    marginTop: spacing.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.panel,
    backgroundColor: colors.surface,
  },
  routePlace: { paddingVertical: spacing.xs },
  routeLabel: { color: colors.textSecondary, fontSize: 10, fontWeight: '700', letterSpacing: 0.5 },
  routeValue: { marginTop: 4, color: colors.textPrimary, fontSize: 16, fontWeight: '700' },
  routeArrow: { marginLeft: spacing.xs, color: colors.evergreen, fontSize: 22 },
  lane: {
    marginTop: spacing.md,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.panel,
    backgroundColor: colors.surface,
  },
  stopRow: { position: 'relative', minHeight: 66, flexDirection: 'row', gap: spacing.md },
  stopRail: { borderLeftWidth: 2, borderLeftColor: colors.border, marginLeft: 16, paddingLeft: 14 },
  node: {
    zIndex: 1,
    width: 34,
    height: 34,
    marginLeft: -17,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: 17,
    backgroundColor: colors.surface,
  },
  nodeActive: { borderColor: colors.evergreen, backgroundColor: colors.evergreen },
  nodeText: { color: colors.textSecondary, fontSize: 11, fontWeight: '800' },
  nodeTextActive: { color: colors.surface },
  stopCopy: { flex: 1 },
  stopState: { color: colors.textSecondary, fontSize: 9, fontWeight: '600' },
  stopLabel: { marginTop: 4, color: colors.textPrimary, fontSize: 15, fontWeight: '700' },
  stopMuted: { opacity: 0.45 },
  actionDock: {
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radii.panel,
    backgroundColor: colors.surfaceSubtle,
  },
  dockLabel: { color: colors.textSecondary, fontSize: 10, fontWeight: '700', letterSpacing: 0.5 },
  dockState: { marginTop: 4, color: colors.textPrimary, fontSize: 13, fontWeight: '700' },
  button: {
    minHeight: 48,
    marginTop: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.control,
    backgroundColor: colors.evergreen,
  },
  buttonPressed: { backgroundColor: colors.evergreenPressed },
  buttonText: { color: colors.surface, fontSize: 15, fontWeight: '700' },
  failureNote: {
    marginTop: spacing.md,
    padding: spacing.md,
    borderLeftWidth: 4,
    borderLeftColor: colors.warning,
    backgroundColor: '#FFF8E6',
  },
  failureTitle: { color: colors.textPrimary, fontSize: 13, fontWeight: '700' },
  failureBody: { marginTop: 4, color: colors.textSecondary, fontSize: 13, lineHeight: 19 },
  boundary: {
    marginTop: spacing.md,
    color: colors.textSecondary,
    fontSize: 10,
    textAlign: 'center',
  },
});

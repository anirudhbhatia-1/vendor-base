import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { colors, spacing } from '@neighbourhood-store/ui-tokens/native';

const checkLabels = [
  'Onboarding',
  'Profile',
  'Hours',
  'Service zone',
  'Fulfilment',
  'Documents',
] as const;
const cases = [
  {
    id: 'PUB-SYN-302020-A1',
    name: 'SYNTH Jain Stores Test',
    pin: '302020',
    checks: [true, true, true, true, true, true],
  },
  {
    id: 'PUB-SYN-302021-B4',
    name: 'SYNTH Shree Ram Produce',
    pin: '302021',
    checks: [true, true, true, false, true, false],
  },
] as const;
type ModerationCase = { readonly decision_state: string; readonly product_reference: string };
const apiUrl = 'http://10.0.2.2:3001';

export default function App() {
  const [selected, setSelected] = useState(0);
  const [state, setState] = useState('Pending approval');
  const [note, setNote] = useState('Synthetic evidence and launch checks reviewed.');
  const [moderatorToken, setModeratorToken] = useState('');
  const [moderationCases, setModerationCases] = useState<readonly ModerationCase[]>([]);
  const [moderationMessage, setModerationMessage] = useState(
    'Enter a local moderator token to load the queue.',
  );
  async function loadModeration() {
    try {
      const response = await fetch(`${apiUrl}/admin/catalogue/moderation`, {
        headers: { authorization: `Bearer ${moderatorToken}` },
      });
      if (!response.ok) throw new Error('Local session cannot read this queue.');
      const body = (await response.json()) as
        { readonly data?: readonly ModerationCase[] } | readonly ModerationCase[];
      const next: readonly ModerationCase[] = Array.isArray(body)
        ? (body as readonly ModerationCase[])
        : ((body as { readonly data?: readonly ModerationCase[] }).data ?? []);
      setModerationCases(next);
      setModerationMessage(
        next.length ? 'Server moderation queue loaded.' : 'No catalogue cases need review.',
      );
    } catch (error) {
      setModerationMessage(error instanceof Error ? error.message : 'Queue could not be loaded.');
    }
  }
  const item = cases[selected] ?? cases[0];
  return (
    <View style={styles.safe}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={styles.shell}>
        <View style={styles.topbar}>
          <View style={styles.mark}>
            <Text style={styles.markText}>AO</Text>
          </View>
          <View style={styles.headerCopy}>
            <Text style={styles.eyebrow}>ADMIN ANDROID · INTERNAL BUILD</Text>
            <Text style={styles.product}>Marketplace control room</Text>
          </View>
          <View style={styles.liveDot} />
        </View>
        <View style={styles.hero}>
          <Text style={styles.eyebrow}>VENDOR PUBLICATION</Text>
          <Text accessibilityRole="header" style={styles.title}>
            Clear the launch line.
          </Text>
          <Text style={styles.summary}>
            Readiness, independent approval and storefront control in one synthetic queue.
          </Text>
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.queue}
          accessibilityLabel="Publication cases"
        >
          {cases.map((entry, index) => (
            <Pressable
              accessibilityRole="button"
              key={entry.id}
              onPress={() => {
                setSelected(index);
                setState('Pending approval');
              }}
              style={[styles.queueCard, selected === index && styles.queueSelected]}
            >
              <Text style={styles.caseName}>{entry.name}</Text>
              <Text style={styles.caseRef}>{entry.id}</Text>
              <Text style={styles.casePin}>Jaipur {entry.pin}</Text>
            </Pressable>
          ))}
        </ScrollView>

        <View style={styles.workbench}>
          <View style={styles.caseHeader}>
            <View style={styles.caseHeaderCopy}>
              <Text style={styles.eyebrow}>{item.id}</Text>
              <Text style={styles.sectionTitle}>{item.name}</Text>
            </View>
            <Text style={styles.stateBadge}>{state}</Text>
          </View>
          <View style={styles.launchStrip}>
            {checkLabels.map((label, index) => (
              <View
                key={label}
                style={[styles.check, item.checks[index] ? styles.checkReady : styles.checkBlocked]}
              >
                <Text style={[styles.checkMark, item.checks[index] && styles.readyText]}>
                  {item.checks[index] ? '✓' : '!'}
                </Text>
                <Text
                  numberOfLines={1}
                  style={[styles.checkLabel, item.checks[index] && styles.readyText]}
                >
                  {label}
                </Text>
              </View>
            ))}
          </View>

          <Text style={styles.eyebrow}>REVIEW EVIDENCE</Text>
          <Text style={styles.subheading}>Launch record</Text>
          <Evidence label="Business profile" value="SYNTH-BIZ-JPR-0001" />
          <Evidence label="Payout profile" value="SYNTH-PAYOUT-JPR-0001" />
          <Evidence label="Operating hours" value="Mon–Sat · 08:00–20:00" />
          <Text style={styles.privacy}>
            Protected files require a short-lived server grant. File paths and payout details are
            never shown.
          </Text>

          <Text style={[styles.eyebrow, styles.decisionEyebrow]}>INDEPENDENT DECISION</Text>
          <Text style={styles.subheading}>Record the outcome</Text>
          <Text style={styles.label}>Reviewer note</Text>
          <TextInput multiline onChangeText={setNote} style={styles.note} value={note} />
          <View style={styles.actions}>
            <Pressable
              accessibilityRole="button"
              onPress={() => setState('Changes required')}
              style={styles.changeButton}
            >
              <Text style={styles.changeText}>Request changes</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={!item.checks.every(Boolean)}
              onPress={() => setState('Approved')}
              style={[styles.approveButton, !item.checks.every(Boolean) && styles.disabled]}
            >
              <Text style={styles.approveText}>Approve launch</Text>
            </Pressable>
          </View>
          <Text style={styles.makerChecker}>The proposal creator cannot approve this case.</Text>
        </View>
        <View style={styles.catalogueReview}>
          <Text style={styles.eyebrow}>CATALOGUE OVERSIGHT</Text>
          <TextInput
            autoCapitalize="none"
            onChangeText={setModeratorToken}
            placeholder="Local moderator token"
            style={styles.catalogueInput}
            value={moderatorToken}
          />
          <Pressable onPress={loadModeration} style={styles.catalogueButton}>
            <Text style={styles.catalogueButtonText}>Load moderation queue</Text>
          </Pressable>
          <Text style={styles.catalogueBody}>{moderationMessage}</Text>
          {moderationCases.map((item) => (
            <Text key={item.product_reference} style={styles.catalogueTitle}>
              {item.product_reference} · {item.decision_state}
            </Text>
          ))}
        </View>
        <View style={styles.moneyStrip} accessibilityLabel="Synthetic finance queue">
          <Text style={styles.eyebrow}>FINANCE INTEGRITY</Text>
          <Text style={styles.moneyTitle}>₹49 at risk · statement pending</Text>
          <Text style={styles.moneyBody}>Maker/checker refund · Ledger difference ₹0</Text>
        </View>
        <Text style={styles.boundary}>
          Company test mode: synthetic cases only. No production publication authority is enabled.
        </Text>
      </ScrollView>
    </View>
  );
}

function Evidence({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <View style={styles.evidence}>
      <Text style={styles.evidenceLabel}>{label}</Text>
      <Text style={styles.evidenceValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  catalogueReview: {
    marginTop: spacing.md,
    padding: spacing.md,
    borderLeftWidth: 4,
    borderLeftColor: '#B58A20',
    backgroundColor: '#FFF9DF',
  },
  catalogueTitle: {
    marginTop: spacing.xs,
    color: colors.textPrimary,
    fontSize: 17,
    fontWeight: '700',
  },
  catalogueInput: {
    marginTop: spacing.sm,
    padding: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: '#fff',
    color: colors.textPrimary,
  },
  catalogueButton: {
    alignSelf: 'flex-start',
    marginTop: spacing.sm,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: colors.textPrimary,
  },
  catalogueButtonText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  catalogueBody: {
    marginTop: spacing.xs,
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 18,
  },
  moneyStrip: {
    marginTop: spacing.md,
    padding: spacing.md,
    borderLeftWidth: 5,
    borderLeftColor: '#B24B34',
    backgroundColor: colors.surface,
  },
  moneyTitle: { marginTop: spacing.xs, color: colors.textPrimary, fontSize: 18, fontWeight: '700' },
  moneyBody: { marginTop: spacing.xs, color: colors.textSecondary, fontSize: 12, lineHeight: 18 },
  safe: { flex: 1, backgroundColor: '#F4F6F4' },
  shell: { flexGrow: 1, padding: spacing.md, paddingTop: spacing.xl, paddingBottom: spacing.xxl },
  topbar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingBottom: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  mark: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#16231C',
  },
  markText: { color: colors.surface, fontSize: 11, fontWeight: '800' },
  headerCopy: { flex: 1 },
  eyebrow: { color: '#506158', fontSize: 9, fontWeight: '800', letterSpacing: 0.9 },
  product: { marginTop: 3, color: colors.textPrimary, fontSize: 14, fontWeight: '700' },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.success },
  hero: { paddingTop: 40, paddingBottom: spacing.lg },
  title: {
    marginTop: spacing.xs,
    color: colors.textPrimary,
    fontSize: 42,
    fontWeight: '700',
    letterSpacing: -1.8,
    lineHeight: 43,
  },
  summary: { marginTop: spacing.sm, color: colors.textSecondary, fontSize: 14, lineHeight: 22 },
  queue: { gap: spacing.sm, paddingBottom: spacing.md },
  queueCard: {
    width: 245,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: '#F7F8F7',
  },
  queueSelected: {
    borderLeftWidth: 4,
    borderLeftColor: colors.evergreen,
    backgroundColor: colors.surface,
  },
  caseName: { color: colors.textPrimary, fontSize: 13, fontWeight: '700' },
  caseRef: { marginTop: spacing.xs, color: colors.textSecondary, fontSize: 9 },
  casePin: { marginTop: spacing.xs, color: colors.textSecondary, fontSize: 10 },
  workbench: {
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  caseHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.sm,
    alignItems: 'flex-start',
  },
  caseHeaderCopy: { flex: 1 },
  sectionTitle: {
    marginTop: spacing.xs,
    color: colors.textPrimary,
    fontSize: 22,
    fontWeight: '700',
    letterSpacing: -0.5,
  },
  stateBadge: {
    paddingHorizontal: 8,
    paddingVertical: 6,
    overflow: 'hidden',
    backgroundColor: '#FFF4B8',
    color: '#684C00',
    fontSize: 9,
    fontWeight: '800',
  },
  launchStrip: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginVertical: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  check: { width: '33.333%', paddingVertical: spacing.sm, alignItems: 'center' },
  checkReady: { backgroundColor: colors.evergreenTint },
  checkBlocked: { backgroundColor: '#FFF0ED' },
  checkMark: { color: colors.danger, fontSize: 15, fontWeight: '800' },
  checkLabel: { marginTop: 3, color: colors.danger, fontSize: 8, fontWeight: '700' },
  readyText: { color: colors.evergreen },
  subheading: {
    marginTop: spacing.xs,
    marginBottom: spacing.sm,
    color: colors.textPrimary,
    fontSize: 20,
    fontWeight: '700',
  },
  evidence: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.sm,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  evidenceLabel: { color: colors.textSecondary, fontSize: 10 },
  evidenceValue: { color: colors.textPrimary, fontSize: 9, fontWeight: '700' },
  privacy: {
    marginTop: spacing.md,
    padding: spacing.sm,
    backgroundColor: '#EEF1EF',
    color: colors.textSecondary,
    fontSize: 9,
    lineHeight: 15,
  },
  decisionEyebrow: { marginTop: spacing.xl },
  label: { marginBottom: spacing.xs, color: colors.textSecondary, fontSize: 10, fontWeight: '700' },
  note: {
    minHeight: 86,
    padding: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    textAlignVertical: 'top',
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.xs,
    marginTop: spacing.md,
  },
  changeButton: {
    minHeight: 42,
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  changeText: { color: colors.danger, fontSize: 10, fontWeight: '700' },
  approveButton: {
    minHeight: 42,
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
    backgroundColor: colors.evergreen,
  },
  approveText: { color: colors.surface, fontSize: 10, fontWeight: '700' },
  disabled: { opacity: 0.4 },
  makerChecker: {
    marginTop: spacing.sm,
    color: colors.textSecondary,
    fontSize: 9,
    textAlign: 'right',
  },
  boundary: {
    marginTop: spacing.sm,
    padding: spacing.sm,
    backgroundColor: '#FFF4B8',
    color: '#684C00',
    fontSize: 10,
    fontWeight: '700',
    lineHeight: 16,
  },
});

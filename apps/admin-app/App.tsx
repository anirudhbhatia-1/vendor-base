import { StatusBar } from 'expo-status-bar';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors, spacing } from '@neighbourhood-store/ui-tokens/native';
import { ControlPlane } from './ControlPlane';

export default function App() {
  return (
    <View style={styles.safe}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={styles.shell}>
        <View accessibilityRole="header" style={styles.masthead}>
          <View style={styles.adminMark}>
            <Text style={styles.lightMarkText}>AO</Text>
          </View>
          <View>
            <Text style={styles.eyebrow}>ADMIN ANDROID · COMPANY TEST</Text>
            <Text style={styles.product}>Marketplace control room</Text>
          </View>
        </View>
        <Text style={styles.title}>Operate from one auditable control plane.</Text>
        <Text style={styles.summary}>
          Work queues, reports and protected exports are role-scoped and recorded by the server.
        </Text>
        <ControlPlane />
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

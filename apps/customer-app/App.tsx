import { StatusBar } from 'expo-status-bar';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors, spacing } from '@neighbourhood-store/ui-tokens/native';
import { Marketplace } from './Marketplace';
import { Orders } from './Orders';

export default function App() {
  return (
    <View style={styles.safe}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={styles.shell}>
        <View accessibilityRole="header" style={styles.masthead}>
          <View style={styles.customerMark}>
            <Text style={styles.darkMarkText}>NS</Text>
          </View>
          <View>
            <Text style={styles.eyebrow}>CUSTOMER ANDROID · COMPANY TEST</Text>
            <Text style={styles.product}>Neighbourhood Store</Text>
          </View>
        </View>
        <Text style={styles.title}>Shop nearby stores with server-owned prices.</Text>
        <Text style={styles.summary}>
          Addresses, discovery, catalogue, grouped cart, quotes and synthetic checkout are persisted
          through the same local API used by the PWA.
        </Text>
        <Marketplace />
        <Orders />
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
    borderRadius: 12,
    backgroundColor: colors.customerMango,
  },
  darkMarkText: { color: colors.textPrimary, fontWeight: '800' },
  eyebrow: { color: colors.textSecondary, fontSize: 10, fontWeight: '700', letterSpacing: 0.6 },
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

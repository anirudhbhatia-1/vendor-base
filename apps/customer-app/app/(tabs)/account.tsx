import { Link } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { CustomerSignInPanel } from '../../SignInPanel';
import { useCustomerSession } from '../../session-context';
import { colors, radii, spacing } from '@neighbourhood-store/ui-tokens/native';

export default function AccountScreen() {
  const { session, setSession } = useCustomerSession();
  return (
    <ScrollView contentContainerStyle={styles.page}>
      <Text style={styles.title}>Your account</Text>
      <Text style={styles.description}>
        Manage your deliveries, find help, and review your account.
      </Text>
      {session ? (
        <View style={styles.links}>
          {[
            ['/orders', 'Your orders', 'Track deliveries and review past orders.'],
            ['/addresses', 'Delivery addresses', 'Choose where your shops deliver.'],
            ['/stores', 'Saved stores', 'Return to your favourite local shops.'],
            ['/notifications', 'Notifications', 'Your order, delivery and refund updates.'],
            ['/sessions', 'Signed-in devices', 'Review and revoke device access.'],
            ['/support', 'Help and support', 'Follow cases and conversations.'],
            ['/privacy', 'Privacy controls', 'Request your data or account deletion.'],
          ].map(([href, label, description]) => (
            <Link href={href as never} key={href} style={styles.link}>
              {label}
              {'\n'}
              <Text style={styles.description}>{description}</Text>
            </Link>
          ))}
        </View>
      ) : null}
      <CustomerSignInPanel onSignIn={setSession} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: spacing.md, gap: spacing.md, backgroundColor: colors.canvas },
  title: { fontSize: 28, fontWeight: '700', color: colors.textPrimary },
  description: { fontSize: 14, lineHeight: 22, fontWeight: '400', color: colors.textSecondary },
  links: { gap: spacing.sm },
  link: {
    padding: spacing.md,
    minHeight: 72,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.panel,
    backgroundColor: colors.surface,
    fontWeight: '700',
    color: colors.evergreen,
  },
});

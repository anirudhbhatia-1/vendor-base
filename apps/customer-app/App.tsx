import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { colors, radii, spacing } from '@neighbourhood-store/ui-tokens/native';

const checkpoints = [
  ['Shell', 'Running locally'],
  ['Marketplace API', 'Not connected'],
  ['Real shopping', 'Disabled'],
] as const;
type StoreItem = {
  readonly catalogue_variant_id: string;
  readonly price_minor: number;
  readonly title: string;
  readonly unit_label: string;
  readonly variable_weight: boolean;
};
const apiUrl = 'http://10.0.2.2:3001';

export default function App() {
  const [locationId, setLocationId] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [items, setItems] = useState<readonly StoreItem[]>([]);
  const [catalogueMessage, setCatalogueMessage] = useState(
    'Enter a local store ID to load live server prices.',
  );
  async function loadCatalogue() {
    try {
      const response = await fetch(`${apiUrl}/discovery/stores/${locationId}/catalogue`);
      if (!response.ok) throw new Error('Store unavailable. Check the location ID.');
      const body = (await response.json()) as { readonly items: readonly StoreItem[] };
      const next = body.items;
      setItems(next);
      setCatalogueMessage(
        next.length
          ? 'Products and prices came from the local server.'
          : 'No sellable products are available.',
      );
    } catch (error) {
      setCatalogueMessage(
        error instanceof Error ? error.message : 'Catalogue could not be loaded.',
      );
    }
  }
  async function addToCart(item: StoreItem) {
    if (!accessToken) {
      setCatalogueMessage('Paste a synthetic customer access token before adding to cart.');
      return;
    }
    try {
      const response = await fetch(`${apiUrl}/customer/cart/lines`, {
        method: 'POST',
        headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          vendor_location_id: locationId,
          catalogue_variant_id: item.catalogue_variant_id,
          quantity: 1,
        }),
      });
      if (!response.ok) throw new Error('Cart update was denied or unavailable.');
      setCatalogueMessage(`${item.title} added to the persisted local cart.`);
    } catch (error) {
      setCatalogueMessage(error instanceof Error ? error.message : 'Cart could not be updated.');
    }
  }
  return (
    <View style={styles.safe}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={styles.shell}>
        <View accessibilityRole="header" style={styles.masthead}>
          <View style={styles.roleMark}>
            <Text style={styles.roleMarkText}>NS</Text>
          </View>
          <View>
            <Text style={styles.eyebrow}>Customer Android app · Internal build</Text>
            <Text style={styles.productName}>Neighbourhood Store</Text>
          </View>
        </View>

        <View style={styles.intro}>
          <Text style={styles.localNote}>Jaipur test workspace · Synthetic data only</Text>
          <Text accessibilityRole="header" style={styles.title}>
            Your neighbourhood, by name.
          </Text>
          <Text style={styles.summary}>
            This local build reads live catalogue prices and can add products to a persisted test
            cart.
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
        <View style={styles.catalogueCard}>
          <Text style={styles.catalogueLabel}>LOCAL CATALOGUE</Text>
          <TextInput
            autoCapitalize="none"
            onChangeText={setLocationId}
            placeholder="Local vendor location UUID"
            style={styles.catalogueInput}
            value={locationId}
          />
          <TextInput
            autoCapitalize="none"
            onChangeText={setAccessToken}
            placeholder="Synthetic customer access token for cart"
            style={styles.catalogueInput}
            value={accessToken}
          />
          <Pressable
            accessibilityRole="button"
            onPress={loadCatalogue}
            style={styles.catalogueButton}
          >
            <Text style={styles.catalogueButtonText}>Load store</Text>
          </Pressable>
          <Text style={styles.catalogueBody}>{catalogueMessage}</Text>
          {items.map((item) => (
            <View key={item.catalogue_variant_id} style={styles.catalogueItem}>
              <Text style={styles.catalogueTitle}>{item.title}</Text>
              <Text style={styles.catalogueBody}>
                ₹{(item.price_minor / 100).toFixed(2)} ·{' '}
                {item.variable_weight ? 'Variable weight' : item.unit_label}
              </Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => void addToCart(item)}
                style={styles.catalogueButton}
              >
                <Text style={styles.catalogueButtonText}>Add to cart</Text>
              </Pressable>
            </View>
          ))}
          <Text style={styles.catalogueBody}>
            Exact stock and hidden inventory remain unavailable to customers.
          </Text>
        </View>

        <View style={styles.moneyStrip} accessibilityLabel="Synthetic payment recovery">
          <Text style={styles.moneyLabel}>TEST CHECKOUT</Text>
          <Text style={styles.moneyTitle}>Checking payment</Text>
          <Text style={styles.moneyBody}>
            Do not pay again. The same synthetic reference stays in reconciliation.
          </Text>
        </View>

        <Text style={styles.boundary}>
          No real customers, shops, messages, OTPs or money are used.
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  catalogueCard: {
    marginTop: spacing.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.panel,
    backgroundColor: colors.surface,
  },
  catalogueLabel: {
    color: colors.textSecondary,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.6,
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
  catalogueItem: {
    marginTop: spacing.md,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  catalogueTitle: {
    marginTop: spacing.md,
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: '700',
  },
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
    borderLeftColor: colors.customerMango,
    backgroundColor: '#fffdf5',
  },
  moneyLabel: { color: colors.textSecondary, fontSize: 10, fontWeight: '700', letterSpacing: 0.6 },
  moneyTitle: { marginTop: spacing.xs, color: colors.textPrimary, fontSize: 20, fontWeight: '700' },
  moneyBody: { marginTop: spacing.xs, color: colors.textSecondary, fontSize: 12, lineHeight: 18 },
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
    backgroundColor: colors.customerMango,
  },
  roleMarkText: { color: colors.textPrimary, fontSize: 14, fontWeight: '700' },
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
    backgroundColor: colors.customerMango,
  },
  stopText: { color: colors.textPrimary, fontSize: 12, fontWeight: '700' },
  checkpointCopy: { flex: 1 },
  checkpointLabel: { color: colors.textSecondary, fontSize: 13 },
  checkpointValue: { marginTop: 4, color: colors.textPrimary, fontSize: 17, fontWeight: '700' },
  boundary: {
    marginTop: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 14,
    overflow: 'hidden',
    borderRadius: radii.control,
    backgroundColor: '#FFF8D8',
    color: colors.textPrimary,
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 20,
  },
});

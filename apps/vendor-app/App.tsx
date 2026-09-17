import { useEffect, useRef, useState } from 'react';
import {
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { colors, radii, spacing } from '@neighbourhood-store/ui-tokens/native';
import { createRawRequester } from '@neighbourhood-store/contracts';
import { Orders } from './Orders';
import { VendorSignInPanel } from './SignInPanel';
import { createRequestScope } from './request-scope';
import {
  loadPersistedToken,
  loadPersistedVendorLocation,
  persistToken,
  persistVendorLocation,
} from './token-storage';

const globalEnv =
  (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};
const apiUrl = globalEnv['EXPO_PUBLIC_API_URL'] ?? 'http://10.0.2.2:3001';
type Product = {
  catalogue_product_id: string;
  lifecycle_state: 'ACTIVE' | 'INACTIVE';
  title: string;
  version: number;
};
type Notice = { in_app_notification_id: string; template_key: string };

export default function App() {
  const [screen, setScreen] = useState('Orders');
  const [token, setTokenRaw] = useState('');
  const [location, setLocationRaw] = useState('');
  const [products, setProducts] = useState<Product[]>([]);
  const [message, setMessage] = useState('Connect a vendor session and location.');
  const [notices, setNotices] = useState<Notice[]>([]);
  const [newTitle, setNewTitle] = useState('');
  const [newCategory, setNewCategory] = useState('');
  const [newPriceRupees, setNewPriceRupees] = useState('');
  const [newStock, setNewStock] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const mutationPending = useRef(false);
  const [alertsLoading, setAlertsLoading] = useState(false);
  const [alertsMessage, setAlertsMessage] = useState('Refresh to check for unread notifications.');
  const scope = useRef(createRequestScope()).current;

  function clearWorkspace() {
    scope.invalidate();
    setProducts([]);
    setNotices([]);
    setNewTitle('');
    setNewCategory('');
    setNewPriceRupees('');
    setNewStock('');
    setLoading(false);
    setAlertsLoading(false);
    setMessage('Load products for the selected location.');
    setAlertsMessage('Refresh to check for unread notifications.');
  }

  useEffect(() => {
    let mounted = true;
    const current = scope.capture();
    void loadPersistedToken()
      .then((t) => {
        if (mounted && current() && t) setTokenRaw(t);
      })
      .catch(() => {
        if (mounted && current()) setMessage('Session restore failed. Sign in again.');
      });
    void loadPersistedVendorLocation()
      .then((l) => {
        if (mounted && current() && l) setLocationRaw(l);
      })
      .catch(() => {
        if (mounted && current()) setMessage('Select your store location to continue.');
      });
    return () => {
      mounted = false;
      scope.invalidate();
    };
  }, [scope]);

  const setToken = (t: string) => {
    clearWorkspace();
    setTokenRaw(t);
    setLocationRaw('');
    void persistToken(t).catch(() => setMessage('Session could not be saved on this device.'));
    void persistVendorLocation('').catch(() => setMessage('Saved location could not be cleared.'));
  };
  const setLocation = (l: string) => {
    clearWorkspace();
    setLocationRaw(l);
    void persistVendorLocation(l).catch(() =>
      setMessage('Location could not be saved on this device.'),
    );
  };
  function makeRaw() {
    return createRawRequester({ baseUrl: apiUrl, getToken: () => token });
  }

  async function load() {
    if (!token || !location || loading) return;
    const current = scope.capture();
    setLoading(true);
    try {
      const raw = makeRaw();
      const body = await raw<Product[] | { data?: Product[] }>(
        `/vendor/locations/${location}/catalogue/products`,
      );
      if (!current()) return;
      const rows = Array.isArray(body) ? body : (body?.data ?? []);
      setProducts(rows);
      setMessage(
        rows.length ? 'Catalogue refreshed.' : 'No products yet. Add your first product below.',
      );
    } catch (error) {
      if (current())
        setMessage(error instanceof Error ? error.message : 'Catalogue failed. Try loading again.');
    } finally {
      if (current()) setLoading(false);
    }
  }
  async function createProduct() {
    if (mutationPending.current) return;
    if (!token || !location) {
      setMessage('Sign in and set the vendor location UUID first.');
      return;
    }
    const priceRupees = Number(newPriceRupees);
    const stock = Number(newStock);
    if (!newPriceRupees.trim() || !Number.isFinite(priceRupees) || priceRupees < 0) {
      setMessage('Price must be a non-negative number.');
      return;
    }
    if (!newStock.trim() || !Number.isInteger(stock) || stock < 0) {
      setMessage('Stock must be a non-negative integer.');
      return;
    }
    const title = newTitle.trim();
    if (title.length < 2) {
      setMessage('Product title required.');
      return;
    }
    const now = Date.now().toString(36).toUpperCase();
    const current = scope.capture();
    mutationPending.current = true;
    setSaving(true);
    try {
      const raw = makeRaw();
      await raw(`/vendor/locations/${location}/catalogue/products`, {
        method: 'POST',
        body: JSON.stringify({
          product_reference: `AND-PROD-${now}`,
          title,
          category: newCategory.toUpperCase(),
          unit_label: 'KG',
          tax_basis: 'INCLUSIVE',
          variable_weight: false,
          sku: `AND-SKU-${now}`,
          variant_title: title,
          price_minor: Math.round(priceRupees * 100),
          initial_stock_quantity: stock,
          low_stock_threshold: 0,
        }),
      });
      if (!current()) return;
      await load();
      if (current())
        setMessage(`Created "${title}" at ₹${priceRupees.toFixed(2)} · ${stock} units.`);
    } catch (error) {
      if (current()) setMessage(error instanceof Error ? error.message : 'Create failed.');
    } finally {
      mutationPending.current = false;
      setSaving(false);
    }
  }
  async function toggle(item: Product) {
    if (mutationPending.current || !token || !location) return;
    const current = scope.capture();
    mutationPending.current = true;
    setSaving(true);
    try {
      const action = item.lifecycle_state === 'ACTIVE' ? 'deactivate' : 'activate';
      const raw = makeRaw();
      await raw(
        `/vendor/locations/${location}/catalogue/products/${item.catalogue_product_id}/${action}`,
        { method: 'POST', body: JSON.stringify({ expected_version: item.version }) },
      );
      if (current()) await load();
    } catch (error) {
      if (current()) setMessage(error instanceof Error ? error.message : 'Update failed.');
    } finally {
      mutationPending.current = false;
      setSaving(false);
    }
  }
  async function notifications() {
    if (!token || alertsLoading) return;
    const current = scope.capture();
    setAlertsLoading(true);
    try {
      const raw = makeRaw();
      const rows = (await raw<Notice[]>('/notifications?unread_only=true')) ?? [];
      if (!current()) return;
      setNotices(rows);
      setAlertsMessage(
        rows.length ? 'Unread notifications refreshed.' : 'You have no unread notifications.',
      );
    } catch (error) {
      if (current())
        setAlertsMessage(
          error instanceof Error ? error.message : 'Notifications failed. Try again.',
        );
    } finally {
      if (current()) setAlertsLoading(false);
    }
  }
  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.shell}>
        <View style={styles.masthead}>
          <View style={styles.mark}>
            <Text style={styles.markText}>VS</Text>
          </View>
          <View>
            <Text style={styles.product}>Vendor workspace</Text>
            <Text style={styles.eyebrow}>STORE OPERATIONS</Text>
          </View>
          <View style={styles.openChip}>
            <Text style={styles.openChipText}>{token ? 'SESSION LOADED' : 'SIGN IN'}</Text>
          </View>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.navScroll}>
          <View style={styles.navRow}>
            {['Orders', 'Catalogue', 'Store', 'Payouts', 'More'].map((item) => (
              <Pressable
                accessibilityRole="tab"
                accessibilityState={{ selected: screen === item }}
                key={item}
                onPress={() => setScreen(item)}
                style={[styles.navItem, screen === item && styles.navItemActive]}
              >
                <Text style={[styles.navText, screen === item && styles.navTextActive]}>
                  {item}
                </Text>
              </Pressable>
            ))}
          </View>
        </ScrollView>
        <View style={styles.hero}>
          <Text style={styles.heroKicker}>{screen.toUpperCase()}</Text>
          <Text style={styles.title}>
            {screen === 'Orders'
              ? 'Keep orders moving.'
              : screen === 'Catalogue'
                ? 'Keep stock honest.'
                : screen === 'Store'
                  ? 'Open the door on your terms.'
                  : screen === 'Payouts'
                    ? 'Every rupee has a reason.'
                    : 'People, alerts and help.'}
          </Text>
          <Text style={styles.summary}>
            One store, one clear queue, no hidden inventory claims.
          </Text>
        </View>
        <VendorSignInPanel onSignIn={setToken} />
        <View style={styles.panel}>
          <Text style={styles.heading}>Working location</Text>
          <Text style={styles.settingValue}>
            Use the location ID supplied during onboarding. Switching location clears loaded
            products and unsaved product fields.
          </Text>
          <TextInput
            accessibilityLabel="Vendor location ID"
            autoCapitalize="none"
            autoCorrect={false}
            value={location}
            onChangeText={setLocation}
            placeholder="Location ID"
            style={styles.input}
          />
          <Text accessibilityLiveRegion="polite" style={styles.message}>
            {message}
          </Text>
        </View>
        {screen === 'Catalogue' && (
          <View style={styles.panel}>
            <Text style={styles.heading}>Live catalogue</Text>
            <Pressable
              onPress={() => token && location && void load()}
              style={[styles.button, (!token || !location) && { opacity: 0.4 }]}
              disabled={!token || !location || loading}
            >
              <Text style={styles.buttonText}>
                {loading ? 'Loading products…' : 'Load products'}
              </Text>
            </Pressable>
            <Text style={styles.settingLabel}>NEW PRODUCT</Text>
            <TextInput
              accessibilityLabel="Product title"
              value={newTitle}
              onChangeText={setNewTitle}
              placeholder="Title"
              style={styles.input}
            />
            <TextInput
              accessibilityLabel="Product category"
              value={newCategory}
              onChangeText={(v) => setNewCategory(v.toUpperCase())}
              placeholder="Category (uppercase)"
              style={styles.input}
            />
            <TextInput
              accessibilityLabel="Price in rupees"
              value={newPriceRupees}
              onChangeText={setNewPriceRupees}
              placeholder="Price (₹)"
              keyboardType="decimal-pad"
              style={styles.input}
            />
            <TextInput
              accessibilityLabel="Initial stock quantity"
              value={newStock}
              onChangeText={setNewStock}
              placeholder="Initial stock"
              keyboardType="number-pad"
              style={styles.input}
            />
            <Pressable
              onPress={() => void createProduct()}
              style={[styles.button, (!token || !location) && { opacity: 0.4 }]}
              disabled={!token || !location || saving}
            >
              <Text style={styles.buttonText}>{saving ? 'Saving…' : 'Create product'}</Text>
            </Pressable>
            {products.map((item) => (
              <View key={item.catalogue_product_id} style={styles.row}>
                <View style={styles.grow}>
                  <Text style={styles.rowTitle}>{item.title}</Text>
                  <Text style={styles.meta}>
                    {item.lifecycle_state} · v{item.version}
                  </Text>
                </View>
                <Pressable
                  disabled={saving}
                  onPress={() => void toggle(item)}
                  style={styles.smallButton}
                >
                  <Text style={styles.buttonText}>
                    {item.lifecycle_state === 'ACTIVE' ? 'Deactivate' : 'Activate'}
                  </Text>
                </Pressable>
              </View>
            ))}
          </View>
        )}
        {screen === 'Orders' && (
          <Orders key={`${token}:${location}`} accessToken={token} vendorLocationId={location} />
        )}
        {screen === 'Store' && (
          <View style={styles.panel}>
            <Text style={styles.heading}>Store settings</Text>
            <Text style={styles.settingValue}>
              Hours, closures, delivery areas and staff management are not available in this Android
              screen yet. Use the vendor PWA Store workspace. No opening status or delivery promise
              is inferred here.
            </Text>
          </View>
        )}
        {screen === 'Payouts' && (
          <View style={styles.panel}>
            <Text style={styles.heading}>Settlement ledger</Text>
            <Text style={styles.settingValue}>
              Open the vendor PWA to inspect live settlements from the finance statement endpoint.
              This mobile view will surface the same data in a later parity pass.
            </Text>
          </View>
        )}
        {screen === 'More' && (
          <View style={styles.panel}>
            <Text style={styles.heading}>Notifications</Text>
            <Pressable
              disabled={!token || alertsLoading}
              onPress={() => void notifications()}
              style={styles.button}
            >
              <Text style={styles.buttonText}>
                {alertsLoading ? 'Loading notifications…' : 'Refresh notifications'}
              </Text>
            </Pressable>
            <Text accessibilityLiveRegion="polite" style={styles.message}>
              {!token ? 'Sign in to view notifications.' : alertsMessage}
            </Text>
            {notices.map((notice) => (
              <Text style={styles.message} key={notice.in_app_notification_id}>
                {notice.template_key.replaceAll('.', ' ')}
              </Text>
            ))}
          </View>
        )}
        <Text style={styles.boundary}>
          Company-local synthetic inventory, orders and money only
        </Text>
      </ScrollView>
    </SafeAreaView>
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
  mark: {
    width: 46,
    height: 46,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    backgroundColor: colors.evergreen,
  },
  markText: { color: '#fff', fontWeight: '800' },
  eyebrow: { color: colors.textSecondary, fontSize: 9, fontWeight: '700', letterSpacing: 0.6 },
  product: { marginTop: 3, color: colors.textPrimary, fontSize: 18, fontWeight: '800' },
  openChip: {
    marginLeft: 'auto',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: colors.evergreenTint,
  },
  openChipText: { color: colors.evergreen, fontSize: 10, fontWeight: '900' },
  navScroll: { marginTop: spacing.md },
  navRow: { flexDirection: 'row', gap: 6 },
  navItem: {
    minHeight: 48,
    justifyContent: 'center',
    paddingHorizontal: 13,
    paddingVertical: 9,
    borderRadius: 999,
  },
  navItemActive: { backgroundColor: colors.evergreen },
  navText: { color: colors.textSecondary, fontSize: 11, fontWeight: '700' },
  navTextActive: { color: '#fff' },
  hero: {
    marginTop: spacing.lg,
    padding: spacing.lg,
    borderRadius: 24,
    backgroundColor: '#E8F3EC',
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
  metrics: { flexDirection: 'row', gap: spacing.xl, marginTop: spacing.lg },
  metricValue: { color: colors.textPrimary, fontSize: 24, fontWeight: '900' },
  metricLabel: { color: colors.textSecondary, fontSize: 10, fontWeight: '700' },
  panel: {
    marginTop: spacing.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.panel,
    backgroundColor: colors.surface,
  },
  heading: { color: colors.textPrimary, fontSize: 22, fontWeight: '800' },
  input: { marginTop: spacing.sm, padding: 10, borderWidth: 1, borderColor: colors.border },
  button: {
    minHeight: 48,
    justifyContent: 'center',
    alignSelf: 'flex-start',
    marginTop: spacing.sm,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: colors.textPrimary,
  },
  smallButton: {
    minHeight: 48,
    justifyContent: 'center',
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: colors.textPrimary,
  },
  buttonText: { color: '#fff', fontWeight: '700' },
  message: { marginTop: spacing.sm, color: colors.textSecondary },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  grow: { flex: 1 },
  rowTitle: { color: colors.textPrimary, fontWeight: '700' },
  meta: { marginTop: 3, color: colors.textSecondary, fontSize: 11 },
  settingLabel: {
    marginTop: spacing.lg,
    color: colors.evergreen,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.8,
  },
  settingValue: { marginTop: 5, color: colors.textPrimary, fontSize: 14, lineHeight: 21 },
  moneyRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  moneyValue: { color: colors.textPrimary, fontSize: 18, fontWeight: '900' },
  boundary: {
    marginTop: spacing.xl,
    color: colors.textSecondary,
    fontSize: 11,
    textAlign: 'center',
  },
});

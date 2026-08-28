import { useState } from 'react';
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
import { Orders } from './Orders';

const apiUrl = 'http://10.0.2.2:3001';
type Product = {
  catalogue_product_id: string;
  lifecycle_state: 'ACTIVE' | 'INACTIVE';
  title: string;
  version: number;
};
type Notice = { in_app_notification_id: string; template_key: string };

export default function App() {
  const [token, setToken] = useState('');
  const [location, setLocation] = useState('');
  const [products, setProducts] = useState<Product[]>([]);
  const [message, setMessage] = useState('Connect a vendor session and location.');
  const [notices, setNotices] = useState<Notice[]>([]);
  async function load() {
    try {
      const response = await fetch(`${apiUrl}/vendor/locations/${location}/catalogue/products`, {
        headers: { authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error(`Catalogue denied (${response.status}).`);
      const body = (await response.json()) as Product[] | { data?: Product[] };
      setProducts(Array.isArray(body) ? body : (body.data ?? []));
      setMessage('Persisted catalogue refreshed.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Catalogue failed.');
    }
  }
  async function toggle(item: Product) {
    try {
      const action = item.lifecycle_state === 'ACTIVE' ? 'deactivate' : 'activate';
      const response = await fetch(
        `${apiUrl}/vendor/locations/${location}/catalogue/products/${item.catalogue_product_id}/${action}`,
        {
          method: 'POST',
          headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
          body: JSON.stringify({ expected_version: item.version }),
        },
      );
      if (!response.ok) throw new Error(`Update denied (${response.status}).`);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Update failed.');
    }
  }
  async function notifications() {
    try {
      const response = await fetch(`${apiUrl}/notifications?unread_only=true`, {
        headers: { authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error(`Notifications denied (${response.status}).`);
      setNotices((await response.json()) as Notice[]);
      setMessage('Unread notifications refreshed.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Notifications failed.');
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
            <Text style={styles.eyebrow}>VENDOR ANDROID · COMPANY TEST</Text>
            <Text style={styles.product}>Store operations</Text>
          </View>
        </View>
        <Text style={styles.title}>Catalogue and fulfilment from server truth.</Text>
        <Text style={styles.summary}>
          Every product state and order transition is persisted, versioned and scoped to one vendor
          location.
        </Text>
        <View style={styles.panel}>
          <Text style={styles.heading}>Live catalogue</Text>
          <TextInput
            value={token}
            onChangeText={setToken}
            placeholder="Vendor access token"
            style={styles.input}
          />
          <TextInput
            value={location}
            onChangeText={setLocation}
            placeholder="Vendor location UUID"
            style={styles.input}
          />
          <Pressable onPress={() => void load()} style={styles.button}>
            <Text style={styles.buttonText}>Load products</Text>
          </Pressable>
          <Pressable onPress={() => void notifications()} style={styles.button}>
            <Text style={styles.buttonText}>Unread notifications</Text>
          </Pressable>
          <Text style={styles.message}>{message}</Text>
          {notices.map((notice) => (
            <Text style={styles.message} key={notice.in_app_notification_id}>
              {notice.template_key.replaceAll('.', ' ')}
            </Text>
          ))}
          {products.map((item) => (
            <View key={item.catalogue_product_id} style={styles.row}>
              <View style={styles.grow}>
                <Text style={styles.rowTitle}>{item.title}</Text>
                <Text style={styles.meta}>
                  {item.lifecycle_state} · v{item.version}
                </Text>
              </View>
              <Pressable onPress={() => void toggle(item)} style={styles.smallButton}>
                <Text style={styles.buttonText}>
                  {item.lifecycle_state === 'ACTIVE' ? 'Deactivate' : 'Activate'}
                </Text>
              </Pressable>
            </View>
          ))}
        </View>
        <Orders />
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
  title: {
    marginTop: spacing.xl,
    color: colors.textPrimary,
    fontSize: 34,
    lineHeight: 38,
    fontWeight: '800',
  },
  summary: { marginTop: spacing.sm, color: colors.textSecondary, fontSize: 15, lineHeight: 22 },
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
    alignSelf: 'flex-start',
    marginTop: spacing.sm,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: colors.textPrimary,
  },
  smallButton: { paddingHorizontal: 10, paddingVertical: 8, backgroundColor: colors.textPrimary },
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
  boundary: {
    marginTop: spacing.xl,
    color: colors.textSecondary,
    fontSize: 11,
    textAlign: 'center',
  },
});

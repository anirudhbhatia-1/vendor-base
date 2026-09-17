import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import {
  createApiClient,
  createRawRequester,
  type Address,
  type Storefront,
} from '@neighbourhood-store/contracts';
import { useCustomerSession } from './session-context';

const globalEnv =
  (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};
const apiUrl = globalEnv['EXPO_PUBLIC_API_URL'] ?? 'http://10.0.2.2:3001';

function useApi() {
  const { accessToken } = useCustomerSession();
  return createApiClient({ baseUrl: apiUrl, getToken: () => accessToken || null });
}

export function NativeStorePage({
  vendorLocationId,
  productId,
}: {
  vendorLocationId: string;
  productId?: string;
}) {
  const api = useApi();
  const [store, setStore] = useState<Storefront | null>(null);
  const [message, setMessage] = useState('Loading store…');
  useEffect(() => {
    void api.discovery
      .storefront(vendorLocationId)
      .then(setStore)
      .catch((error: unknown) =>
        setMessage(error instanceof Error ? error.message : 'Store unavailable.'),
      );
  }, [vendorLocationId]);
  const products = productId
    ? store?.products.filter((item) => item.catalogue_product_id === productId)
    : store?.products;
  return (
    <ScrollView contentContainerStyle={s.page}>
      {store ? (
        <>
          <Text style={s.title}>{store.location_name.replace(/^SYNTH /, '')}</Text>
          <Text style={s.copy}>
            {store.profile_description ?? 'Everyday essentials from this local shop.'}
          </Text>
          {products?.map((product) => (
            <View style={s.card} key={product.catalogue_product_id}>
              <Text style={s.heading}>{product.title.replace(/^SYNTH /, '')}</Text>
              <Text>
                {product.unit_label} ·{' '}
                {product.price_minor === null
                  ? 'Price unavailable'
                  : `₹${(product.price_minor / 100).toFixed(2)}`}
              </Text>
              <Pressable
                style={s.button}
                onPress={() =>
                  void api.cart
                    .addLine({
                      vendor_location_id: vendorLocationId,
                      catalogue_variant_id: product.catalogue_variant_id,
                      quantity: 1,
                      substitution_preference: product.substitution_available
                        ? 'ASK_CUSTOMER'
                        : 'NO_SUBSTITUTION',
                    })
                    .then(() => setMessage('Added to basket.'))
                    .catch((error: unknown) =>
                      setMessage(error instanceof Error ? error.message : 'Could not add item.'),
                    )
                }
              >
                <Text style={s.buttonText}>Add to basket</Text>
              </Pressable>
            </View>
          ))}
        </>
      ) : (
        <Text>{message}</Text>
      )}
      <Text style={s.copy}>{message}</Text>
    </ScrollView>
  );
}

export function NativeAddressesPage() {
  const api = useApi();
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [label, setLabel] = useState('Home');
  const [pin, setPin] = useState('');
  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');
  const [message, setMessage] = useState('');
  const load = () => api.addresses.list().then((body) => setAddresses(body.addresses));
  useEffect(() => {
    void load().catch(() => setMessage('Addresses could not be loaded.'));
  }, []);
  async function add() {
    try {
      if (!latitude.trim() || !longitude.trim())
        throw new Error('Enter the delivery coordinates before saving.');
      await api.addresses.create({
        address_reference: `ADDRESS-ANDROID-${Date.now().toString(36).toUpperCase()}`,
        label,
        pin_code: pin,
        latitude: Number(latitude),
        longitude: Number(longitude),
        coordinate_source: 'MANUAL_PIN',
      });
      await load();
      setMessage('Address saved.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Address could not be saved.');
    }
  }
  return (
    <ScrollView contentContainerStyle={s.page}>
      <Text style={s.title}>Delivery addresses</Text>
      <TextInput
        accessibilityLabel="Address name"
        onChangeText={setLabel}
        style={s.input}
        value={label}
      />
      <TextInput
        accessibilityLabel="PIN code"
        keyboardType="number-pad"
        maxLength={6}
        onChangeText={setPin}
        style={s.input}
        value={pin}
      />
      <TextInput
        accessibilityLabel="Delivery latitude"
        placeholder="Delivery latitude"
        keyboardType="numbers-and-punctuation"
        onChangeText={setLatitude}
        style={s.input}
        value={latitude}
      />
      <TextInput
        accessibilityLabel="Delivery longitude"
        placeholder="Delivery longitude"
        keyboardType="numbers-and-punctuation"
        onChangeText={setLongitude}
        style={s.input}
        value={longitude}
      />
      <Pressable style={s.button} onPress={() => void add()}>
        <Text style={s.buttonText}>Add address</Text>
      </Pressable>
      <Text>{message}</Text>
      {addresses.map((address) => (
        <View style={s.card} key={address.customer_address_id}>
          <Text style={s.heading}>{address.label.replace(/^SYNTH /, '')}</Text>
          <Text>
            {address.pin_code}
            {address.is_selected ? ' · Delivering here' : ''}
          </Text>
          <View style={s.row}>
            {!address.is_selected ? (
              <Pressable
                style={s.secondary}
                onPress={() => void api.addresses.select(address.customer_address_id).then(load)}
              >
                <Text>Deliver here</Text>
              </Pressable>
            ) : null}
            <Pressable
              disabled={address.is_selected}
              style={s.secondary}
              onPress={() => void api.addresses.remove(address.customer_address_id).then(load)}
            >
              <Text>Delete</Text>
            </Pressable>
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

export function NativeAccountResource({
  kind,
}: {
  kind: 'notifications' | 'privacy' | 'sessions' | 'support';
}) {
  const api = useApi();
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [message, setMessage] = useState('Loading…');
  const load = async () => {
    if (kind === 'notifications')
      setRows(
        (await api.notifications.list()).notifications as unknown as Record<string, unknown>[],
      );
    if (kind === 'sessions')
      setRows((await api.auth.sessions()).sessions as unknown as Record<string, unknown>[]);
    if (kind === 'support')
      setRows((await api.orders.supportCases()).cases as unknown as Record<string, unknown>[]);
    if (kind === 'privacy') setRows((await api.auth.privacyRequests()).requests);
    setMessage('');
  };
  useEffect(() => {
    void load().catch((error: unknown) =>
      setMessage(error instanceof Error ? error.message : 'Could not load.'),
    );
  }, [kind]);
  return (
    <ScrollView contentContainerStyle={s.page}>
      <Text style={s.title}>
        {kind[0]?.toUpperCase()}
        {kind.slice(1)}
      </Text>
      {kind === 'privacy' ? (
        <View style={s.row}>
          <Pressable
            style={s.button}
            onPress={() => void api.auth.requestPrivacy('DATA_EXPORT').then(load)}
          >
            <Text style={s.buttonText}>Request export</Text>
          </Pressable>
          <Pressable
            style={s.secondary}
            onPress={() => void api.auth.requestPrivacy('ACCOUNT_DELETION').then(load)}
          >
            <Text>Request deletion</Text>
          </Pressable>
        </View>
      ) : null}
      <Text>{message}</Text>
      {rows.map((row, index) => (
        <View
          style={s.card}
          key={String(
            row['support_case_id'] ??
              row['session_id'] ??
              row['in_app_notification_id'] ??
              row['customer_privacy_request_id'] ??
              index,
          )}
        >
          <Text style={s.heading}>
            {String(
              row['category'] ??
                row['template_key'] ??
                row['device_label'] ??
                row['request_kind'] ??
                'Update',
            ).replaceAll('_', ' ')}
          </Text>
          <Text>{String(row['lifecycle_state'] ?? row['state'] ?? row['created_at'] ?? '')}</Text>
        </View>
      ))}
    </ScrollView>
  );
}

export function NativeCheckoutPage() {
  const { accessToken } = useCustomerSession();
  const raw = createRawRequester({ baseUrl: apiUrl, getToken: () => accessToken || null });
  const [message, setMessage] = useState('Your server cart will be revalidated before payment.');
  async function quote() {
    try {
      const cart = await raw<{ cart_id: string }>('/customer/cart');
      const result = await raw<{ total_minor: number; expires_at: string }>(
        '/customer/checkout/quotes',
        { method: 'POST', body: JSON.stringify({ cart_id: cart.cart_id }) },
      );
      setMessage(
        `Payable ₹${(result.total_minor / 100).toFixed(2)} · held until ${new Date(result.expires_at).toLocaleTimeString()}`,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Checkout unavailable.');
    }
  }
  return (
    <View style={s.page}>
      <Text style={s.title}>Checkout</Text>
      <Text style={s.copy}>{message}</Text>
      <Pressable style={s.button} onPress={() => void quote()}>
        <Text style={s.buttonText}>Validate basket and quote</Text>
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  page: { padding: 16, gap: 14, backgroundColor: '#F8F5EC', flexGrow: 1 },
  title: { fontSize: 30, fontWeight: '900', color: '#16251F' },
  heading: { fontSize: 18, fontWeight: '800', color: '#16251F' },
  copy: { lineHeight: 21, color: '#52615B' },
  card: {
    padding: 16,
    gap: 8,
    backgroundColor: '#FFF',
    borderWidth: 1,
    borderColor: '#D8D4C8',
    borderRadius: 16,
  },
  input: {
    padding: 14,
    backgroundColor: '#FFF',
    borderWidth: 1,
    borderColor: '#D8D4C8',
    borderRadius: 12,
  },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  button: { padding: 13, backgroundColor: '#174A3A', borderRadius: 12, alignSelf: 'flex-start' },
  buttonText: { color: '#FFF', fontWeight: '800' },
  secondary: { padding: 12, borderWidth: 1, borderColor: '#174A3A', borderRadius: 12 },
});

import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { colors, radii, spacing } from '@neighbourhood-store/ui-tokens/native';

const apiUrl = 'http://10.0.2.2:3001';
type Address = {
  customer_address_id: string;
  label: string;
  pin_code: string;
  is_selected: boolean;
};
type Store = {
  vendor_location_id: string;
  location_name: string;
  distance_meters: number;
  minimum_order_minor: number;
  is_open_now: boolean;
};
type Product = {
  catalogue_product_id: string;
  catalogue_variant_id: string;
  title: string;
  unit_label: string;
  price_minor: number | null;
  is_stale: boolean;
};
type Storefront = Store & { products: Product[]; fulfilment_modes: string[] };
type Quote = {
  checkout_quote_id: string;
  total_minor: number;
  expires_at: string;
  groups: { vendor_location_id: string; total_minor: number; promise: string }[];
};

export function Marketplace() {
  const [token, setToken] = useState('');
  const [address, setAddress] = useState<Address | null>(null);
  const [stores, setStores] = useState<Store[]>([]);
  const [store, setStore] = useState<Storefront | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [message, setMessage] = useState('Paste a synthetic customer token, then open the market.');
  async function request(path: string, init?: RequestInit) {
    const response = await fetch(`${apiUrl}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${token}`,
        ...(init?.body ? { 'content-type': 'application/json' } : {}),
      },
    });
    if (!response.ok) throw new Error(`Request failed (${response.status}).`);
    return response.json();
  }
  async function openMarket() {
    try {
      const body = (await request('/customer/addresses')) as { addresses: Address[] };
      let selected = body.addresses.find((a) => a.is_selected) ?? body.addresses[0];
      if (!selected) {
        selected = (await request('/customer/addresses', {
          method: 'POST',
          body: JSON.stringify({
            address_reference: `SYNTH-ADDRESS-ANDROID-${Date.now().toString(36).toUpperCase()}`,
            label: 'SYNTH Android Home',
            pin_code: '302020',
            latitude: 26.8505,
            longitude: 75.7628,
            coordinate_source: 'MANUAL_PIN',
            landmark: 'SYNTH Mansarovar',
            delivery_instructions: 'SYNTH Test delivery',
          }),
        })) as Address;
        await request(`/customer/addresses/${selected.customer_address_id}/select`, {
          method: 'POST',
        });
      }
      setAddress(selected);
      const found = (await request(
        `/customer/discovery/stores?customer_address_id=${selected.customer_address_id}`,
      )) as { stores: Store[] };
      setStores(found.stores);
      setMessage(
        found.stores.length ? 'Nearby server stores loaded.' : 'No store serves this test address.',
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Market failed.');
    }
  }
  async function openStore(id: string) {
    try {
      setStore((await request(`/customer/discovery/stores/${id}`)) as Storefront);
      setMessage('Storefront loaded without cross-store catalogue mixing.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Store failed.');
    }
  }
  async function add(product: Product) {
    if (!store || !address) return;
    try {
      await request('/customer/cart/lines', {
        method: 'POST',
        body: JSON.stringify({
          vendor_location_id: store.vendor_location_id,
          catalogue_variant_id: product.catalogue_variant_id,
          quantity: 1,
          fulfilment_method: store.fulfilment_modes.includes('PLATFORM_DELIVERY')
            ? 'PLATFORM_DELIVERY'
            : store.fulfilment_modes[0],
          substitution_preference: 'ASK_CUSTOMER',
        }),
      });
      await request('/customer/cart/address', {
        method: 'PUT',
        body: JSON.stringify({ customer_address_id: address.customer_address_id }),
      });
      setMessage(`${product.title.replace('SYNTH ', '')} added to the persisted grouped cart.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Cart failed.');
    }
  }
  async function checkout() {
    try {
      const cart = (await request('/customer/cart')) as { cart_id: string };
      const next = (await request('/customer/checkout/quotes', {
        method: 'POST',
        body: JSON.stringify({ cart_id: cart.cart_id }),
      })) as Quote;
      setQuote(next);
      setMessage(`Stock held until ${new Date(next.expires_at).toLocaleTimeString()}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Quote failed.');
    }
  }
  async function pay() {
    if (!quote) return;
    try {
      const result = (await request('/customer/checkout/groups', {
        method: 'POST',
        body: JSON.stringify({
          checkout_quote_id: quote.checkout_quote_id,
          provider_scenario: 'SUCCESS',
          idempotency_key: `android-${quote.checkout_quote_id}`,
          payment_method: 'UPI',
        }),
      })) as { lifecycle_state: string; orders: unknown[] };
      setMessage(
        `${result.lifecycle_state.replaceAll('_', ' ')} · ${result.orders.length} isolated store orders.`,
      );
      setQuote(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Payment failed.');
    }
  }
  return (
    <View style={s.panel}>
      <Text style={s.kicker}>JAIPUR MARKET LANE</Text>
      <Text style={s.heading}>Shop the server-backed marketplace.</Text>
      <TextInput
        autoCapitalize="none"
        value={token}
        onChangeText={setToken}
        placeholder="Synthetic customer access token"
        style={s.input}
      />
      <Button label="Open my market" onPress={openMarket} />
      <Text style={s.message}>{message}</Text>
      {address && (
        <Text style={s.meta}>
          Delivering to {address.label} · {address.pin_code}
        </Text>
      )}
      {stores.map((item) => (
        <View key={item.vendor_location_id} style={s.card}>
          <Text style={s.title}>{item.location_name.replace('SYNTH ', '')}</Text>
          <Text style={s.meta}>
            {(item.distance_meters / 1000).toFixed(1)} km · Minimum ₹
            {(item.minimum_order_minor / 100).toFixed(0)} · {item.is_open_now ? 'Open' : 'Closed'}
          </Text>
          <Button label="Shop here" onPress={() => openStore(item.vendor_location_id)} />
        </View>
      ))}
      {store && (
        <View>
          <Text style={s.heading}>{store.location_name.replace('SYNTH ', '')}</Text>
          {store.products.map((product) => (
            <View key={product.catalogue_product_id} style={s.product}>
              <View>
                <Text style={s.title}>{product.title.replace('SYNTH ', '')}</Text>
                <Text style={s.meta}>
                  {product.unit_label} ·{' '}
                  {product.price_minor === null
                    ? 'No price'
                    : `₹${(product.price_minor / 100).toFixed(2)}`}
                </Text>
              </View>
              <Button
                disabled={product.is_stale || product.price_minor === null}
                label="Add"
                onPress={() => add(product)}
              />
            </View>
          ))}
          <Button label="Quote and hold cart" onPress={checkout} />
        </View>
      )}
      {quote && (
        <View style={s.quote}>
          <Text style={s.heading}>₹{(quote.total_minor / 100).toFixed(2)}</Text>
          {quote.groups.map((g) => (
            <Text key={g.vendor_location_id} style={s.meta}>
              Store {g.vendor_location_id.slice(0, 8)} · ₹{(g.total_minor / 100).toFixed(2)} ·{' '}
              {g.promise}
            </Text>
          ))}
          <Button label="Pay by synthetic UPI" onPress={pay} />
        </View>
      )}
    </View>
  );
}
function Button({
  label,
  onPress,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable disabled={disabled} onPress={onPress} style={[s.button, disabled && s.disabled]}>
      <Text style={s.buttonText}>{label}</Text>
    </Pressable>
  );
}
const s = StyleSheet.create({
  panel: {
    marginTop: spacing.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.panel,
    backgroundColor: '#fffdf5',
  },
  kicker: { color: colors.textSecondary, fontSize: 10, fontWeight: '800', letterSpacing: 0.7 },
  heading: { marginTop: spacing.xs, color: colors.textPrimary, fontSize: 21, fontWeight: '800' },
  input: {
    marginTop: spacing.md,
    padding: 11,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: '#fff',
  },
  button: {
    alignSelf: 'flex-start',
    marginTop: spacing.sm,
    paddingHorizontal: 13,
    paddingVertical: 10,
    borderRadius: radii.control,
    backgroundColor: colors.textPrimary,
  },
  buttonText: { color: '#fff', fontWeight: '700' },
  disabled: { opacity: 0.4 },
  message: {
    marginTop: spacing.md,
    padding: 10,
    borderLeftWidth: 4,
    borderLeftColor: colors.customerMango,
    backgroundColor: '#fff3bd',
    color: colors.textPrimary,
  },
  meta: { marginTop: 4, color: colors.textSecondary, fontSize: 12, lineHeight: 18 },
  card: {
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  product: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginTop: spacing.sm,
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  title: { color: colors.textPrimary, fontSize: 15, fontWeight: '700' },
  quote: { marginTop: spacing.md, padding: spacing.md, backgroundColor: '#e7f4e9' },
});

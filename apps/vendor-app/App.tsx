import { useMemo, useState } from 'react';
import {
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

type Filter = 'All' | 'Counted' | 'Vendor confirms';
type Item = {
  readonly id: string;
  readonly name: string;
  readonly reference: string;
  readonly basis: 'COUNTED' | 'VENDOR_CONFIRMS';
  readonly available: number | null;
  readonly held: number;
  readonly provisional: number;
  readonly committed: number;
};
type RemoteProduct = {
  readonly catalogue_product_id: string;
  readonly lifecycle_state: 'ACTIVE' | 'INACTIVE';
  readonly title: string;
  readonly version: number;
};
const apiUrl = 'http://10.0.2.2:3001';

const colors = {
  canvas: '#edf1ec',
  evergreen: '#1f6846',
  greenTint: '#e6f1e9',
  ink: '#17211b',
  muted: '#667068',
  line: '#ccd5ce',
  surface: '#ffffff',
  warning: '#8a6410',
  warningTint: '#fff3bd',
} as const;

const items: readonly [Item, ...Item[]] = [
  {
    id: 'tomato',
    name: 'SYNTH Jaipur Tomato',
    reference: 'SYNTH-PROD-TOMATO-0001',
    basis: 'COUNTED',
    available: 18,
    held: 4,
    provisional: 3,
    committed: 6,
  },
  {
    id: 'potato',
    name: 'SYNTH New Potato',
    reference: 'SYNTH-PROD-POTATO-0002',
    basis: 'COUNTED',
    available: 5,
    held: 2,
    provisional: 0,
    committed: 9,
  },
  {
    id: 'coriander',
    name: 'SYNTH Seasonal Coriander',
    reference: 'SYNTH-PROD-CORIANDER-0001',
    basis: 'VENDOR_CONFIRMS',
    available: null,
    held: 2,
    provisional: 1,
    committed: 0,
  },
] as const;
const filters: readonly Filter[] = ['All', 'Counted', 'Vendor confirms'];

export default function App() {
  const [activeFilter, setActiveFilter] = useState<Filter>('All');
  const [selectedId, setSelectedId] = useState(items[0].id);
  const [confirmedIds, setConfirmedIds] = useState<ReadonlySet<string>>(new Set());
  const [catalogueActive, setCatalogueActive] = useState(true);
  const [variableWeight, setVariableWeight] = useState(false);
  const [replacementAllowed, setReplacementAllowed] = useState(false);
  const [accessToken, setAccessToken] = useState('');
  const [vendorLocationId, setVendorLocationId] = useState('');
  const [remoteProducts, setRemoteProducts] = useState<readonly RemoteProduct[]>([]);
  const [remoteMessage, setRemoteMessage] = useState(
    'Enter local vendor access and location ID to load persisted products.',
  );
  async function loadRemoteProducts() {
    try {
      const response = await fetch(
        `${apiUrl}/vendor/locations/${vendorLocationId}/catalogue/products`,
        { headers: { authorization: `Bearer ${accessToken}` } },
      );
      if (!response.ok) throw new Error('Local access cannot manage this store.');
      const body = (await response.json()) as
        { readonly data?: readonly RemoteProduct[] } | readonly RemoteProduct[];
      const next: readonly RemoteProduct[] = Array.isArray(body)
        ? (body as readonly RemoteProduct[])
        : ((body as { readonly data?: readonly RemoteProduct[] }).data ?? []);
      setRemoteProducts(next);
      setRemoteMessage(
        next.length ? 'Server catalogue loaded.' : 'Connected. No server products exist yet.',
      );
    } catch (error) {
      setRemoteMessage(error instanceof Error ? error.message : 'Catalogue request failed.');
    }
  }
  async function toggleRemoteProduct() {
    const product = remoteProducts[0];
    if (!product) return;
    try {
      const action = product.lifecycle_state === 'ACTIVE' ? 'deactivate' : 'activate';
      const response = await fetch(
        `${apiUrl}/vendor/locations/${vendorLocationId}/catalogue/products/${product.catalogue_product_id}/${action}`,
        {
          method: 'POST',
          headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
          body: JSON.stringify({ expected_version: product.version }),
        },
      );
      if (!response.ok) throw new Error('Server listing state could not be changed.');
      await loadRemoteProducts();
    } catch (error) {
      setRemoteMessage(error instanceof Error ? error.message : 'Catalogue request failed.');
    }
  }
  const visibleItems = useMemo(
    () =>
      items.filter((item) => {
        if (activeFilter === 'Counted') return item.basis === 'COUNTED';
        if (activeFilter === 'Vendor confirms') return item.basis === 'VENDOR_CONFIRMS';
        return true;
      }),
    [activeFilter],
  );
  const selected = items.find((item) => item.id === selectedId) ?? items[0];

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.shell}>
        <View style={styles.masthead}>
          <View style={styles.roleMark}>
            <Text style={styles.roleMarkText}>NS</Text>
          </View>
          <View style={styles.mastheadCopy}>
            <Text style={styles.eyebrow}>VENDOR APP · COMPANY TEST</Text>
            <Text style={styles.productName}>Jain Stores Test · 302020</Text>
          </View>
          <View style={styles.testChip}>
            <Text style={styles.testChipText}>SYNTH</Text>
          </View>
        </View>

        <View style={styles.intro}>
          <Text style={styles.kicker}>INVENTORY RESERVATION</Text>
          <Text accessibilityRole="header" style={styles.title}>
            Know what is free, held and promised.
          </Text>
          <Text style={styles.summary}>
            Counted stock moves on the server. Vendor-confirms items still wait for a person.
          </Text>
          <View style={styles.totals}>
            <View style={styles.totalCell}>
              <Text style={styles.totalLabel}>EXACT UNITS FREE</Text>
              <Text style={styles.totalValue}>23</Text>
            </View>
            <View style={styles.totalCell}>
              <Text style={styles.totalLabel}>NEEDS ATTENTION</Text>
              <Text style={styles.totalValue}>1</Text>
            </View>
          </View>
        </View>

        <ScrollView
          horizontal
          contentContainerStyle={styles.filters}
          showsHorizontalScrollIndicator={false}
        >
          {filters.map((filter) => (
            <Pressable
              accessibilityRole="button"
              key={filter}
              onPress={() => setActiveFilter(filter)}
              style={[styles.filter, activeFilter === filter && styles.filterActive]}
            >
              <Text style={[styles.filterText, activeFilter === filter && styles.filterTextActive]}>
                {filter}
              </Text>
            </Pressable>
          ))}
        </ScrollView>

        <ScrollView
          horizontal
          contentContainerStyle={styles.itemRail}
          showsHorizontalScrollIndicator={false}
        >
          {visibleItems.map((item) => (
            <Pressable
              accessibilityRole="button"
              key={item.id}
              onPress={() => setSelectedId(item.id)}
              style={[styles.itemCard, selected.id === item.id && styles.itemCardActive]}
            >
              <View style={styles.itemHeader}>
                <View
                  style={[styles.signal, item.basis === 'VENDOR_CONFIRMS' && styles.signalWarning]}
                />
                <Text style={styles.itemBasis}>
                  {item.basis === 'COUNTED' ? 'COUNTED' : 'CONFIRM'}
                </Text>
              </View>
              <Text numberOfLines={2} style={styles.itemName}>
                {item.name}
              </Text>
              <Text numberOfLines={1} style={styles.itemReference}>
                {item.reference}
              </Text>
              <Text style={styles.itemQuantity}>{item.available ?? 'Ask'}</Text>
              <Text style={styles.itemQuantityLabel}>
                {item.available === null ? 'vendor confirms' : 'free now'}
              </Text>
            </Pressable>
          ))}
        </ScrollView>

        <View style={styles.sheet}>
          <Text style={styles.reference}>{selected.reference}</Text>
          <Text style={styles.sheetTitle}>{selected.name}</Text>
          <View
            style={[styles.basisChip, selected.basis === 'VENDOR_CONFIRMS' && styles.basisWarning]}
          >
            <Text
              style={[
                styles.basisText,
                selected.basis === 'VENDOR_CONFIRMS' && styles.basisWarningText,
              ]}
            >
              {selected.basis === 'COUNTED' ? 'Counted stock' : 'Vendor confirms'}
            </Text>
          </View>
          <View style={styles.movement}>
            <Movement
              label="Free now"
              value={selected.available === null ? '—' : String(selected.available)}
            />
            <Movement label="Soft held" value={String(selected.held)} />
            <Movement label="Provisional" value={String(selected.provisional)} />
            <Movement label="Committed" value={String(selected.committed)} />
          </View>
          <View style={styles.truthNote}>
            <Text style={styles.truthMark}>{selected.basis === 'COUNTED' ? '−' : '?'}</Text>
            <View style={styles.truthCopy}>
              <Text style={styles.truthTitle}>
                {selected.basis === 'COUNTED'
                  ? 'The free count is authoritative.'
                  : 'No exact count is claimed.'}
              </Text>
              <Text style={styles.truthBody}>
                {selected.basis === 'COUNTED'
                  ? 'Concurrent holds cannot spend the same units twice. Release or expiry restores them once.'
                  : 'Customer intent is visible, but a person still confirms availability before acceptance.'}
              </Text>
            </View>
          </View>
          <View style={styles.confirmRow}>
            <View>
              <Text style={styles.confirmLabel}>LAST CONFIRMATION</Text>
              <Text style={styles.confirmValue}>
                {confirmedIds.has(selected.id) ? 'Just now · local test' : '8 min ago'}
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              onPress={() => setConfirmedIds((current) => new Set([...current, selected.id]))}
              style={styles.confirmButton}
            >
              <Text style={styles.confirmButtonText}>
                {selected.basis === 'COUNTED' ? 'Confirm count' : 'Confirm availability'}
              </Text>
            </Pressable>
          </View>
          <View style={styles.contract}>
            <StateDot label="Soft held" />
            <StateDot label="Provisional" />
            <StateDot label="Committed" />
            <StateDot label="Released" />
          </View>
          <Text style={styles.expiry}>
            Soft-held and provisional records expire on server time.
          </Text>
        </View>
        <View style={styles.catalogueCard}>
          <Text style={styles.kicker}>CATALOGUE MANAGEMENT</Text>
          <Text style={styles.catalogueTitle}>Edit {selected.name}</Text>
          <Text style={styles.catalogueText}>
            Manual local controls for product lifecycle, variable weight, images and substitutions.
          </Text>
          <TextInput
            autoCapitalize="none"
            onChangeText={setAccessToken}
            placeholder="Local vendor token"
            style={styles.catalogueInput}
            value={accessToken}
          />
          <TextInput
            autoCapitalize="none"
            onChangeText={setVendorLocationId}
            placeholder="Vendor location UUID"
            style={styles.catalogueInput}
            value={vendorLocationId}
          />
          <Pressable onPress={loadRemoteProducts} style={styles.catalogueButton}>
            <Text style={styles.catalogueButtonText}>Load server catalogue</Text>
          </Pressable>
          <Text style={styles.catalogueHint}>{remoteMessage}</Text>
          {remoteProducts[0] && (
            <Pressable onPress={toggleRemoteProduct} style={styles.catalogueButton}>
              <Text style={styles.catalogueButtonText}>
                {remoteProducts[0].lifecycle_state === 'ACTIVE'
                  ? `Deactivate ${remoteProducts[0].title}`
                  : `Activate ${remoteProducts[0].title}`}
              </Text>
            </Pressable>
          )}
          <View style={styles.catalogueActions}>
            <Pressable
              onPress={() => setCatalogueActive((current) => !current)}
              style={styles.catalogueButton}
            >
              <Text style={styles.catalogueButtonText}>
                {catalogueActive ? 'Deactivate listing' : 'Activate listing'}
              </Text>
            </Pressable>
            <Pressable
              onPress={() => setVariableWeight((current) => !current)}
              style={styles.catalogueButton}
            >
              <Text style={styles.catalogueButtonText}>
                {variableWeight ? 'Weight variance: 500 bps' : 'Set variable weight'}
              </Text>
            </Pressable>
            <Pressable
              onPress={() => setReplacementAllowed((current) => !current)}
              style={styles.catalogueButton}
            >
              <Text style={styles.catalogueButtonText}>
                {replacementAllowed ? 'Replacement allowed' : 'Allow substitution'}
              </Text>
            </Pressable>
          </View>
          <Text style={styles.catalogueHint}>
            SYNTH image object reference · same-store replacements only.
          </Text>
        </View>
        <View style={styles.moneyStrip} accessibilityLabel="Synthetic settlement summary">
          <Text style={styles.moneyLabel}>NET PAYABLE · ELIGIBLE IN 23H 59M</Text>
          <Text style={styles.moneyValue}>₹235.00</Text>
          <Text style={styles.moneyBody}>Items ₹240.00 · completed-order fee − ₹5.00</Text>
        </View>
        <Text style={styles.boundary}>
          Company test mode: synthetic inventory only. No production catalogue, checkout or order
          authority.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function Movement({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <View style={styles.movementCell}>
      <Text style={styles.movementLabel}>{label}</Text>
      <Text style={styles.movementValue}>{value}</Text>
    </View>
  );
}
function StateDot({ label }: { readonly label: string }) {
  return (
    <View style={styles.stateCell}>
      <View style={styles.stateLine}>
        <View style={styles.stateDot} />
      </View>
      <Text style={styles.stateLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  catalogueCard: {
    marginTop: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  catalogueTitle: { marginTop: 5, color: colors.ink, fontSize: 20, fontWeight: '800' },
  catalogueText: { marginTop: 7, color: colors.muted, fontSize: 13, lineHeight: 19 },
  catalogueInput: {
    marginTop: 10,
    padding: 10,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: '#fff',
    color: colors.ink,
  },
  catalogueActions: { marginTop: 14, gap: 8 },
  catalogueButton: {
    padding: 11,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: '#ffffff',
  },
  catalogueButtonText: { color: colors.ink, fontSize: 13, fontWeight: '700' },
  catalogueHint: { marginTop: 12, color: colors.muted, fontSize: 11, lineHeight: 16 },
  moneyStrip: {
    marginTop: 16,
    padding: 18,
    borderLeftWidth: 5,
    borderLeftColor: '#1f6846',
    backgroundColor: '#ffffff',
  },
  moneyLabel: { color: '#667068', fontSize: 10, fontWeight: '700', letterSpacing: 0.6 },
  moneyValue: { marginTop: 7, color: '#17211b', fontSize: 28, fontWeight: '800' },
  moneyBody: { marginTop: 5, color: '#667068', fontSize: 12 },
  safe: { flex: 1, backgroundColor: colors.canvas },
  shell: { flexGrow: 1, padding: 16, paddingTop: 28, paddingBottom: 44 },
  masthead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingBottom: 18,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  mastheadCopy: { flex: 1 },
  roleMark: {
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderTopLeftRadius: 21,
    borderTopRightRadius: 21,
    borderBottomRightRadius: 21,
    borderBottomLeftRadius: 9,
    backgroundColor: colors.evergreen,
  },
  roleMarkText: { color: colors.surface, fontSize: 12, fontWeight: '800' },
  eyebrow: { color: colors.evergreen, fontSize: 8, fontWeight: '800', letterSpacing: 0.7 },
  productName: { marginTop: 3, color: colors.ink, fontSize: 14, fontWeight: '700' },
  testChip: {
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: '#d6bd56',
    borderRadius: 12,
    backgroundColor: colors.warningTint,
  },
  testChipText: { color: '#654c00', fontSize: 8, fontWeight: '800' },
  intro: { paddingTop: 38, paddingBottom: 24 },
  kicker: { color: colors.evergreen, fontSize: 9, fontWeight: '800', letterSpacing: 1 },
  title: {
    marginTop: 9,
    color: colors.ink,
    fontSize: 39,
    fontWeight: '800',
    letterSpacing: -1.8,
    lineHeight: 39,
  },
  summary: { marginTop: 12, color: colors.muted, fontSize: 14, lineHeight: 21 },
  totals: {
    flexDirection: 'row',
    marginTop: 22,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  totalCell: { flex: 1, padding: 14, borderRightWidth: 1, borderRightColor: colors.line },
  totalLabel: { color: colors.muted, fontSize: 8 },
  totalValue: { marginTop: 5, color: colors.ink, fontSize: 27, fontWeight: '800' },
  filters: { gap: 8, paddingBottom: 16 },
  filter: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 22 },
  filterActive: { backgroundColor: colors.evergreen },
  filterText: { color: colors.muted, fontSize: 11, fontWeight: '700' },
  filterTextActive: { color: colors.surface },
  itemRail: { gap: 10, paddingBottom: 16 },
  itemCard: {
    width: 176,
    padding: 15,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  itemCardActive: { borderColor: colors.evergreen, borderBottomWidth: 4 },
  itemHeader: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  signal: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.evergreen },
  signalWarning: { backgroundColor: colors.warning },
  itemBasis: { color: colors.muted, fontSize: 8, fontWeight: '800' },
  itemName: { minHeight: 36, marginTop: 10, color: colors.ink, fontSize: 14, fontWeight: '700' },
  itemReference: { marginTop: 5, color: colors.muted, fontSize: 8 },
  itemQuantity: { marginTop: 16, color: colors.ink, fontSize: 28, fontWeight: '800' },
  itemQuantityLabel: { color: colors.muted, fontSize: 9 },
  sheet: { padding: 18, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  reference: { color: colors.evergreen, fontSize: 9, fontWeight: '800', letterSpacing: 0.7 },
  sheetTitle: {
    marginTop: 7,
    color: colors.ink,
    fontSize: 27,
    fontWeight: '800',
    letterSpacing: -1,
  },
  basisChip: {
    alignSelf: 'flex-start',
    marginTop: 11,
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: '#a8c7b1',
    backgroundColor: colors.greenTint,
  },
  basisWarning: { borderColor: '#d6bd56', backgroundColor: colors.warningTint },
  basisText: { color: colors.evergreen, fontSize: 9, fontWeight: '800' },
  basisWarningText: { color: '#654c00' },
  movement: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 20,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderColor: colors.line,
  },
  movementCell: {
    width: '50%',
    padding: 14,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.line,
  },
  movementLabel: { color: colors.muted, fontSize: 8, textTransform: 'uppercase' },
  movementValue: { marginTop: 6, color: colors.ink, fontSize: 25, fontWeight: '800' },
  truthNote: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 20,
    padding: 15,
    borderLeftWidth: 4,
    borderLeftColor: colors.evergreen,
    backgroundColor: colors.greenTint,
  },
  truthMark: {
    width: 34,
    height: 34,
    paddingTop: 3,
    borderRadius: 17,
    overflow: 'hidden',
    backgroundColor: colors.evergreen,
    color: colors.surface,
    fontSize: 21,
    fontWeight: '800',
    textAlign: 'center',
  },
  truthCopy: { flex: 1 },
  truthTitle: { color: colors.ink, fontSize: 13, fontWeight: '800' },
  truthBody: { marginTop: 4, color: colors.muted, fontSize: 11, lineHeight: 17 },
  confirmRow: {
    gap: 13,
    marginTop: 20,
    paddingBottom: 20,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  confirmLabel: { color: colors.muted, fontSize: 8 },
  confirmValue: { marginTop: 3, color: colors.ink, fontSize: 11, fontWeight: '700' },
  confirmButton: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
    borderRadius: 8,
    backgroundColor: colors.evergreen,
  },
  confirmButtonText: { color: colors.surface, fontSize: 11, fontWeight: '800' },
  contract: { flexDirection: 'row', marginTop: 21 },
  stateCell: { flex: 1, alignItems: 'center' },
  stateLine: {
    width: '100%',
    height: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  stateDot: {
    width: 9,
    height: 9,
    marginTop: -11,
    borderRadius: 5,
    backgroundColor: colors.evergreen,
  },
  stateLabel: { color: colors.muted, fontSize: 8, fontWeight: '700', textAlign: 'center' },
  expiry: { marginTop: 10, color: colors.muted, fontSize: 8, textAlign: 'center' },
  boundary: {
    marginTop: 18,
    color: colors.muted,
    fontSize: 9,
    lineHeight: 14,
    textAlign: 'center',
  },
});

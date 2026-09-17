'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type {
  Cart,
  CartLine,
  FulfilmentMethod,
  SubstitutionPreference,
} from '@neighbourhood-store/contracts';
import { customerApiClient, readCustomerSession } from './customer-session';
import {
  clearGuestCart,
  GUEST_CART_EVENT,
  guestItemCount,
  guestSubtotalMinor,
  readGuestCart,
  setGuestQuantity,
  type GuestCartLine,
} from './guest-cart';

export type CartState = {
  readonly cart: Cart | null;
  readonly busyVariantIds: ReadonlySet<string>;
  readonly error: string | null;
  readonly itemCount: number;
  /** Null when any line is unpriced — see the read model's `subtotal_minor`. */
  readonly totalMinor: number | null;
  readonly quantityOf: (catalogueVariantId: string) => number;
  readonly setQuantity: (input: {
    readonly vendorLocationId: string;
    readonly catalogueVariantId: string;
    readonly quantity: number;
    readonly fulfilmentMethod?: FulfilmentMethod;
    readonly substitutionPreference?: SubstitutionPreference;
    /** Snapshot for the pre-sign-in basket, which has no server cart to read. */
    readonly title?: string;
    readonly priceMinor?: number | null;
  }) => Promise<void>;
  readonly setSubstitutionPreference: (
    line: CartLine,
    preference: SubstitutionPreference,
  ) => Promise<void>;
  readonly setGroupFulfilment: (input: {
    readonly groupId: string;
    readonly expectedVersion: number;
    readonly fulfilmentMethod: FulfilmentMethod;
    readonly customerNote?: string | null;
  }) => Promise<void>;
  readonly refresh: () => Promise<void>;
  readonly revalidate: () => Promise<{ readonly changed: boolean }>;
};

const CartContext = createContext<CartState | null>(null);

function lineFor(cart: Cart | null, catalogueVariantId: string): CartLine | null {
  if (!cart) return null;
  for (const group of cart.groups) {
    for (const line of group.lines) {
      if (line.catalogue_variant_id === catalogueVariantId && line.lifecycle_state !== 'REMOVED') {
        return line;
      }
    }
  }
  return null;
}

/**
 * One live cart for the whole app.
 *
 * Previously the marketplace screen and the checkout screen each fetched and
 * held their own copy, so adding an item on one did not update the other, and
 * the cart page only loaded at all when the customer pressed "Load my active
 * cart". A basket is a single piece of state the shopper carries between
 * screens, so it is held once and every mutation adopts the server's returned
 * cart as the new truth rather than patching a local guess.
 */
export function CartProvider({ children }: { readonly children: ReactNode }) {
  const [cart, setCart] = useState<Cart | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  // Guards against an older in-flight response overwriting a newer one when a
  // shopper taps + several times quickly.
  const sequence = useRef(0);
  const [guestLines, setGuestLines] = useState<readonly GuestCartLine[]>([]);
  const [signedIn, setSignedIn] = useState(false);

  const markBusy = useCallback((id: string, value: boolean) => {
    setBusy((current) => {
      const next = new Set(current);
      if (value) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const adopt = useCallback((next: Cart, ticket: number) => {
    if (ticket < sequence.current) return;
    sequence.current = ticket;
    setCart(next);
    setError(null);
  }, []);

  /**
   * Attaches the customer's selected address to the cart when it has none.
   *
   * Quoting refuses a cart without an address — correctly, since delivery fee,
   * service zone and eligibility are all computed against it — and nothing was
   * attaching one, so every checkout failed at the quote step. The address is
   * the session's selected one, so this reconciles rather than asks.
   */
  const ensureAddress = useCallback(async (current: Cart): Promise<Cart> => {
    if (current.customer_address_id !== null) return current;
    const client = await customerApiClient();
    const addresses = await client.addresses.list();
    const selected =
      addresses.addresses.find((address) => address.is_selected) ?? addresses.addresses[0];
    if (!selected) return current;
    return client.cart.setAddress({ customer_address_id: selected.customer_address_id });
  }, []);

  const refresh = useCallback(async () => {
    if (!readCustomerSession()) return;
    const ticket = ++sequence.current;
    try {
      const client = await customerApiClient();
      const loaded = await client.cart.current();
      adopt(loaded.groups.length > 0 ? await ensureAddress(loaded) : loaded, ticket);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Your basket could not be loaded.');
    }
  }, [adopt, ensureAddress]);

  const setQuantity = useCallback<CartState['setQuantity']>(
    async (input) => {
      // No session yet: the basket fills locally and is replayed at sign-in.
      // Nothing is reserved, which is what a cart is allowed to do (EXC-11).
      if (!readCustomerSession()) {
        setGuestQuantity({
          catalogue_variant_id: input.catalogueVariantId,
          price_minor: input.priceMinor ?? null,
          quantity: input.quantity,
          title: input.title ?? 'Item',
          vendor_location_id: input.vendorLocationId,
        });
        return;
      }
      markBusy(input.catalogueVariantId, true);
      const ticket = ++sequence.current;
      try {
        const client = await customerApiClient();
        const existing = lineFor(cart, input.catalogueVariantId);
        if (!existing) {
          if (input.quantity <= 0) return;
          const withLine = await client.cart.addLine({
            vendor_location_id: input.vendorLocationId,
            catalogue_variant_id: input.catalogueVariantId,
            quantity: input.quantity,
            ...(input.fulfilmentMethod ? { fulfilment_method: input.fulfilmentMethod } : {}),
            ...(input.substitutionPreference
              ? { substitution_preference: input.substitutionPreference }
              : {}),
          });
          adopt(await ensureAddress(withLine), ticket);
          return;
        }
        if (input.quantity <= 0) {
          adopt(await client.cart.removeLine(existing.cart_line_id), ticket);
          return;
        }
        adopt(
          await client.cart.setQuantity(existing.cart_line_id, {
            expected_version: existing.version,
            quantity: input.quantity,
          }),
          ticket,
        );
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Your basket could not be updated.');
        // A rejected optimistic-version write means someone else moved the
        // line; re-reading is the only way back to a state worth showing.
        await refresh();
      } finally {
        markBusy(input.catalogueVariantId, false);
      }
    },
    [adopt, cart, ensureAddress, markBusy, refresh],
  );

  const setSubstitutionPreference = useCallback<CartState['setSubstitutionPreference']>(
    async (line, preference) => {
      markBusy(line.catalogue_variant_id, true);
      const ticket = ++sequence.current;
      try {
        const client = await customerApiClient();
        adopt(
          await client.cart.setQuantity(line.cart_line_id, {
            expected_version: line.version,
            quantity: line.quantity,
            substitution_preference: preference,
          }),
          ticket,
        );
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'That preference could not be saved.');
        await refresh();
      } finally {
        markBusy(line.catalogue_variant_id, false);
      }
    },
    [adopt, markBusy, refresh],
  );

  const setGroupFulfilment = useCallback<CartState['setGroupFulfilment']>(
    async (input) => {
      const ticket = ++sequence.current;
      try {
        const client = await customerApiClient();
        adopt(
          await client.cart.setGroupFulfilmentMethod(input.groupId, {
            expected_version: input.expectedVersion,
            fulfilment_method: input.fulfilmentMethod,
            ...(input.customerNote === undefined ? {} : { customer_note: input.customerNote }),
          }),
          ticket,
        );
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'That store group could not be updated.');
        await refresh();
      }
    },
    [adopt, refresh],
  );

  const revalidate = useCallback(async () => {
    try {
      const client = await customerApiClient();
      const outcome = await client.cart.revalidate();
      await refresh();
      return { changed: outcome.outcomes.some((entry) => entry.invalidated) };
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Your basket could not be rechecked.');
      return { changed: false };
    }
  }, [refresh]);

  useEffect(() => {
    void refresh();
    // The basket is server-held, so a reconnect restores the confirmed state
    // rather than replaying whatever the tab happened to remember (UX-10).
    const onOnline = () => void refresh();
    const onSession = () => void refresh();
    const onAddressChanged = () => {
      void (async () => {
        try {
          const client = await customerApiClient();
          const addresses = await client.addresses.list();
          const selected = addresses.addresses.find((address) => address.is_selected);
          if (selected) {
            adopt(
              await client.cart.setAddress({ customer_address_id: selected.customer_address_id }),
              ++sequence.current,
            );
          }
        } catch {
          await refresh();
        }
      })();
    };
    window.addEventListener('online', onOnline);
    window.addEventListener('neighbourhood:customer-session', onSession);
    window.addEventListener('neighbourhood:customer-address', onAddressChanged);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('neighbourhood:customer-session', onSession);
      window.removeEventListener('neighbourhood:customer-address', onAddressChanged);
    };
  }, [adopt, refresh]);

  /**
   * Moves a pre-sign-in basket onto the server, once.
   *
   * Replayed line by line through the same `addLine` the signed-in path uses,
   * so the server applies its own availability, group-limit and eligibility
   * rules rather than trusting anything the browser stored. The local copy is
   * cleared only after the replay, so a failure mid-way leaves the basket to
   * try again instead of silently losing it.
   */
  const mergeGuestCart = useCallback(async () => {
    const pending = readGuestCart();
    if (pending.length === 0) return;
    try {
      const client = await customerApiClient();
      for (const line of pending) {
        await client.cart.addLine({
          vendor_location_id: line.vendor_location_id,
          catalogue_variant_id: line.catalogue_variant_id,
          quantity: line.quantity,
        });
      }
      clearGuestCart();
      setGuestLines([]);
      await refresh();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Some items from your basket could not be carried over.',
      );
    }
  }, [refresh]);

  useEffect(() => {
    const sync = () => {
      const nowSignedIn = readCustomerSession() !== null;
      setSignedIn(nowSignedIn);
      setGuestLines(readGuestCart());
      if (nowSignedIn) void mergeGuestCart();
    };
    sync();
    window.addEventListener('neighbourhood:customer-session', sync);
    window.addEventListener(GUEST_CART_EVENT, sync);
    return () => {
      window.removeEventListener('neighbourhood:customer-session', sync);
      window.removeEventListener(GUEST_CART_EVENT, sync);
    };
  }, [mergeGuestCart]);

  const value = useMemo<CartState>(() => {
    if (!signedIn) {
      const quantities = new Map(
        guestLines.map((line) => [line.catalogue_variant_id, line.quantity]),
      );
      return {
        cart: null,
        busyVariantIds: busy,
        error,
        itemCount: guestItemCount(guestLines),
        totalMinor: guestSubtotalMinor(guestLines),
        quantityOf: (catalogueVariantId) => quantities.get(catalogueVariantId) ?? 0,
        setQuantity,
        setSubstitutionPreference,
        setGroupFulfilment,
        refresh,
        revalidate,
      };
    }
    const groups = cart?.groups ?? [];
    const lines = groups.flatMap((group) => group.lines);
    const anyUnpriced = groups.some((group) => group.subtotal_minor === null);
    return {
      cart,
      busyVariantIds: busy,
      error,
      itemCount: lines.reduce((sum, line) => sum + line.quantity, 0),
      totalMinor: anyUnpriced
        ? null
        : groups.reduce((sum, group) => sum + (group.subtotal_minor ?? 0), 0),
      quantityOf: (catalogueVariantId) => lineFor(cart, catalogueVariantId)?.quantity ?? 0,
      setQuantity,
      setSubstitutionPreference,
      setGroupFulfilment,
      refresh,
      revalidate,
    };
  }, [
    busy,
    cart,
    error,
    guestLines,
    refresh,
    revalidate,
    setGroupFulfilment,
    setQuantity,
    setSubstitutionPreference,
    signedIn,
  ]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartState {
  const value = useContext(CartContext);
  if (!value) throw new Error('useCart must be used inside a CartProvider');
  return value;
}

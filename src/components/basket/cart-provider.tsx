"use client";

import { createContext, useCallback, useContext, useEffect, useOptimistic, useRef, useState, useTransition } from "react";
import {
  addManyToBasket,
  addToBasket,
  loadBasket,
  reorderToBasket,
  removeBox as removeBoxAction,
  removeUnavailableItems,
  saveBox as saveBoxAction,
  setBasketQuantities,
  setBasketQuantity,
} from "@/app/basket-actions";
import type { BasketSnapshot } from "@/lib/basket-types";
import { track } from "@/lib/track";

/**
 * Basket state for the storefront: the menu badge, the drawer, and every
 * add-to-basket control. The server owns prices, stock and offers; this holds
 * the last snapshot it returned and applies optimistic changes (useOptimistic)
 * so a tap feels instant, then settles on the server's answer.
 */

interface State {
  count: number;
  basket: BasketSnapshot | null;
}

type Optimistic = { type: "add"; quantity: number } | { type: "set"; changes: readonly { itemId: string; quantity: number }[] };

interface CartContextValue {
  count: number;
  basket: BasketSnapshot | null;
  isOpen: boolean;
  pending: boolean;
  error: string | null;
  openBasket: () => void;
  closeBasket: () => void;
  /** Resolves true when the server accepted the add. Opens the drawer unless `open` is false. */
  add: (productId: string, quantity: number, options?: { open?: boolean; via?: "card" }) => Promise<boolean>;
  /** One of each, for a combo. Resolves true when all went in. */
  addMany: (productIds: string[]) => Promise<boolean>;
  /** A past order's products, back in the basket. Resolves true when all went in. */
  reorder: (orderNumber: string, token: string | null) => Promise<boolean>;
  setQuantity: (itemId: string, quantity: number) => Promise<void>;
  /** Several lines at once: a kit's products move together. */
  setQuantities: (changes: { itemId: string; quantity: number }[]) => Promise<void>;
  /** Drop what can't ship, trim what partly can. */
  removeUnavailable: () => Promise<void>;
  /** A finished box (Make Your Own Box), new or replacing one being edited. Resolves true when it went in. */
  saveBox: (input: { boxId: string; picks: { productId: string; quantity: number }[]; replaceCartBoxId?: string }) => Promise<boolean>;
  removeBox: (cartBoxId: string) => Promise<void>;
  refresh: () => Promise<void>;
}

const CartContext = createContext<CartContextValue | null>(null);

function applyOptimistic(state: State, change: Optimistic): State {
  if (change.type === "add") return { ...state, count: state.count + change.quantity };
  if (!state.basket) return state;
  const next = new Map(change.changes.map((c) => [c.itemId, c.quantity]));
  // A kit counts once, so only units outside kits move the badge here; the
  // server's answer settles kit counts a moment later.
  const delta = state.basket.lines.reduce(
    (n, l) => n + (next.has(l.itemId) && l.kitUnits === 0 ? next.get(l.itemId)! - l.quantity : 0),
    0,
  );
  const lines = state.basket.lines
    .map((l) => (next.has(l.itemId) ? { ...l, quantity: next.get(l.itemId)! } : l))
    .filter((l) => l.quantity > 0);
  const count = Math.max(0, state.count + delta);
  return { count, basket: { ...state.basket, lines, count } };
}

export function CartProvider({ initialCount, children }: { initialCount: number; children: React.ReactNode }) {
  const [state, setState] = useState<State>({ count: initialCount, basket: null });
  const [optimistic, addOptimistic] = useOptimistic(state, applyOptimistic);
  const [isOpen, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Offers already reported this page view, so each is tracked once.
  const seen = useRef(new Set<string>());
  const previous = useRef<BasketSnapshot | null>(null);

  const accept = useCallback((basket: BasketSnapshot) => {
    const before = previous.current;
    if (before) {
      for (const offer of basket.appliedOffers) {
        if (!before.appliedOffers.some((o) => o.id === offer.id)) track({ type: "OFFER_APPLIED", offer: "bundle", offerId: offer.id });
      }
      if (!before.freeDelivery.qualified && basket.freeDelivery.qualified && basket.count > 0) {
        track({ type: "OFFER_APPLIED", offer: "free_delivery" });
      }
    }
    previous.current = basket;
    setState({ count: basket.count, basket });
  }, []);

  const refresh = useCallback(async () => {
    const result = await loadBasket();
    if (result.ok) accept(result.basket);
  }, [accept]);

  // Other tabs of this site: a change here tells them, and a tab coming back
  // into view re-reads the basket, so no tab shows a stale count or total.
  // (Checkout re-prices on the server regardless; this is about what's shown.)
  const channel = useRef<BroadcastChannel | null>(null);
  const lastLoad = useRef(0);
  useEffect(() => {
    const reload = () => {
      lastLoad.current = Date.now();
      void refresh();
    };
    try {
      channel.current = new BroadcastChannel("soulone-basket");
      channel.current.onmessage = reload;
    } catch {
      channel.current = null; // older browsers: the focus check below still covers it
    }
    const onVisible = () => {
      if (document.visibilityState === "visible" && Date.now() - lastLoad.current > 5000) reload();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      channel.current?.close();
    };
  }, [refresh]);
  /** After this tab changed the basket: let the others know. */
  const announce = useCallback(() => {
    try {
      channel.current?.postMessage("changed");
    } catch {}
  }, []);

  const openBasket = useCallback(() => {
    setOpen(true);
    setError(null);
    track({ type: "CART_OPENED" });
    startTransition(async () => {
      const result = await loadBasket();
      if (result.ok) accept(result.basket);
      else setError(result.message);
    });
  }, [accept]);

  const closeBasket = useCallback(() => setOpen(false), []);

  const add = useCallback(
    (productId: string, quantity: number, options?: { open?: boolean; via?: "card" }) =>
      new Promise<boolean>((resolve) => {
        setError(null);
        // Open straight away: the tap should answer instantly, not after the
        // server round trip. The badge updates optimistically meanwhile.
        if (options?.open !== false) {
          setOpen(true);
          track({ type: "CART_OPENED" });
        }
        startTransition(async () => {
          addOptimistic({ type: "add", quantity });
          const result = await addToBasket(productId, quantity, options?.via);
          if (result.ok) {
            accept(result.basket);
            announce();
          } else {
            setError(result.message);
            if (result.basket) accept(result.basket);
          }
          resolve(result.ok);
        });
      }),
    [accept, addOptimistic, announce],
  );

  const addMany = useCallback(
    (productIds: string[]) =>
      new Promise<boolean>((resolve) => {
        setError(null);
        setOpen(true);
        track({ type: "CART_OPENED" });
        startTransition(async () => {
          // A kit's products go in together and count as one item.
          addOptimistic({ type: "add", quantity: 1 });
          const result = await addManyToBasket(productIds);
          if (result.ok) (accept(result.basket), announce());
          else {
            setError(result.message);
            if (result.basket) accept(result.basket);
          }
          resolve(result.ok);
        });
      }),
    [accept, addOptimistic, announce],
  );

  const reorder = useCallback(
    (orderNumber: string, token: string | null) =>
      new Promise<boolean>((resolve) => {
        setError(null);
        setOpen(true);
        track({ type: "CART_OPENED" });
        startTransition(async () => {
          const result = await reorderToBasket(orderNumber, token);
          if (result.ok) (accept(result.basket), announce());
          else {
            setError(result.message);
            if (result.basket) (accept(result.basket), announce());
          }
          resolve(result.ok);
        });
      }),
    [accept, announce],
  );

  const setQuantity = useCallback(
    (itemId: string, quantity: number) =>
      new Promise<void>((resolve) => {
        setError(null);
        startTransition(async () => {
          addOptimistic({ type: "set", changes: [{ itemId, quantity }] });
          const result = await setBasketQuantity(itemId, quantity);
          if (result.ok) (accept(result.basket), announce());
          else setError(result.message);
          resolve();
        });
      }),
    [accept, addOptimistic, announce],
  );

  const setQuantities = useCallback(
    (changes: { itemId: string; quantity: number }[]) =>
      new Promise<void>((resolve) => {
        setError(null);
        startTransition(async () => {
          addOptimistic({ type: "set", changes });
          const result = await setBasketQuantities(changes);
          if (result.ok) (accept(result.basket), announce());
          else setError(result.message);
          resolve();
        });
      }),
    [accept, addOptimistic, announce],
  );

  const removeUnavailable = useCallback(
    () =>
      new Promise<void>((resolve) => {
        setError(null);
        startTransition(async () => {
          const result = await removeUnavailableItems();
          if (result.ok) (accept(result.basket), announce());
          else setError(result.message);
          resolve();
        });
      }),
    [accept, announce],
  );

  const saveBox = useCallback(
    (input: { boxId: string; picks: { productId: string; quantity: number }[]; replaceCartBoxId?: string }) =>
      new Promise<boolean>((resolve) => {
        setError(null);
        setOpen(true);
        track({ type: "CART_OPENED" });
        startTransition(async () => {
          // A box counts as one item, and an edited box replaces itself.
          if (!input.replaceCartBoxId) addOptimistic({ type: "add", quantity: 1 });
          const result = await saveBoxAction(input);
          if (result.ok) (accept(result.basket), announce());
          else {
            setError(result.message);
            if (result.basket) accept(result.basket);
          }
          resolve(result.ok);
        });
      }),
    [accept, addOptimistic, announce],
  );

  const removeBox = useCallback(
    (cartBoxId: string) =>
      new Promise<void>((resolve) => {
        setError(null);
        startTransition(async () => {
          const result = await removeBoxAction(cartBoxId);
          if (result.ok) (accept(result.basket), announce());
          else setError(result.message);
          resolve();
        });
      }),
    [accept, announce],
  );

  // Report the prompts the shopper actually saw, once each per page view.
  useEffect(() => {
    const b = state.basket;
    if (!isOpen || !b || b.count === 0) return;
    if (!b.freeDelivery.qualified && !seen.current.has("free_delivery")) {
      seen.current.add("free_delivery");
      track({ type: "OFFER_SHOWN", offer: "free_delivery" });
    }
    if (b.nextOffer && !seen.current.has(b.nextOffer.bundleId)) {
      seen.current.add(b.nextOffer.bundleId);
      track({ type: "OFFER_SHOWN", offer: "bundle", offerId: b.nextOffer.bundleId });
    }
  }, [isOpen, state.basket]);

  return (
    <CartContext.Provider
      value={{
        count: optimistic.count,
        basket: optimistic.basket,
        isOpen,
        pending,
        error,
        openBasket,
        closeBasket,
        add,
        addMany,
        reorder,
        setQuantity,
        setQuantities,
        removeUnavailable,
        saveBox,
        removeBox,
        refresh,
      }}
    >
      {children}
    </CartContext.Provider>
  );
}

export function useCart(): CartContextValue {
  const value = useContext(CartContext);
  if (!value) throw new Error("useCart must be used inside <CartProvider>.");
  return value;
}

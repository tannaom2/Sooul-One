"use client";

import { createContext, useCallback, useContext, useEffect, useOptimistic, useRef, useState, useTransition } from "react";
import { addManyToBasket, addToBasket, loadBasket, removeUnavailableItems, setBasketQuantity } from "@/app/basket-actions";
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

type Optimistic = { type: "add"; quantity: number } | { type: "set"; itemId: string; quantity: number };

interface CartContextValue {
  count: number;
  basket: BasketSnapshot | null;
  isOpen: boolean;
  pending: boolean;
  error: string | null;
  openBasket: () => void;
  closeBasket: () => void;
  /** Resolves true when the server accepted the add. */
  add: (productId: string, quantity: number) => Promise<boolean>;
  /** One of each, for a combo. Resolves true when all went in. */
  addMany: (productIds: string[]) => Promise<boolean>;
  setQuantity: (itemId: string, quantity: number) => Promise<void>;
  /** Drop what can't ship, trim what partly can. */
  removeUnavailable: () => Promise<void>;
  refresh: () => Promise<void>;
}

const CartContext = createContext<CartContextValue | null>(null);

function applyOptimistic(state: State, change: Optimistic): State {
  if (change.type === "add") return { ...state, count: state.count + change.quantity };
  if (!state.basket) return state;
  const lines = state.basket.lines
    .map((l) => (l.itemId === change.itemId ? { ...l, quantity: change.quantity } : l))
    .filter((l) => l.quantity > 0);
  const count = lines.reduce((n, l) => n + l.quantity, 0);
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
    (productId: string, quantity: number) =>
      new Promise<boolean>((resolve) => {
        setError(null);
        // Open straight away: the tap should answer instantly, not after the
        // server round trip. The badge updates optimistically meanwhile.
        setOpen(true);
        track({ type: "CART_OPENED" });
        startTransition(async () => {
          addOptimistic({ type: "add", quantity });
          const result = await addToBasket(productId, quantity);
          if (result.ok) {
            accept(result.basket);
          } else {
            setError(result.message);
            if (result.basket) accept(result.basket);
          }
          resolve(result.ok);
        });
      }),
    [accept, addOptimistic],
  );

  const addMany = useCallback(
    (productIds: string[]) =>
      new Promise<boolean>((resolve) => {
        setError(null);
        setOpen(true);
        track({ type: "CART_OPENED" });
        startTransition(async () => {
          addOptimistic({ type: "add", quantity: productIds.length });
          const result = await addManyToBasket(productIds);
          if (result.ok) accept(result.basket);
          else {
            setError(result.message);
            if (result.basket) accept(result.basket);
          }
          resolve(result.ok);
        });
      }),
    [accept, addOptimistic],
  );

  const setQuantity = useCallback(
    (itemId: string, quantity: number) =>
      new Promise<void>((resolve) => {
        setError(null);
        startTransition(async () => {
          addOptimistic({ type: "set", itemId, quantity });
          const result = await setBasketQuantity(itemId, quantity);
          if (result.ok) accept(result.basket);
          else setError(result.message);
          resolve();
        });
      }),
    [accept, addOptimistic],
  );

  const removeUnavailable = useCallback(
    () =>
      new Promise<void>((resolve) => {
        setError(null);
        startTransition(async () => {
          const result = await removeUnavailableItems();
          if (result.ok) accept(result.basket);
          else setError(result.message);
          resolve();
        });
      }),
    [accept],
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
        setQuantity,
        removeUnavailable,
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

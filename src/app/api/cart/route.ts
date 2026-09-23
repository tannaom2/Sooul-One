import { NextResponse } from "next/server";
import { z } from "zod";
import { addToCart, getOrCreateSessionId, quoteCart, updateQuantity } from "@/server/cart";
import { recordEvent } from "@/lib/analytics";

const addSchema = z.object({
  productId: z.string().min(1),
  quantity: z.number().int().min(1).max(20),
});

const updateSchema = z.object({
  itemId: z.string().min(1),
  quantity: z.number().int().min(0).max(20),
});

export async function POST(request: Request) {
  const parsed = addSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ message: "Check the product and quantity." }, { status: 400 });
  }

  const sessionId = await getOrCreateSessionId();
  try {
    await addToCart(sessionId, parsed.data.productId, parsed.data.quantity);
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "That didn't save." },
      { status: 400 },
    );
  }

  void recordEvent(sessionId, "ADD_TO_CART", {
    productId: parsed.data.productId,
    metadata: { quantity: parsed.data.quantity },
  });

  const result = await quoteCart(sessionId);
  return NextResponse.json({ ok: true, itemCount: result?.cartItems.length ?? 0 });
}

export async function PATCH(request: Request) {
  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ message: "Check the item and quantity." }, { status: 400 });
  }

  const sessionId = await getOrCreateSessionId();
  await updateQuantity(sessionId, parsed.data.itemId, parsed.data.quantity);
  return NextResponse.json({ ok: true });
}

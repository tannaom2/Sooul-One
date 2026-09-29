import { NextResponse, after } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { limitPublic, overLimit } from "@/server/rate-limit";
import { readSessionId } from "@/server/cart";
import { recordEvent } from "@/lib/analytics";
import { reportError } from "@/lib/observability";
import { orderProgress } from "@/lib/order-progress";
import { DEFAULT_SHIPPING_POLICY } from "@/lib/checkout/quote";
import { estimateDeliveryDate, zoneForPincode } from "@/lib/checkout/delivery";
import { OUTSIDE_AREA_MESSAGE, SERVICE_AREA, isServiceable } from "@/lib/checkout/service-area";
import { lookupPincode } from "@/server/pincode";
import { codForCheckout, extraDeliveryDays, getCodSettings } from "@/server/intel";
import { getCheckoutState, getStoreControls } from "@/server/store-settings";
import { getBusinessProfile } from "@/server/business";
import { getAssistantSettings } from "@/server/assistant-settings";
import { codRequiresCode } from "@/server/customer-auth";
import {
  MENU,
  classifyMessage,
  findOrderNumber,
  findPincode,
  parseContact,
  reply,
  returnVerdict,
  whatsappLink,
  type BotBlock,
  type BotReply,
  type BotState,
  type Intent,
} from "@/lib/assistant";

export const runtime = "nodejs";

/**
 * The storefront assistant (src/components/storefront-bot.tsx). Stateless:
 * the widget sends back the flow it's in. Every answer is either a fact the
 * store holds or the owner's own words (src/lib/assistant.ts); where the
 * store doesn't know, it hands over to a person.
 *
 * Order lookups need the order number AND the mobile or email on it, reveal
 * only the delivery timeline (no address, no items), give the same answer
 * for a wrong number and a wrong contact, and are capped per connection and
 * per order number, so guessing is slow and tells nothing.
 */

const INTENTS = ["menu", "track", "pincode", "returns", "shipping", "payment", "cod", "area", "contact", "human", "unknown"] as const;

const schema = z.object({
  intent: z.enum(INTENTS).optional(),
  text: z.string().max(500).optional(),
  state: z
    .object({
      flow: z.enum(["track", "returns", "pincode"]).nullable(),
      orderNumber: z.string().regex(/^SO-[A-Z0-9]{6,10}-[A-Z0-9]{2}$/).optional(),
    })
    .optional(),
});

const NOT_FOUND = "I couldn't find an order with those details. Check the order number (it's in your confirmation email, like SO-XXXXXXXX-XX) and the mobile number or email you ordered with.";

const rupees = (paise: number) => `₹${Math.round(paise / 100).toLocaleString("en-IN")}`;

async function handoff(topic: string, orderNumber?: string): Promise<BotBlock> {
  const [business, settings] = await Promise.all([getBusinessProfile(), getAssistantSettings()]);
  return {
    type: "handoff",
    whatsapp: whatsappLink(settings.supportWhatsapp, orderNumber, topic),
    email: business.customerCareEmail,
    phone: business.customerCarePhone,
  };
}

async function pincodeAnswer(pin: string): Promise<BotReply> {
  const [extra, place] = await Promise.all([extraDeliveryDays(pin), lookupPincode(pin).catch(() => undefined)]);
  const serviceable = isServiceable(pin, place?.state ?? SERVICE_AREA.label, place?.state);
  const [controls, cod] = await Promise.all([getStoreControls(), codForCheckout(pin, null, {})]);
  const codAllowed = controls.codEnabled && cod.allowed;
  const settings = await getCodSettings();
  const limits = [
    settings.codMinOrderValue != null ? `from ${rupees(settings.codMinOrderValue * 100)}` : null,
    settings.codMaxOrderValue != null ? `up to ${rupees(settings.codMaxOrderValue * 100)}` : null,
  ].filter(Boolean);
  const arrivesBy = serviceable ? new Date(estimateDeliveryDate(new Date(), zoneForPincode(pin)).getTime() + extra * 86_400_000).toISOString() : null;
  return reply(
    [
      {
        type: "pincode",
        pincode: pin,
        place: place ? `${place.city}, ${place.state}` : null,
        serviceable,
        arrivesBy,
        cod: {
          allowed: serviceable && codAllowed,
          note: !serviceable ? null : !controls.codEnabled ? "Cash on delivery is paused right now." : !cod.allowed ? cod.message : limits.length ? `On orders ${limits.join(" and ")}.` : null,
        },
        deliveryFeePaise: DEFAULT_SHIPPING_POLICY.flatRatePaise,
        freeAbovePaise: DEFAULT_SHIPPING_POLICY.freeAbovePaise,
      },
      ...(serviceable ? [] : [{ type: "text" as const, text: `${OUTSIDE_AREA_MESSAGE} We're growing, so check back soon.` }]),
    ],
    { quickReplies: [{ label: "Check another pincode", intent: "pincode" }, ...MENU.filter((m) => m.intent !== "pincode")] },
  );
}

/**
 * The order, if the number and the contact both match it. One query decides
 * the match, and the timeline is read only after it, so a wrong contact and a
 * wrong number take the same time: the answer's speed can't reveal whether an
 * order number exists.
 */
async function findOrder(orderNumber: string, contact: { phone: string } | { email: string }) {
  const order = await db.order.findUnique({
    where: { orderNumber },
    select: { id: true, orderNumber: true, status: true, placedAt: true, deliveredAt: true, trackingNumber: true, courierPartner: true, guestPhone: true, guestEmail: true },
  });
  const matches = order && ("phone" in contact ? order.guestPhone === contact.phone : (order.guestEmail ?? "").toLowerCase() === contact.email);
  if (!order || !matches) return null;
  const events = await db.orderEvent.findMany({
    where: { orderId: order.id, type: { in: ["STATUS_CHANGED", "PAYMENT_CAPTURED", "REFUNDED"] } },
    orderBy: { createdAt: "asc" },
    select: { type: true, createdAt: true, detail: true },
  });
  return { ...order, events };
}

async function answer(body: z.infer<typeof schema>, ip: () => Promise<boolean>): Promise<{ reply: BotReply; intent: Intent }> {
  const text = body.text?.trim() ?? "";
  const state: BotState = body.state ?? { flow: null };

  // --- inside a flow: collecting what it needs -------------------------------
  if ((state.flow === "track" || state.flow === "returns") && !body.intent) {
    if (!state.orderNumber) {
      const orderNumber = findOrderNumber(text);
      if (!orderNumber) {
        return {
          intent: state.flow,
          reply: reply([{ type: "text", text: "That doesn't look like an order number. It's in your confirmation email and looks like SO-XXXXXXXX-XX." }], { expect: "orderNumber", state, quickReplies: MENU }),
        };
      }
      return {
        intent: state.flow,
        reply: reply([{ type: "text", text: `Thanks. Now the mobile number or email you ordered ${orderNumber} with, so I know it's yours.` }], {
          expect: "contact",
          state: { flow: state.flow, orderNumber },
          quickReplies: MENU,
        }),
      };
    }
    const contact = parseContact(text);
    if (!contact) {
      return { intent: state.flow, reply: reply([{ type: "text", text: "Enter the 10-digit mobile number or the email address you ordered with." }], { expect: "contact", state }) };
    }
    // Capped per connection, and wrong guesses per order number (from any connection) are capped
    // too. Only failures count against an order, so a stranger can't lock its owner out cheaply.
    const failedKey = `assistant:order-miss:${state.orderNumber}`;
    const tooMany = async () => ((await hitCount(failedKey)) ?? 0) >= 20;
    if ((await ip()) || (await tooMany())) {
      return { intent: state.flow, reply: reply([{ type: "text", text: "That's a few tries in a short while. Wait a little, or talk to us directly." }, await handoff("help finding my order", state.orderNumber)]) };
    }
    const order = await findOrder(state.orderNumber, contact);
    if (!order) {
      await overLimit(failedKey, { max: 20, windowSeconds: 60 * 60 }).catch(() => false);
      return { intent: state.flow, reply: reply([{ type: "text", text: NOT_FOUND }], { expect: "orderNumber", state: { flow: state.flow }, quickReplies: MENU }) };
    }

    if (state.flow === "track") {
      const progress = orderProgress(order, order.events);
      return {
        intent: "track",
        reply: reply(
          [
            {
              type: "timeline",
              orderNumber: order.orderNumber,
              stages: progress.stages.map((s) => ({ label: s.label, done: s.done, current: s.current, date: s.date ? s.date.toISOString() : null })),
              ended: progress.ended ? { label: progress.ended.label, date: progress.ended.date ? progress.ended.date.toISOString() : null } : null,
              tracking: progress.tracking,
            },
          ],
          { quickReplies: [{ label: "Returns for this order", intent: "returns" }, { label: "Talk to a person", intent: "human" }, { label: "Menu", intent: "menu" }] },
        ),
      };
    }

    const settings = await getAssistantSettings();
    const verdict = returnVerdict(order, settings.returnWindowDays, new Date());
    const conditions: BotBlock[] = settings.returnConditions ? [{ type: "text", text: `What can be returned: ${settings.returnConditions}` }] : [];
    const lines: Record<typeof verdict.kind, string> = {
      "not-delivered": "This order hasn't been delivered yet, so there's nothing to return. If you'd like to change or cancel it, message us and we'll sort it out.",
      "no-window": "Our team handles each return personally. Send us a message with your order number and, for damaged or wrong items, a photo.",
      within: verdict.kind === "within" ? `You're within the return window (${verdict.daysLeft} day${verdict.daysLeft === 1 ? "" : "s"} left). Message us with your order number to start the return.` : "",
      outside: verdict.kind === "outside" ? `It was delivered ${verdict.daysSince} days ago, which is past the ${settings.returnWindowDays}-day return window. If something's wrong with it, message us anyway and we'll take a look.` : "",
      closed: verdict.kind === "closed" ? `This order is ${verdict.label}.` : "",
    };
    return { intent: "returns", reply: reply([{ type: "text", text: lines[verdict.kind] }, ...conditions, await handoff("a return", order.orderNumber)]) };
  }

  if (state.flow === "pincode" && !body.intent) {
    const pin = findPincode(text);
    return pin
      ? { intent: "pincode", reply: await pincodeAnswer(pin) }
      : { intent: "pincode", reply: reply([{ type: "text", text: "Enter a 6-digit pincode." }], { expect: "pincode", state }) };
  }

  // --- a new question ------------------------------------------------------------
  const intent: Intent = body.intent ?? classifyMessage(text);
  switch (intent) {
    case "track": {
      const orderNumber = findOrderNumber(text);
      return orderNumber
        ? { intent, reply: reply([{ type: "text", text: `Found the order number ${orderNumber}. What's the mobile number or email you ordered with?` }], { expect: "contact", state: { flow: "track", orderNumber } }) }
        : { intent, reply: reply([{ type: "text", text: "Sure. What's your order number? It's in your confirmation email, like SO-XXXXXXXX-XX." }], { expect: "orderNumber", state: { flow: "track" } }) };
    }
    case "returns": {
      const settings = await getAssistantSettings();
      const intro = settings.returnWindowDays !== null
        ? `Returns can be asked for within ${settings.returnWindowDays} days of delivery.`
        : "Our team handles each return personally.";
      return {
        intent,
        reply: reply(
          [
            { type: "text", text: `${intro} I can check an order for you: what's the order number?` },
            ...(settings.returnConditions ? [{ type: "text" as const, text: `What can be returned: ${settings.returnConditions}` }] : []),
          ],
          { expect: "orderNumber", state: { flow: "returns" }, quickReplies: [{ label: "Talk to a person instead", intent: "human" }, { label: "Menu", intent: "menu" }] },
        ),
      };
    }
    case "pincode": {
      const pin = findPincode(text);
      return pin
        ? { intent, reply: await pincodeAnswer(pin) }
        : { intent, reply: reply([{ type: "text", text: `Which pincode? We deliver across ${SERVICE_AREA.label}.` }], { expect: "pincode", state: { flow: "pincode" } }) };
    }
    case "shipping": {
      const p = DEFAULT_SHIPPING_POLICY;
      return {
        intent,
        reply: reply([
          { type: "text", text: `Delivery is ${rupees(p.flatRatePaise)}, and free on orders over ${rupees(p.freeAbovePaise)}. We deliver across ${SERVICE_AREA.label}, usually in 2 to 4 days; checkout shows the exact date for your pincode. Nothing is added at checkout: no handling, packing or COD fees.` },
        ], { quickReplies: [{ label: "Check my pincode", intent: "pincode" }, ...MENU.filter((m) => m.intent !== "shipping" && m.intent !== "pincode")] }),
      };
    }
    case "payment":
    case "cod": {
      const [checkout, settings] = await Promise.all([getCheckoutState(), getCodSettings()]);
      const methods = checkout.open ? checkout.methods : [];
      const online = methods.includes("ONLINE");
      const cod = methods.includes("COD");
      const limits = [
        settings.codMinOrderValue != null ? `from ${rupees(settings.codMinOrderValue * 100)}` : null,
        settings.codMaxOrderValue != null ? `up to ${rupees(settings.codMaxOrderValue * 100)}` : null,
      ].filter(Boolean);
      const parts = [
        online ? "Pay online with UPI (PhonePe, Google Pay, Paytm), cards, net banking or wallets, handled securely by Razorpay." : null,
        cod
          ? `Cash on delivery is available${limits.length ? ` on orders ${limits.join(" and ")}` : ""}, with no extra charge.${codRequiresCode() ? " We text a code to confirm your number first." : ""}`
          : "Cash on delivery isn't available right now.",
        !checkout.open ? "Orders are paused at the moment." : null,
      ].filter(Boolean);
      return { intent, reply: reply([{ type: "text", text: parts.join(" ") }], { quickReplies: [{ label: "Check COD for my pincode", intent: "pincode" }, ...MENU.filter((m) => m.intent !== "payment" && m.intent !== "pincode")] }) };
    }
    case "area":
      return { intent, reply: reply([{ type: "text", text: `We deliver across ${SERVICE_AREA.label} for now. Enter your pincode to check yours.` }], { expect: "pincode", state: { flow: "pincode" } }) };
    case "human":
    case "contact":
      return { intent, reply: reply([{ type: "text", text: "Here's how to reach us. A person will reply." }, await handoff("help")]) };
    case "menu":
      return { intent, reply: reply([{ type: "text", text: "Hi! I can track an order, check delivery to your pincode, explain returns, delivery charges and ways to pay, or put you in touch with us." }]) };
    default:
      return {
        intent: "unknown",
        reply: reply([{ type: "text", text: "I'm a simple helper and didn't catch that. Pick one of these, or talk to a person." }]),
      };
  }
}

/** Wrong guesses so far against an order number in the current hour (read only; failures are counted after a miss). */
async function hitCount(key: string): Promise<number | null> {
  const row = await db.rateLimit.findUnique({ where: { key } }).catch(() => null);
  if (!row || row.windowStart.getTime() < Date.now() - 60 * 60 * 1000) return 0;
  return row.count;
}

export async function POST(request: Request) {
  // Switched off by the owner: the whole assistant is off, lookups included.
  if (!(await getAssistantSettings()).enabled) return NextResponse.json({ message: "Not found." }, { status: 404 });
  const limited = await limitPublic("assistant");
  if (limited) return limited;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ message: "I didn't understand that." }, { status: 400 });

  // Order lookups get their own, tighter cap (counted only when one is attempted).
  const lookupLimited = async () => Boolean(await limitPublic("assistantLookup"));
  try {
    const { reply: out, intent } = await answer(parsed.data, lookupLimited);
    // What people ask about, by intent only: nothing they typed is kept.
    const sessionId = await readSessionId();
    if (sessionId) after(() => recordEvent(sessionId, "ASSISTANT_INTENT", { metadata: { intent } }));
    return NextResponse.json(out);
  } catch (error) {
    reportError("assistant", error);
    return NextResponse.json(reply([{ type: "text", text: "Something went wrong on our side. Try again, or talk to us directly." }]), { status: 200 });
  }
}

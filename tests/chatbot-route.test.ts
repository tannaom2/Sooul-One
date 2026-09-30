import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Route tests for POST /api/chatbot/message, the storefront Help assistant:
 * the order lookup's privacy rules, the owner's off switch, returns that
 * never state a policy the owner hasn't set, and telemetry by intent only.
 * The database, limits and settings are fakes; the rules themselves are in
 * tests/assistant.test.ts.
 */

const h = vi.hoisted(() => ({
  db: {
    order: { findUnique: vi.fn() },
    orderEvent: { findMany: vi.fn(async () => [] as unknown[]) },
    rateLimit: { findUnique: vi.fn(async () => null as unknown) },
  },
  limitPublic: vi.fn(),
  overLimit: vi.fn(async () => false),
  readSessionId: vi.fn(async () => "session-1" as string | null),
  recordEvent: vi.fn(),
  lookupPincode: vi.fn(),
  codForCheckout: vi.fn(async () => ({ allowed: true }) as { allowed: boolean; message?: string }),
  extraDeliveryDays: vi.fn(async () => 0),
  getCodSettings: vi.fn(async () => ({ codMinOrderValue: null, codMaxOrderValue: null })),
  getCheckoutState: vi.fn(async () => ({ open: true, methods: ["ONLINE", "COD"] })),
  getStoreControls: vi.fn(async () => ({ codEnabled: true })),
  getBusinessProfile: vi.fn(async () => ({ customerCareEmail: "care@example.in", customerCarePhone: "+91 79 0000 0000" })),
  getAssistantSettings: vi.fn(async () => ({ enabled: true, returnWindowDays: null as number | null, returnConditions: null as string | null, supportWhatsapp: "9876543210" as string | null })),
  codRequiresCode: vi.fn(() => false),
  getFaqs: vi.fn(async () => [] as { id: string; question: string; answer: string; topic: string; brandSlug: string | null; sortOrder: number }[]),
  afterCallbacks: [] as (() => unknown)[],
}));

vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: (fn: () => unknown) => h.afterCallbacks.push(fn),
}));
vi.mock("@/lib/db", () => ({ db: h.db }));
vi.mock("@/server/rate-limit", () => ({ limitPublic: h.limitPublic, overLimit: h.overLimit }));
vi.mock("@/server/cart", () => ({ readSessionId: h.readSessionId }));
vi.mock("@/lib/analytics", () => ({ recordEvent: h.recordEvent }));
vi.mock("@/lib/observability", () => ({ reportError: vi.fn() }));
vi.mock("@/server/pincode", () => ({ lookupPincode: h.lookupPincode }));
vi.mock("@/server/intel", () => ({ codForCheckout: h.codForCheckout, extraDeliveryDays: h.extraDeliveryDays, getCodSettings: h.getCodSettings }));
vi.mock("@/server/store-settings", () => ({ getCheckoutState: h.getCheckoutState, getStoreControls: h.getStoreControls }));
vi.mock("@/server/business", () => ({ getBusinessProfile: h.getBusinessProfile }));
vi.mock("@/server/assistant-settings", () => ({ getAssistantSettings: h.getAssistantSettings }));
vi.mock("@/server/customer-auth", () => ({ codRequiresCode: h.codRequiresCode }));
vi.mock("@/server/site-content", () => ({ getFaqs: h.getFaqs }));

const { POST } = await import("@/app/api/chatbot/message/route");

const ORDER = "SO-MUK57TG0-XB";
const DELIVERED = {
  id: "order-1",
  orderNumber: ORDER,
  status: "DELIVERED",
  placedAt: new Date("2026-09-27T06:00:00Z"),
  deliveredAt: new Date(Date.now() - 3 * 86_400_000),
  trackingNumber: "AWB123",
  courierPartner: "Delhivery",
  guestPhone: "9725003344",
  guestEmail: "asha@example.com",
};

async function send(body: unknown) {
  const res = await POST(new Request("http://localhost/api/chatbot/message", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
  return { status: res.status, body: await res.json() };
}
const texts = (body: { blocks: { type: string; text?: string }[] }) => body.blocks.filter((b) => b.type === "text").map((b) => b.text).join(" ");

beforeEach(() => {
  vi.clearAllMocks();
  h.afterCallbacks.length = 0;
  h.limitPublic.mockResolvedValue(null);
  h.overLimit.mockResolvedValue(false);
  h.db.rateLimit.findUnique.mockResolvedValue(null);
  h.db.order.findUnique.mockResolvedValue(DELIVERED);
  h.getAssistantSettings.mockResolvedValue({ enabled: true, returnWindowDays: null, returnConditions: null, supportWhatsapp: "9876543210" });
});

describe("the owner's switch and the limits", () => {
  it("is off entirely when the owner switches the assistant off, lookups included", async () => {
    h.getAssistantSettings.mockResolvedValue({ enabled: false, returnWindowDays: null, returnConditions: null, supportWhatsapp: null });
    const res = await send({ text: "9725003344", state: { flow: "track", orderNumber: ORDER } });
    expect(res.status).toBe(404);
    expect(h.db.order.findUnique).not.toHaveBeenCalled();
  });

  it("returns the rate limiter's answer untouched", async () => {
    h.limitPublic.mockResolvedValueOnce(new Response(JSON.stringify({ message: "Too many" }), { status: 429 }));
    expect((await send({ intent: "menu" })).status).toBe(429);
  });

  it("refuses a malformed flow state rather than trusting it", async () => {
    expect((await send({ state: { flow: "track", orderNumber: "<script>" } })).status).toBe(400);
  });
});

describe("order tracking", () => {
  it("asks for the mobile or email once it has an order number", async () => {
    const { body } = await send({ text: `where is ${ORDER.toLowerCase()}` });
    expect(body.expect).toBe("contact");
    expect(body.state).toEqual({ flow: "track", orderNumber: ORDER });
  });

  it("shows only the timeline for the right contact, never the address or items", async () => {
    const { body } = await send({ text: "+91 97250 03344", state: { flow: "track", orderNumber: ORDER } });
    const timeline = body.blocks.find((b: { type: string }) => b.type === "timeline");
    expect(timeline).toMatchObject({ orderNumber: ORDER, tracking: { number: "AWB123", courier: "Delhivery" } });
    expect(JSON.stringify(body)).not.toMatch(/asha@example\.com|9725003344|line1|address/i);
    expect(h.db.orderEvent.findMany).toHaveBeenCalledTimes(1);
  });

  it("gives the same answer, with the same work, for a wrong contact and an unknown order", async () => {
    const wrong = await send({ text: "9999999999", state: { flow: "track", orderNumber: ORDER } });
    h.db.order.findUnique.mockResolvedValueOnce(null);
    const unknown = await send({ text: "9725003344", state: { flow: "track", orderNumber: "SO-AAAAAAAA-AA" } });
    expect(texts(wrong.body)).toBe(texts(unknown.body));
    // The timeline is read only after a match, so neither answer is slower than the other.
    expect(h.db.orderEvent.findMany).not.toHaveBeenCalled();
    // Each miss counts against that order number.
    expect(h.overLimit).toHaveBeenCalledWith(`assistant:order-miss:${ORDER}`, expect.anything());
  });

  it("stops looking up an order after many wrong guesses, from any connection", async () => {
    h.db.rateLimit.findUnique.mockResolvedValue({ key: "k", count: 20, windowStart: new Date() });
    const { body } = await send({ text: "9725003344", state: { flow: "track", orderNumber: ORDER } });
    expect(h.db.order.findUnique).not.toHaveBeenCalled();
    expect(body.blocks.some((b: { type: string }) => b.type === "handoff")).toBe(true);
  });

  it("counts lookups against the connection's own limit", async () => {
    h.limitPublic.mockImplementation(async (scope: string) => (scope === "assistantLookup" ? new Response(null, { status: 429 }) : null));
    const { body } = await send({ text: "9725003344", state: { flow: "track", orderNumber: ORDER } });
    expect(h.db.order.findUnique).not.toHaveBeenCalled();
    expect(texts(body)).toMatch(/few tries/);
  });
});

describe("returns", () => {
  it("never states a window the owner hasn't set, and hands over to a person", async () => {
    const { body } = await send({ text: "9725003344", state: { flow: "returns", orderNumber: ORDER } });
    expect(texts(body)).toMatch(/handles each return personally/);
    expect(texts(body)).not.toMatch(/\d+ days?/);
    const handoff = body.blocks.find((b: { type: string }) => b.type === "handoff");
    expect(handoff.whatsapp).toContain(encodeURIComponent(ORDER));
  });

  it("uses the owner's window and words when set", async () => {
    h.getAssistantSettings.mockResolvedValue({ enabled: true, returnWindowDays: 7, returnConditions: "Sealed packs only.", supportWhatsapp: null });
    const { body } = await send({ text: "asha@example.com", state: { flow: "returns", orderNumber: ORDER } });
    expect(texts(body)).toMatch(/within the return window \(4 days left\)/);
    expect(texts(body)).toMatch(/What can be returned: Sealed packs only\./);
  });
});

describe("delivery and payment facts", () => {
  it("answers a pincode with the delivery promise including the owner's extra days, and COD per the rules", async () => {
    h.lookupPincode.mockResolvedValue({ city: "Surat", state: "Gujarat" });
    h.extraDeliveryDays.mockResolvedValue(2);
    h.codForCheckout.mockResolvedValue({ allowed: false, message: "Cash on delivery isn't available for this pincode." });
    const { body } = await send({ text: "do you deliver to 395007?" });
    const card = body.blocks.find((b: { type: string }) => b.type === "pincode");
    expect(card).toMatchObject({ pincode: "395007", serviceable: true, cod: { allowed: false, note: "Cash on delivery isn't available for this pincode." } });
    expect(h.extraDeliveryDays).toHaveBeenCalledWith("395007");
  });

  it("mentions the SMS code for COD only when codes are required", async () => {
    expect(texts((await send({ intent: "cod" })).body)).not.toMatch(/code/);
    h.codRequiresCode.mockReturnValue(true);
    expect(texts((await send({ intent: "cod" })).body)).toMatch(/text a code/);
  });
});

describe("telemetry", () => {
  it("records what was asked about by intent only, never the text", async () => {
    await send({ text: "my number is 9725003344, where is my parcel" });
    for (const fn of h.afterCallbacks) await fn();
    expect(h.recordEvent).toHaveBeenCalledWith("session-1", "ASSISTANT_INTENT", { metadata: { intent: "track" } });
    expect(JSON.stringify(h.recordEvent.mock.calls)).not.toMatch(/9725003344/);
  });
});

describe("the owner's FAQs and the batch check", () => {
  it("answers an unrecognised question from a published FAQ, with its tokens filled in", async () => {
    h.getFaqs.mockResolvedValue([
      { id: "faq_sourcing", question: "Where do your ingredients come from?", answer: "From farms we visit, delivered across {area}.", topic: "PRODUCTS", brandSlug: null, sortOrder: 0 },
    ]);
    const { body } = await send({ text: "where do the ingredients come from" });
    expect(texts(body)).toBe("From farms we visit, delivered across Gujarat.");
    expect(body.blocks.find((b: { type: string }) => b.type === "links").links[0].href).toBe("/help#faq-faq_sourcing");
  });

  it("still says it didn't understand when no FAQ is a confident match", async () => {
    h.getFaqs.mockResolvedValue([{ id: "x", question: "How long will my product last?", answer: "See the date.", topic: "PRODUCTS", brandSlug: null, sortOrder: 0 }]);
    const { body } = await send({ text: "tell me a joke" });
    expect(texts(body)).toMatch(/didn't catch that/);
  });

  it("points questions about genuine products to the batch check", async () => {
    const { body } = await send({ text: "how do I know this is not fake" });
    expect(body.blocks.find((b: { type: string }) => b.type === "links").links[0].href).toBe("/verify");
  });
});

import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { overLimit } from "@/server/rate-limit";
import { askCopilot } from "@/server/copilot";
import { reportError } from "@/lib/observability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  message: z.string().trim().min(1).max(1000),
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(4000) }))
    .max(20)
    .default([]),
});

/** A question for the Copilot drawer: the local model when it's online, else the built-in rules. */
export async function POST(request: Request) {
  const session = await requirePermission("finance:view");
  if (!session) return NextResponse.json({ message: "Sign in again." }, { status: 401 });
  // Generous, but stops a stuck script from hammering the owner's laptop.
  if (await overLimit(`copilot:${session.adminUserId}`, { max: 60, windowSeconds: 10 * 60 }).catch(() => false)) {
    return NextResponse.json({ message: "That's a lot of questions at once. Wait a few minutes." }, { status: 429 });
  }
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ message: "Type a question (up to 1,000 characters)." }, { status: 400 });
  try {
    return NextResponse.json(await askCopilot(parsed.data.message, parsed.data.history));
  } catch (error) {
    reportError("copilot-chat", error);
    return NextResponse.json({ message: "The copilot couldn't answer just now. Try again in a moment." }, { status: 500 });
  }
}

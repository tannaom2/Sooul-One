import { NextResponse } from "next/server";
import { cleanCode } from "@/lib/referrals";
import { rememberCode } from "@/server/referrals";

/**
 * A friend's shared link, sooulone.in/r/ASHA7K2: remember the code in this
 * browser (30 days) and show what it's worth. The referral itself only counts
 * once the friend proves their number by signing in (src/server/customer-auth.ts).
 */
export async function GET(request: Request, { params }: { params: Promise<{ code: string }> }) {
  const code = cleanCode((await params).code);
  const url = new URL("/invite", request.url);
  if (code) {
    await rememberCode(code);
    url.searchParams.set("code", code);
  }
  return NextResponse.redirect(url);
}

import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { requireStaff } from "@/lib/staff";
import { GOOGLE_HOST, authUrl, googleReady } from "@/lib/google";

// "Connect Gmail" lands here: send the signed-in staff member to Google's consent screen.
export async function GET(request: NextRequest) {
  const { email } = await requireStaff();
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  // Google only accepts the address registered in Google Cloud, so connecting always happens there.
  if (host !== GOOGLE_HOST) return NextResponse.redirect(`https://${GOOGLE_HOST}/settings?gmail=here`);
  const origin = `https://${host}`;
  console.log("Gmail connect redirect", `${origin}/api/google/callback`);
  if (!googleReady()) return NextResponse.redirect(`${origin}/settings?gmail=nokeys`);
  const state = randomBytes(24).toString("base64url");
  const res = NextResponse.redirect(authUrl(origin, state, email));
  res.cookies.set("g_state", state, { httpOnly: true, secure: true, sameSite: "lax", path: "/api/google", maxAge: 600 });
  return res;
}

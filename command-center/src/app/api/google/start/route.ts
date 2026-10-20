import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { requireStaff } from "@/lib/staff";
import { authUrl, googleReady } from "@/lib/google";

// "Connect Gmail" lands here: send the signed-in staff member to Google's consent screen.
export async function GET(request: NextRequest) {
  const { email } = await requireStaff();
  const origin = `https://${request.headers.get("x-forwarded-host") ?? request.headers.get("host")}`;
  if (!googleReady()) return NextResponse.redirect(`${origin}/settings?gmail=nokeys`);
  const state = randomBytes(24).toString("base64url");
  const res = NextResponse.redirect(authUrl(origin, state, email));
  res.cookies.set("g_state", state, { httpOnly: true, secure: true, sameSite: "lax", path: "/api/google", maxAge: 600 });
  return res;
}

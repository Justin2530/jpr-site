import { NextResponse, type NextRequest } from "next/server";
import { requireStaff } from "@/lib/staff";
import { exchangeCode, idTokenEmail, sealToken } from "@/lib/google";

// Google sends the staff member back here with a one-time code; trade it for a refresh token and keep it sealed.
export async function GET(request: NextRequest) {
  const { supabase, userId } = await requireStaff();
  const origin = `https://${request.headers.get("x-forwarded-host") ?? request.headers.get("host")}`;
  const done = (status: string) => {
    const res = NextResponse.redirect(`${origin}/settings?gmail=${status}`);
    res.cookies.delete({ name: "g_state", path: "/api/google" });
    return res;
  };
  const params = request.nextUrl.searchParams;
  const state = request.cookies.get("g_state")?.value;
  if (params.get("error")) return done("declined");
  if (!state || state !== params.get("state") || !params.get("code")) return done("expired");

  try {
    const tokens = await exchangeCode(origin, params.get("code")!);
    if (!tokens.refresh_token) return done("norefresh");
    const email = idTokenEmail(tokens.id_token);
    if (!email) return done("noemail");
    const { error } = await supabase.from("google_accounts").upsert({
      staff_id: userId,
      email,
      token_enc: sealToken(tokens.refresh_token),
      scopes: tokens.scope ?? null,
      connected_at: new Date().toISOString(),
    });
    if (error) return done("savefailed");
  } catch {
    return done("failed");
  }
  return done("connected");
}

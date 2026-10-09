"use server";

import { requireStaff } from "@/lib/staff";

// Saves this phone or computer so new texts and emails can notify it.
export async function savePushSubscription(sub: { endpoint: string; keys: { p256dh: string; auth: string } }) {
  const { supabase, userId } = await requireStaff();
  if (!sub?.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) throw new Error("That device didn't give a subscription.");
  const { error } = await supabase
    .from("push_subscriptions")
    .upsert({ endpoint: sub.endpoint, staff_id: userId, p256dh: sub.keys.p256dh, auth: sub.keys.auth, gone_at: null });
  if (error) throw new Error(error.message);
}

export async function forgetPushSubscription(endpoint: string) {
  const { supabase } = await requireStaff();
  await supabase.from("push_subscriptions").update({ gone_at: new Date().toISOString() }).eq("endpoint", endpoint);
}

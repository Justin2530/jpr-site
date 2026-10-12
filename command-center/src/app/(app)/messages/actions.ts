"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/staff";

// Saves this phone or computer so new texts and emails can notify it.
export async function savePushSubscription(sub: {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}) {
  const { supabase, userId } = await requireStaff();
  if (!sub?.endpoint || !sub.keys?.p256dh || !sub.keys?.auth)
    throw new Error("That device didn't give a subscription.");
  const { error } = await supabase.from("push_subscriptions").upsert({
    endpoint: sub.endpoint,
    staff_id: userId,
    p256dh: sub.keys.p256dh,
    auth: sub.keys.auth,
    gone_at: null,
  });
  if (error) throw new Error(error.message);
}

export async function forgetPushSubscription(endpoint: string) {
  const { supabase } = await requireStaff();
  await supabase
    .from("push_subscriptions")
    .update({ gone_at: new Date().toISOString() })
    .eq("endpoint", endpoint);
}

// Mark one conversation read without opening it.
export async function markRead(form: FormData) {
  const { supabase, userId } = await requireStaff();
  const who = String(form.get("who") ?? "");
  if (
    !/^[cp]:[0-9a-f-]{36}(:(g[0-9a-z]{1,40}|[jc][0-9a-f-]{36}|s))?$/i.test(who)
  )
    return;
  await supabase
    .from("message_reads")
    .upsert({ staff_id: userId, who, read_at: new Date().toISOString() });
  revalidatePath("/messages");
}

// Justin marks a conversation done (or reopens it) by hand. It stays that way until a new message comes in.
export async function markConversation(form: FormData) {
  const { supabase, userId } = await requireStaff();
  const who = String(form.get("who") ?? "");
  const state = String(form.get("state") ?? "");
  const last = String(form.get("last") ?? "");
  if (
    !/^[cp]:[0-9a-f-]{36}(:(g[0-9a-z]{1,40}|[jc][0-9a-f-]{36}|s))?$/i.test(who) ||
    !["done", "current"].includes(state) ||
    !/^[0-9a-f-]{36}$/i.test(last)
  )
    return;
  await supabase.rpc("conversation_mark", { p_who: who, p_state: state, p_last: last });
  if (state === "done")
    await supabase.from("message_reads").upsert({ staff_id: userId, who, read_at: new Date().toISOString() });
  revalidatePath("/messages");
}

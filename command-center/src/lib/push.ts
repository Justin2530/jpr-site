import webpush from "web-push";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

export function pushReady() {
  return Boolean(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim() && process.env.VAPID_PRIVATE_KEY?.trim());
}

// Phone notifications for new incoming texts and emails from people on file. Each message is claimed
// once by the database, so the tick and the text webhook can both call this without double pings.
export async function sendPushes(db: SupabaseClient<Database>, secret: string) {
  if (!pushReady()) return 0;
  const { data: items, error } = await db.rpc("push_claim", { p_secret: secret });
  if (error) throw new Error(error.message);
  if (!items?.length) return 0;
  const { data: devices } = await db.rpc("push_devices", { p_secret: secret });
  if (!devices?.length) return 0;
  webpush.setVapidDetails(
    "mailto:justin@jpeacerecruiting.com",
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!.trim(),
    process.env.VAPID_PRIVATE_KEY!.trim(),
  );
  let sent = 0;
  for (const item of items) {
    for (const d of devices) {
      try {
        await webpush.sendNotification(
          { endpoint: d.endpoint, keys: { p256dh: d.p256dh, auth: d.auth } },
          JSON.stringify({ title: item.title, body: item.body, url: item.url }),
          { TTL: 24 * 3600 },
        );
        sent++;
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) await db.rpc("push_forget", { p_secret: secret, p_endpoint: d.endpoint });
        else console.error("Push failed", status, e instanceof Error ? e.message : e);
      }
    }
  }
  return sent;
}

import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/staff";
import { automationSecret } from "@/lib/automation";
import { webhookDb } from "@/app/api/twilio/webhook";
import { Empty, PageHeader } from "@/components/ui";

export const metadata = { title: "Clear test records · JPR" };

// One-time: Justin's test lead (Toby Farts / Giant Dildo Company, 2026-11-12). He presses the button, so the
// deletes run as him through the app's normal permissions (no Supabase approval box, which he can't see).
// Remove this page once it has been used.
const ACTION_ITEM = "6079ea21-a47c-45df-9673-bd0b07a13ee8"; // the website lead on What needs me
const ACTIVITY = "00123fc3-6921-4153-80bb-37cbe6148a1c"; // the lead's notification email
const CONVERSATION = "p:180573c8-abf8-44f6-b5cc-e3485b10a183:g1a1d09ec7f750b32"; // inbox agent's note on that email
const JARVIS_ACTION = "c1817727-c47b-4489-8a87-0d1f74570ed4";
const JARVIS_MESSAGES = ["f522d282-6747-4e39-8f1d-21ef745a9ea1", "156c5c81-2387-4728-b34a-4344e19fcad6"];
const REMOVED = "(test record removed)";
const TEST = /toby|dildo/i;

type Rpc = (f: string, a: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;

async function owner() {
  const { supabase, staff } = await requireStaff();
  if (staff.role !== "owner") throw new Error("Only the owner can clear test records.");
  const secret = automationSecret();
  const db = webhookDb();
  return { supabase, secret, rpc: db.rpc.bind(db) as unknown as Rpc };
}

// What of the test lead is still in the Command Center.
async function leftOver() {
  const { supabase, secret, rpc } = await owner();
  const ids = JARVIS_MESSAGES.map((i) => `'${i}'`).join(",");
  const [{ data: item }, { data: activity }, { data: conv }, jarvis] = await Promise.all([
    supabase.from("action_items").select("title").eq("id", ACTION_ITEM).maybeSingle(),
    supabase.from("activities").select("summary").eq("id", ACTIVITY).maybeSingle(),
    supabase.from("conversation_states").select("reason").eq("who", CONVERSATION).maybeSingle(),
    secret
      ? rpc("jarvis_read", {
          p_secret: secret,
          p_sql: `select content as text from jarvis_messages where id in (${ids}) union all select summary from jarvis_actions where id = '${JARVIS_ACTION}'`,
        })
      : Promise.resolve({ data: [], error: null }),
  ]);
  const out: string[] = [];
  if (item) out.push(`What needs me: ${item.title}`);
  if (activity) out.push(`Email log: ${activity.summary ?? "lead notification"}`);
  if (conv && TEST.test(conv.reason ?? "")) out.push(`Inbox note: ${conv.reason}`);
  for (const j of (jarvis.data as { text: string }[] | null) ?? []) if (TEST.test(j.text)) out.push(`Jarvis chat: ${j.text.slice(0, 140)}`);
  return out;
}

async function clearTestRecords() {
  "use server";
  const { supabase, secret, rpc } = await owner();
  // The lead and its email: deleted, as Justin.
  const a = await supabase.from("activities").delete().eq("id", ACTIVITY);
  const b = await supabase.from("action_items").delete().eq("id", ACTION_ITEM);
  for (const r of [a, b]) if (r.error) throw new Error(r.error.message);
  // Jarvis's own chat log and the inbox agent's note can't be deleted from the app, so their text is wiped.
  if (secret) {
    const ids = JARVIS_MESSAGES.map((i) => `'${i}'`).join(",");
    for (const sql of [
      `update jarvis_messages set content = '${REMOVED}' where id in (${ids})`,
      `update jarvis_actions set summary = '${REMOVED}', action = '{"steps":[]}'::jsonb, result = case when result is null then null else '${REMOVED}' end where id = '${JARVIS_ACTION}'`,
      `update conversation_states set reason = '${REMOVED}' where who = '${CONVERSATION}'`,
    ]) {
      const { error } = await rpc("jarvis_write", { p_secret: secret, p_sql: sql });
      if (error) throw new Error(error.message);
    }
  }
  redirect("/cleanup?done=1");
}

export default async function CleanupPage({ searchParams }: { searchParams: Promise<{ done?: string }> }) {
  const { staff } = await requireStaff();
  if (staff.role !== "owner")
    return (
      <>
        <PageHeader title="Clear test records" />
        <Empty>Only the owner can do this.</Empty>
      </>
    );
  const { done } = await searchParams;
  const left = await leftOver();
  return (
    <>
      <PageHeader kicker="Test data" title="Clear test records" sub="Your Toby Farts / Giant Dildo Company test lead." />
      {left.length === 0 ? (
        <div className="panel p-4 text-sm">{done ? "Done. " : ""}All clear: nothing about Toby Farts or the Giant Dildo Company is left in the Command Center.</div>
      ) : (
        <div className="panel space-y-3 p-4">
          <p className="text-sm text-muted">Still here:</p>
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {left.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
          <form action={clearTestRecords}>
            <button type="submit" className="btn">
              Delete test records
            </button>
          </form>
        </div>
      )}
    </>
  );
}

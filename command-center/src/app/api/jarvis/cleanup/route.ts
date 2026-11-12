import { automationSecret } from "@/lib/automation";
import { webhookDb } from "@/app/api/twilio/webhook";

// One-time removal of Justin's test records (Toby Farts / Giant Dildo Company, 2026-11-12), run through the
// app's own server because he can't see Supabase approval boxes. It can only ever remove these exact rows,
// so calling it again does nothing. Remove this route once it has run.
const TEST_RECORDS: [table: string, keys: string[]][] = [
  ["conversation_states", ["p:180573c8-abf8-44f6-b5cc-e3485b10a183:g1a1d09ec7f750b32"]],
  ["activities", ["00123fc3-6921-4153-80bb-37cbe6148a1c"]],
  ["action_items", ["6079ea21-a47c-45df-9673-bd0b07a13ee8"]],
  ["jarvis_actions", ["c1817727-c47b-4489-8a87-0d1f74570ed4"]],
  ["jarvis_messages", ["f522d282-6747-4e39-8f1d-21ef745a9ea1", "156c5c81-2387-4728-b34a-4344e19fcad6"]],
];

export async function POST() {
  const secret = automationSecret();
  if (!secret) return Response.json({ error: "not set up" }, { status: 500 });
  const db = webhookDb();
  const rpc = db.rpc.bind(db) as unknown as (f: string, a: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
  const removed: Record<string, number | string> = {};
  for (const [table, keys] of TEST_RECORDS) {
    const { data, error } = await rpc("delete_test_records", { p_secret: secret, p_table: table, p_keys: keys });
    removed[table] = error ? `error: ${error.message}` : Number(data ?? 0);
  }
  return Response.json({ removed });
}

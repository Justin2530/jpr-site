import Link from "next/link";
import { requireStaff } from "@/lib/staff";
import { Chip, Empty, PageHeader } from "@/components/ui";
import { ChatIcon, MailIcon } from "@/components/icons";
import { PushToggle } from "@/components/push-toggle";
import { markRead } from "./actions";
import { people, whoKey, whoPath, type Who } from "@/lib/messages";
import { STAGE_LABEL, timeAgo } from "@/lib/format";

export const metadata = { title: "Messages · JPR" };

type Row = {
  id: string;
  kind: string;
  direction: string | null;
  summary: string;
  body: string | null;
  occurred_at: string;
  candidate_id: string | null;
  contact_id: string | null;
};

function preview(r: Row) {
  const text =
    (r.kind === "email"
      ? r.summary.replace(/^Email (to|from) [^:]+:\s*/, "")
      : r.body || r.summary) ?? "";
  return text.replace(/\s+/g, " ").trim();
}

// Every text and email with candidates and client contacts, newest conversation first, like a phone's Messages app.
export default async function MessagesPage({
  searchParams,
}: {
  searchParams: Promise<{ show?: string }>;
}) {
  const { show } = await searchParams;
  const { supabase, userId } = await requireStaff();
  const [{ data: rows }, { data: reads }] = await Promise.all([
    supabase
      .from("activities")
      .select(
        "id, kind, direction, summary, body, occurred_at, candidate_id, contact_id",
      )
      .in("kind", ["text", "email"])
      .or("candidate_id.not.is.null,contact_id.not.is.null")
      .order("occurred_at", { ascending: false })
      .limit(1000),
    supabase
      .from("message_reads")
      .select("who, read_at")
      .eq("staff_id", userId),
  ]);
  const readAt = new Map((reads ?? []).map((r) => [r.who, r.read_at]));

  // One row per person: their latest message, and how many came in since Justin last opened it.
  const threads = new Map<string, { who: Who; last: Row; unread: number }>();
  for (const r of (rows ?? []) as Row[]) {
    // Anything with a client contact on it (submission emails, their replies) is that contact's conversation.
    const who: Who = r.contact_id
      ? { kind: "p", id: r.contact_id }
      : { kind: "c", id: r.candidate_id! };
    const key = whoKey(who);
    const t = threads.get(key) ?? { who, last: r, unread: 0 };
    const seen = readAt.get(key);
    if (r.direction === "in" && (!seen || r.occurred_at > seen)) t.unread++;
    threads.set(key, t);
  }
  let list = [...threads.values()];
  if (show === "unread") list = list.filter((t) => t.unread > 0);
  const who = await people(
    supabase,
    list.map((t) => t.who),
  );
  const unreadCount = [...threads.values()].filter((t) => t.unread > 0).length;

  function row(t: (typeof list)[number]) {
    const p = who.get(whoKey(t.who));
    if (!p) return null;
    const Icon = t.last.kind === "text" ? ChatIcon : MailIcon;
    return (
      <li key={whoKey(t.who)} className="flex items-center">
        <Link
          href={whoPath(t.who)}
          className="flex min-w-0 flex-1 items-start gap-3 px-4 py-3 hover:bg-white/[0.03]"
        >
          <span
            className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${t.unread ? "bg-cyan shadow-[0_0_8px_rgb(var(--glow)/0.9)]" : "bg-transparent"}`}
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span
                className={`truncate ${t.unread ? "font-semibold text-ink" : "font-medium"}`}
              >
                {p.name}
              </span>
              <Chip tone={p.role.tone}>{p.role.text}</Chip>
              <span className="ml-auto shrink-0 font-mono text-[10.5px] text-faint">
                {timeAgo(t.last.occurred_at)}
              </span>
            </div>
            <p className="truncate text-xs text-muted">
              {p.jobs.length
                ? p.jobs
                    .map(
                      (j) =>
                        `${j.title}${j.company ? ` · ${j.company}` : ""} (${STAGE_LABEL[j.stage]})`,
                    )
                    .join(", ")
                : (p.detail ?? (p.who.kind === "c" ? "Not on a job" : ""))}
            </p>
            <p
              className={`mt-0.5 flex items-center gap-1.5 truncate text-sm ${t.unread ? "text-ink" : "text-muted"}`}
            >
              <Icon className="h-3.5 w-3.5 shrink-0 text-faint" />
              <span className="truncate">
                {t.last.direction === "out" ? "You: " : ""}
                {preview(t.last)}
              </span>
            </p>
          </div>
          {t.unread > 0 && (
            <span className="mt-0.5 shrink-0 rounded-full bg-cyan px-1.5 font-mono text-[10.5px] text-void">
              {t.unread}
            </span>
          )}
        </Link>
        {t.unread > 0 && (
          <form action={markRead} className="shrink-0 pr-3">
            <input type="hidden" name="who" value={whoKey(t.who)} />
            <button className="btn-quiet py-1 text-xs">Mark read</button>
          </form>
        )}
      </li>
    );
  }

  return (
    <>
      <PageHeader
        title="Messages"
        sub="Texts and emails with candidates and clients. Tap one to read it and reply."
      />
      <div className="space-y-4">
        <PushToggle />
        <div className="flex gap-1.5">
          {[
            ["all", "All", threads.size],
            ["unread", "Unread", unreadCount],
          ].map(([key, text, n]) => (
            <Link
              key={key}
              href={key === "all" ? "/messages" : "/messages?show=unread"}
              className={`rounded-md border px-2.5 py-1 text-xs ${(show === "unread") === (key === "unread") ? "border-cyan/50 bg-cyan-soft text-cyan" : "border-line text-muted hover:text-ink"}`}
            >
              {text} <span className="font-mono text-faint">{n}</span>
            </Link>
          ))}
        </div>
        {list.length === 0 ? (
          <Empty>
            {show === "unread"
              ? "You're all caught up."
              : "No texts or emails yet."}
          </Empty>
        ) : (
          [
            // Contacts at a client company are Clients; everyone else Justin talks to on the sales side is a Lead.
            [
              "Clients",
              list.filter(
                (t) =>
                  t.who.kind === "p" &&
                  who.get(whoKey(t.who))?.role.text === "Client",
              ),
            ],
            [
              "Leads",
              list.filter(
                (t) =>
                  t.who.kind === "p" &&
                  who.get(whoKey(t.who))?.role.text !== "Client",
              ),
            ],
            ["Candidates", list.filter((t) => t.who.kind === "c")],
          ].map(([title, items]) =>
            (items as typeof list).length === 0 ? null : (
              <section key={title as string} className="space-y-2">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">
                  {title as string}{" "}
                  <span className="font-mono text-faint">
                    {(items as typeof list).length}
                  </span>
                </h2>
                <ul className="panel divide-y divide-line overflow-hidden">
                  {(items as typeof list).map(row)}
                </ul>
              </section>
            ),
          )
        )}
      </div>
    </>
  );
}

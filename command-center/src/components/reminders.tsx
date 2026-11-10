import { BellIcon } from "@/components/icons";
import { Panel } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { shortDate } from "@/lib/format";
import { addReminder, completeReminder } from "@/app/(app)/outreach-actions";

// Open reminders tied to this record. They also show on What needs me.
export function Reminders({
  items,
  links,
  path,
}: {
  items: { id: string; title: string; due_on: string | null }[];
  links: { candidate_id?: string; contact_id?: string; company_id?: string };
  path: string;
}) {
  const today = new Date().toISOString().slice(0, 10);
  return (
    <Panel title="Reminders">
      {items.length > 0 && (
        <ul className="-mt-1 mb-3 divide-y divide-line">
          {items.map((r) => (
            <li key={r.id} className="flex items-center gap-2 py-2">
              <BellIcon className={`h-4 w-4 shrink-0 ${r.due_on && r.due_on <= today ? "text-amber" : "text-muted"}`} />
              <span className="flex-1 text-sm">{r.title}</span>
              {r.due_on && (
                <span className={`font-mono text-[11px] ${r.due_on <= today ? "text-amber" : "text-faint"}`}>{shortDate(r.due_on)}</span>
              )}
              <form action={completeReminder}>
                <input type="hidden" name="id" value={r.id} />
                <input type="hidden" name="path" value={path} />
                <button className="text-xs text-faint hover:text-mint" aria-label="Mark done">
                  Done
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}
      <form action={addReminder} className="flex flex-wrap gap-2">
        {Object.entries(links).map(([k, v]) => v && <input key={k} type="hidden" name={k} value={v} />)}
        <input type="hidden" name="path" value={path} />
        <input name="title" required placeholder="Remind me to…" className="field min-w-0 flex-[2_1_10rem]" aria-label="Reminder" />
        <input name="due_on" type="date" className="field w-auto flex-1" aria-label="Due date" />
        <SubmitButton className="btn-quiet">Add</SubmitButton>
      </form>
    </Panel>
  );
}

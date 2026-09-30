import { requireStaff } from "@/lib/staff";
import { PageHeader } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { twilioNumber, twilioReady } from "@/lib/twilio";
import { saveMyCell } from "./actions";
import { ConnectButton } from "./connect-button";

export const metadata = { title: "Phone & texting · JPR" };

function pretty(e164: string | null) {
  const d = e164?.replace(/\D/g, "").slice(-10);
  return d && d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : (e164 ?? "");
}

function Step({ done, title, children }: { done: boolean; title: string; children: React.ReactNode }) {
  return (
    <li className="panel flex gap-4 p-4">
      <span
        className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full border font-mono text-xs ${done ? "border-mint/50 bg-mint/10 text-mint" : "border-line text-faint"}`}
      >
        {done ? "✓" : "•"}
      </span>
      <div className="min-w-0 flex-1 space-y-2">
        <p className="font-medium">{title}</p>
        {children}
      </div>
    </li>
  );
}

export default async function SettingsPage() {
  const { staff } = await requireStaff();
  const keys = Boolean(process.env.TWILIO_ACCOUNT_SID?.trim() && process.env.TWILIO_AUTH_TOKEN?.trim());
  const ready = twilioReady();

  return (
    <>
      <PageHeader kicker="Business" title="Phone & texting" />
      <ol className="max-w-2xl space-y-3">
        <Step done={Boolean(twilioNumber)} title="Business number">
          <p className="text-sm text-muted">
            {twilioNumber ? `${pretty(twilioNumber)}. Candidates and clients see this number when you call or text.` : "Not set yet."}
          </p>
        </Step>
        <Step done={keys} title="Twilio keys">
          <p className="text-sm text-muted">
            {keys
              ? "Connected."
              : "In Vercel, open jpr-site, then Settings, then Environment Variables, and add TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN from your Twilio Console home page. Then ask Claude to redeploy."}
          </p>
        </Step>
        <Step done={Boolean(staff.phone)} title="Your cell">
          <p className="text-sm text-muted">
            When you press Call, this phone rings first, then connects you. Calls to the business number ring it too.
          </p>
          <form action={saveMyCell} className="flex flex-wrap gap-2">
            <input
              name="phone"
              defaultValue={pretty(staff.phone)}
              placeholder="(814) 555-1234"
              className="field max-w-xs"
              aria-label="Your cell"
            />
            <SubmitButton className="btn-quiet">Save</SubmitButton>
          </form>
        </Step>
        <Step done={false} title="Send incoming texts and calls here">
          <p className="text-sm text-muted">
            One click points your business number at the Command Center, so replies land on the right profile and on What needs me.
          </p>
          <ConnectButton disabled={!ready || staff.role !== "owner"} />
        </Step>
      </ol>
      <p className="mt-6 max-w-2xl text-xs text-faint">
        Calls aren&apos;t recorded, since Pennsylvania requires everyone on the call to agree. Anyone who replies STOP is blocked from
        further texts automatically.
      </p>
    </>
  );
}

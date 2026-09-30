import { requireStaff } from "@/lib/staff";
import { PageHeader } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { twilioNumber, twilioReady } from "@/lib/twilio";
import { readRegistration, type Registration } from "@/lib/twilio-registration";
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
  const { staff, supabase } = await requireStaff();
  const keys = Boolean(process.env.TWILIO_ACCOUNT_SID?.trim() && process.env.TWILIO_AUTH_TOKEN?.trim());
  const ready = twilioReady();
  let registration: Registration | null = null;
  if (ready && staff.role === "owner") {
    registration = await readRegistration();
    // Kept so Claude can read the same picture without Twilio access.
    await supabase
      .from("integration_snapshots")
      .upsert({ name: "twilio_registration", data: registration, taken_at: new Date().toISOString() });
  }

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
      {registration && <RegistrationPanel reg={registration} />}
      <p className="mt-6 max-w-2xl text-xs text-faint">
        Calls aren&apos;t recorded, since Pennsylvania requires everyone on the call to agree. Anyone who replies STOP is blocked from
        further texts automatically.
      </p>
    </>
  );
}

const GOOD = new Set(["approved", "verified", "twilio-approved", "registered", "active", "in_use"]);
const BAD = new Set(["failed", "rejected", "twilio-rejected", "suspended", "closed"]);
function Status({ value }: { value: string }) {
  const v = value.toLowerCase();
  const tone = GOOD.has(v) ? "text-mint" : BAD.has(v) ? "text-rose" : "text-amber";
  return <span className={`font-mono text-xs uppercase ${tone}`}>{value || "unknown"}</span>;
}

function RegistrationPanel({ reg }: { reg: Registration }) {
  const day = (d: string) => (d ? new Date(d).toLocaleDateString("en-US") : "");
  return (
    <section className="mt-8 max-w-2xl space-y-3">
      <h2 className="text-lg font-semibold text-ink">Texting registration</h2>
      <p className="text-sm text-muted">
        What Twilio has on file for business texting, read live from your account. Carriers block texts from numbers without an approved
        campaign.
      </p>
      <div className="panel space-y-4 p-4 text-sm">
        <div>
          <p className="panel-title mb-1 text-cyan/80">Business profiles</p>
          {reg.profiles.length ? (
            reg.profiles.map((p) => (
              <p key={p.sid}>
                {p.name} <Status value={p.status} />
              </p>
            ))
          ) : (
            <p className="text-faint">None</p>
          )}
        </div>
        <div>
          <p className="panel-title mb-1 text-cyan/80">Brands</p>
          {reg.brands.length ? (
            reg.brands.map((b) => (
              <div key={b.sid} className="mb-2">
                <p>
                  {b.type.replace(/_/g, " ").toLowerCase()} brand, {day(b.created)} <Status value={b.status} />
                  {b.identity && <span className="ml-2 text-xs text-faint">identity {b.identity.toLowerCase()}</span>}
                </p>
                {[b.failure, ...b.errors].filter(Boolean).map((e, i) => (
                  <p key={i} className="text-xs text-amber">
                    {e}
                  </p>
                ))}
              </div>
            ))
          ) : (
            <p className="text-faint">None</p>
          )}
        </div>
        <div>
          <p className="panel-title mb-1 text-cyan/80">Campaigns</p>
          {reg.campaigns.length ? (
            reg.campaigns.map((c) => (
              <div key={c.sid} className="mb-2">
                <p>
                  {c.usecase.replace(/_/g, " ").toLowerCase()} on &ldquo;{c.service}&rdquo;, {day(c.created)} <Status value={c.status} />
                </p>
                <p className="text-xs text-faint">{c.description}</p>
                {c.errors.map((e, i) => (
                  <p key={i} className="text-xs text-amber">
                    {e}
                  </p>
                ))}
              </div>
            ))
          ) : (
            <p className="text-faint">None</p>
          )}
        </div>
        <div>
          <p className="panel-title mb-1 text-cyan/80">Accounts</p>
          {reg.subaccounts.map((a) => (
            <p key={a.sid}>
              {a.name} <Status value={a.status} />
            </p>
          ))}
        </div>
        {reg.problems.length > 0 && (
          <div className="text-xs text-amber">
            {reg.problems.map((p) => (
              <p key={p}>{p}</p>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

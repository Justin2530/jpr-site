import { requireStaff } from "@/lib/staff";
import { PageHeader } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { twilioApi, twilioNumber, twilioReady } from "@/lib/twilio";
import { readRegistration, type Registration } from "@/lib/twilio-registration";
import { googleReady } from "@/lib/google";
import { gmailAccount } from "@/lib/gmail-account";
import { headers } from "next/headers";
import { automationSecret, registerAutomation } from "@/lib/automation";
import { saveMyCell, setAutomatedRecruiting } from "./actions";
import { ConnectButton } from "./connect-button";

export const metadata = { title: "Phone & email · JPR" };

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

const GMAIL_STATUS: Record<string, { ok: boolean; text: string }> = {
  connected: { ok: true, text: "Gmail connected. Email buttons on profiles now send from your mailbox and log themselves." },
  declined: { ok: false, text: "Google sign-in was cancelled. Try again when you're ready." },
  expired: { ok: false, text: "That sign-in link expired. Press Connect Gmail again." },
  norefresh: { ok: false, text: "Google didn't grant ongoing access. Press Connect Gmail again and allow everything it asks for." },
  noemail: { ok: false, text: "Google didn't say which mailbox this is. Press Connect Gmail again." },
  nokeys: { ok: false, text: "The Google keys aren't in Vercel yet." },
  savefailed: { ok: false, text: "Connected, but saving failed. Press Connect Gmail again." },
  failed: { ok: false, text: "Google didn't accept the sign-in. Press Connect Gmail again." },
};

// True when the business number's texts and calls already point at this app, and no Messaging Service
// holding the number is taking incoming texts away from it.
async function numberWired(reg: Registration | null) {
  if (!twilioNumber) return false;
  try {
    const list = await twilioApi("IncomingPhoneNumbers", { PhoneNumber: twilioNumber }, "GET");
    const num = list.incoming_phone_numbers?.[0];
    if (!num?.sms_url?.includes("/api/twilio/sms") || !num?.voice_url?.includes("/api/twilio/voice")) return false;
  } catch {
    return false;
  }
  return !(reg?.services ?? []).some((s) => s.numbers.includes(twilioNumber!) && !s.usesNumberWebhook);
}

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ gmail?: string }> }) {
  const gmailStatus = GMAIL_STATUS[(await searchParams).gmail ?? ""];
  const gmail = await gmailAccount();
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

  const wired = ready && staff.role === "owner" ? await numberWired(registration) : false;
  const automation = Boolean(automationSecret());
  const { data: auto } = await supabase.from("automation_settings").select("automated_recruiting, eligible_after").maybeSingle();
  const autoOn = Boolean(auto?.automated_recruiting);
  if (automation && staff.role === "owner") {
    const h = await headers();
    await registerAutomation(supabase, `https://${h.get("x-forwarded-host") ?? h.get("host")}`);
  }

  return (
    <>
      <PageHeader kicker="Business" title="Phone & email" />
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
        <Step done={wired} title="Send incoming texts and calls here">
          <p className="text-sm text-muted">
            {wired
              ? "Connected. Texts to your business number land on the right profile and on What needs me, and calls ring your cell."
              : "One click points your business number at the Command Center, so replies land on the right profile and on What needs me."}
          </p>
          <ConnectButton disabled={!ready || staff.role !== "owner"} connected={wired} />
        </Step>
        <Step done={Boolean(gmail)} title="Gmail">
          <p className="text-sm text-muted">
            {gmail
              ? `Connected as ${gmail.email}. Email buttons on candidates, contacts and deals send from this mailbox and log themselves.`
              : googleReady()
                ? "Sign in with your JPR Google Workspace account so emails send from your own mailbox and land on each person's history."
                : "Waiting on the Google keys in Vercel (GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET)."}
          </p>
          {googleReady() && (
            <a href="/api/google/start" className={gmail ? "btn-quiet" : "btn"}>
              {gmail ? "Reconnect Gmail" : "Connect Gmail"}
            </a>
          )}
          {gmailStatus && <p className={`text-sm ${gmailStatus.ok ? "text-mint" : "text-amber"}`}>{gmailStatus.text}</p>}
        </Step>
        <Step done={autoOn} title="Automated recruiting">
          <p className="text-sm text-muted">
            {autoOn ? "On." : "Off."} This is the master switch. While it&apos;s on, assigning someone to a job asks whether to automate
            them, and each candidate&apos;s job tab has its own on/off switch. When automated, the Command Center texts and emails them to set up
            a call: a text and an email right away, a text the next day, an email on day 3 and a last text on day 5. Any reply, text, email
            or call stops it and lands on What needs me. Sends only Monday to Saturday, 9am to 7pm. Texts only go to people with texting
            consent checked.
          </p>
          <p className="text-sm text-muted">
            Only candidates added after it&apos;s first turned on are ever included
            {auto?.eligible_after ? ` (added after ${new Date(auto.eligible_after).toLocaleDateString("en-US")})` : ""}. Everyone already in
            the system stays manual.
          </p>
          {staff.role === "owner" && (
            <form action={setAutomatedRecruiting}>
              <input type="hidden" name="on" value={autoOn ? "false" : "true"} />
              <SubmitButton className={autoOn ? "btn-quiet hover:text-rose" : "btn"}>
                {autoOn ? "Turn off automated recruiting" : "Turn on automated recruiting"}
              </SubmitButton>
            </form>
          )}
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
  // Once a campaign is approved, old rejected ones Twilio keeps on file are just history.
  const approved = reg.campaigns.some((c) => GOOD.has(c.status.toLowerCase()));
  const campaigns = approved ? reg.campaigns.filter((c) => !BAD.has(c.status.toLowerCase())) : reg.campaigns;
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
          {campaigns.length ? (
            campaigns.map((c) => (
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
          <p className="panel-title mb-1 text-cyan/80">Messaging services with a number</p>
          {reg.services.filter((s) => s.numbers.length).length ? (
            reg.services
              .filter((s) => s.numbers.length)
              .map((s) => (
                <p key={s.sid}>
                  {s.name}: {s.numbers.join(", ")}{" "}
                  <span className={`text-xs ${s.usesNumberWebhook ? "text-mint" : "text-amber"}`}>
                    {s.usesNumberWebhook ? "texts come to this app" : "press Connect my business number above"}
                  </span>
                </p>
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

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
import { setAiCalls } from "../relay-actions";
import { liveSetup } from "@/lib/live";
import { webhookUrl } from "@/lib/twilio";
import { ConnectButton } from "./connect-button";
import { PasswordForm } from "./password-form";
import { cookies } from "next/headers";
import { AppearanceSettings, type Rain } from "@/components/theme";

export const metadata = { title: "Settings · JPR" };

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
  const { data: auto } = await supabase.from("automation_settings").select("automated_recruiting, eligible_after_v1, ai_calls").maybeSingle();
  const autoOn = Boolean(auto?.automated_recruiting);
  const h = await headers();
  const origin = `https://${h.get("x-forwarded-host") ?? h.get("host")}`;
  if (automation && staff.role === "owner") await registerAutomation(supabase, origin);
  const live = liveSetup();
  const liveOk = live.key && live.project && live.webhook;
  const jar = await cookies();

  return (
    <>
      <PageHeader kicker="Business" title="Settings" />
      <section className="panel mb-6 max-w-2xl">
        <div className="border-b border-line px-4 py-3">
          <h2 className="panel-title">Sign in</h2>
        </div>
        <div className="space-y-3 p-4">
          <p className="text-sm text-muted">
            Set a password to sign in with your email and password instead of waiting for a link. The Command Center lives at{" "}
            <span className="text-ink">jpr-site-wellthree.vercel.app</span>. In Chrome, use the install button at the right end of the address bar
            to keep it on your desktop, or Add to Home Screen on your phone.
          </p>
          <PasswordForm />
        </div>
      </section>
      <section className="panel mb-6 max-w-2xl">
        <div className="border-b border-line px-4 py-3">
          <h2 className="panel-title">Appearance</h2>
        </div>
        <div className="p-4">
          <AppearanceSettings
            theme={jar.get("jpr-theme")?.value === "matrix" ? "matrix" : "jarvis"}
            rain={(["off", "subtle"].includes(jar.get("jpr-rain")?.value ?? "") ? jar.get("jpr-rain")!.value : "bright") as Rain}
          />
        </div>
      </section>
      <h2 className="panel-title mb-3">Phone &amp; email</h2>
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
            a call: a text and an email right away, an email on day 1, an AI call on day 3, an email on day 5, a text on day 8, an AI call on
            day 12 and a last email on day 14. With no reply by day 16 they move to Couldn&apos;t contact. Any reply, text, email or call stops it.
            Emails go out any time, texts any day between 9am and 9pm, and AI calls Monday to Saturday between 9am and 7pm. Anyone who replies
            STOP is never texted again.
          </p>
          <p className="text-sm text-muted">
            Only candidates added after it&apos;s first turned on are ever included
            {auto?.eligible_after_v1 ? ` (added after ${new Date(auto.eligible_after_v1).toLocaleDateString("en-US")})` : ""}. Everyone already in
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
          <p className="text-sm text-muted">
            After a submission goes out, it also follows up with a client who hasn&apos;t answered in 3 business days (then reminds you to
            call), carries interview scheduling between the client and the candidate, texts the candidate a reminder the day before and
            checks in with the client at 3pm the next business day. Offers and counteroffers always wait for your click. Anything it flags to
            you turns that candidate&apos;s automation off until you turn it back on.
          </p>
          <p className="text-sm text-muted">
            <span className="text-ink">AI calls: {auto?.ai_calls ? "on" : "off"}.</span>{" "}
            {auto?.ai_calls
              ? "Outreach includes the day 3 and day 12 AI calls, and calls a candidate books are made by the AI assistant."
              : "Outreach sends only texts and emails. When a candidate books a call, it lands in What needs me as a call for you to make at that time. Call now on a candidate still works."}
          </p>
          {staff.role === "owner" && (
            <form action={setAiCalls}>
              <input type="hidden" name="on" value={auto?.ai_calls ? "false" : "true"} />
              <SubmitButton className={auto?.ai_calls ? "btn-quiet hover:text-rose" : "btn-quiet"}>
                {auto?.ai_calls ? "Turn off AI calls" : "Turn on AI calls"}
              </SubmitButton>
            </form>
          )}
        </Step>
        <Step done={liveOk} title="AI screening calls">
          <p className="text-sm text-muted">
            At the time a candidate booked, the Command Center calls them from the business number and OpenAI&apos;s voice assistant runs a
            short screening. It says it&apos;s JPR&apos;s AI assistant, asks if recording is okay, covers the job&apos;s screening questions and answers
            theirs. Afterwards the answers, notes and a submission draft land on their job tab, ready for your Send. Voicemail or no answer
            gets a text asking for a better time.
          </p>
          <ul className="space-y-1 font-mono text-[12px]">
            <li className={live.key ? "text-mint" : "text-amber"}>{live.key ? "✓" : "○"} OPENAI_API_KEY</li>
            <li className={live.project ? "text-mint" : "text-amber"}>{live.project ? "✓" : "○"} OPENAI_PROJECT_ID</li>
            <li className={live.webhook ? "text-mint" : "text-amber"}>{live.webhook ? "✓" : "○"} OPENAI_WEBHOOK_SECRET</li>
          </ul>
          {staff.role === "owner" && (
            <div className="space-y-1">
              <p className="text-sm text-muted">Webhook address for OpenAI (Settings, Project, Webhooks):</p>
              <input readOnly value={webhookUrl(origin, "/api/openai/webhook")} className="field w-full font-mono text-[11px]" aria-label="Webhook address" />
            </div>
          )}
        </Step>
      </ol>
      {registration && <RegistrationPanel reg={registration} />}
      <p className="mt-6 max-w-2xl text-xs text-faint">
        Your own calls aren&apos;t recorded, since Pennsylvania requires everyone on the call to agree. AI screening calls are recorded only
        after the candidate says it&apos;s okay. Anyone who replies STOP is blocked from further texts automatically.
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

import { twilioGet } from "@/lib/twilio";

// Read-only picture of the account's texting (A2P 10DLC) registration: brands, campaigns, messaging
// services and subaccounts. Only names, statuses and error reasons; never tax IDs or personal details.
export type Registration = {
  profiles: { sid: string; name: string; status: string }[];
  brands: {
    sid: string;
    type: string;
    status: string;
    identity: string | null;
    failure: string | null;
    errors: string[];
    created: string;
  }[];
  services: { sid: string; name: string }[];
  campaigns: {
    sid: string;
    service: string;
    brand: string;
    usecase: string;
    status: string;
    description: string;
    errors: string[];
    created: string;
  }[];
  subaccounts: { sid: string; name: string; status: string }[];
  problems: string[];
};

type Json = Record<string, unknown>;
const str = (v: unknown) => (v == null ? "" : String(v));
const errs = (v: unknown) =>
  Array.isArray(v)
    ? v.map((e) => (typeof e === "object" && e ? str((e as Json).description ?? (e as Json).message ?? JSON.stringify(e)) : str(e)))
    : [];

export async function readRegistration(): Promise<Registration> {
  const reg: Registration = { profiles: [], brands: [], services: [], campaigns: [], subaccounts: [], problems: [] };
  const attempt = async (label: string, fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (e) {
      reg.problems.push(`${label}: ${e instanceof Error ? e.message : "failed"}`);
    }
  };

  await Promise.all([
    attempt("Business profiles", async () => {
      const r = await twilioGet("https://trusthub.twilio.com/v1/CustomerProfiles?PageSize=50");
      reg.profiles = (r.results ?? []).map((p: Json) => ({ sid: str(p.sid), name: str(p.friendly_name), status: str(p.status) }));
    }),
    attempt("Brands", async () => {
      const r = await twilioGet("https://messaging.twilio.com/v1/a2p/BrandRegistrations?PageSize=50");
      reg.brands = (r.data ?? r.results ?? []).map((b: Json) => ({
        sid: str(b.sid),
        type: str(b.brand_type),
        status: str(b.status),
        identity: b.identity_status ? str(b.identity_status) : null,
        failure: b.failure_reason ? str(b.failure_reason) : null,
        errors: errs(b.errors),
        created: str(b.date_created),
      }));
    }),
    attempt("Subaccounts", async () => {
      const r = await twilioGet("https://api.twilio.com/2010-04-01/Accounts.json?PageSize=50");
      reg.subaccounts = (r.accounts ?? []).map((a: Json) => ({ sid: str(a.sid), name: str(a.friendly_name), status: str(a.status) }));
    }),
    attempt("Messaging services", async () => {
      const r = await twilioGet("https://messaging.twilio.com/v1/Services?PageSize=50");
      reg.services = (r.services ?? []).map((s: Json) => ({ sid: str(s.sid), name: str(s.friendly_name) }));
      await Promise.all(
        reg.services.map((s) =>
          attempt(`Campaigns on ${s.name}`, async () => {
            const c = await twilioGet(`https://messaging.twilio.com/v1/Services/${s.sid}/Compliance/Usa2p?PageSize=20`);
            for (const x of (c.compliance ?? c.results ?? []) as Json[]) {
              reg.campaigns.push({
                sid: str(x.sid),
                service: s.name,
                brand: str(x.brand_registration_sid),
                usecase: str(x.us_app_to_person_usecase),
                status: str(x.campaign_status),
                description: str(x.description),
                errors: errs(x.errors),
                created: str(x.date_created),
              });
            }
          }),
        ),
      );
    }),
  ]);
  return reg;
}

import type { Enums } from "@/lib/database.types";

// Lead Engine pieces the browser can use too (labels, prices, the size guess). The worker is in leads.ts.
export type LeadLine = Enums<"lead_line">;

export const LINE_LABEL: Record<LeadLine, string> = { local: "JPR Local", usa: "JPR USA", ai: "JPR AI" };
export const LEAD_STATUS_LABEL: Record<Enums<"lead_status">, string> = {
  prospect: "Prospect",
  contacted: "Contacted",
  replied: "Replied",
  customer: "Customer",
  not_interested: "Not interested",
  do_not_contact: "Do not contact",
};

// Serper's price after the free 2,500: $50 buys 50,000 credits.
export const SERPER_FREE_CREDITS = 2500;
export const DOLLARS_PER_CREDIT = 0.001;
// Biggest single search allowed, so a slip of the mouse can't queue a nationwide run by accident (all of
// Pennsylvania's 2,553 zip codes x 10 keywords fits).
export const MAX_TASKS_PER_SEARCH = 30000;

// Google only shows a handful of businesses for "machine shop in Jefferson County, PA", so each county is
// searched one zip code at a time ("machine shop in Punxsutawney, PA 15767"). A search task's county field
// carries the zip and town too: "Jefferson County|15767|Punxsutawney" (a plain county name is the old
// whole-county search, still used where there's no zip list).
export function taskArea(field: string) {
  const [county, zip, town] = field.split("|");
  return { county, zip: zip || null, town: town || null };
}
export const taskAreaField = (county: string, zip: string, town: string | null) => `${county}|${zip}|${town ?? ""}`;

// The size guess, from what Google shows (see lead_size_score in the database).
export function sizeBand(score: number) {
  if (score >= 50) return { text: "Likely 5+", tone: "mint" as const };
  if (score >= 30) return { text: "Maybe 5+", tone: "amber" as const };
  return { text: "Likely small", tone: "muted" as const };
}

const STOP_WORDS = new Set(["llc", "inc", "incorporated", "co", "corp", "corporation", "company", "ltd", "limited", "the", "and", "of", "pc", "llp", "pllc"]);
// Same as lead_norm_name in the database: "ACME Machine & Welding Co, LLC" -> "acme machine welding".
export function normName(s: string | null | undefined) {
  return (s ?? "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w && !STOP_WORDS.has(w))
    .join(" ");
}


// National chains and franchise locations (Justin 2026-11-09: "i dont like the results of giant corprate companies
// like mcdonalds or dollar general"). Hiring there is decided at corporate, so they're skipped. Caught two ways: a
// known brand name, or a website that is one store's page on a chain's site (store locators, "locations." hosts).
const CHAIN_NAMES =
  /^(mcdonald'?s|burger king|wendy'?s|subway|taco bell|kfc|pizza hut|domino'?s|papa john'?s|arby'?s|dairy queen|sonic drive-in|dunkin'?|starbucks|tim hortons|sheetz|get go|getgo|kwik fill|uni-mart|7-eleven|speedway|sunoco|exxon|shell|bp|marathon|citgo|pilot|flying j|love'?s travel|ta travel|dollar general|family dollar|dollar tree|walmart|wal-mart|sam'?s club|target|kmart|aldi|giant eagle|shop ?n ?save|save a lot|weis|walgreens|cvs|rite aid|lowe'?s|the home depot|home depot|tractor supply|harbor freight|autozone|advance auto parts|napa auto parts|o'?reilly auto parts|pep boys|jiffy lube|valvoline|tops|big lots|ollie'?s|tj ?maxx|marshalls|kohl'?s|jcpenney|staples|office depot|best buy|gamestop|verizon|at&t|t-mobile|boost mobile|cricket wireless|h&r block|jackson hewitt|edward jones|state farm|allstate|nationwide|ups store|the ups store|fedex|usps|post office|pnc|citizens bank|wells fargo|chase|northwest bank|s&t bank|first commonwealth|applebee'?s|eat'?n park|denny'?s|cracker barrel|olive garden|red lobster|long john silver'?s|hardee'?s|little caesars|chipotle|panera|wingstop|bob evans|perkins|ponderosa|golden corral|great clips|supercuts|sport clips|planet fitness|anytime fitness|petco|petsmart|goodwill|salvation army|rent-a-center|aaron'?s|enterprise rent-a-car|u-haul|penske|ryder)(\s*(#\s*\d+|\(.*\)|[-–|,].*|\d+|(store|gas|gas station|station|express|pharmacy|travel center|travel plaza|restaurant|market|supercenter|neighborhood market|auto parts|bank|branch)\b.*))?$/i;
const CHAIN_URL = /^https?:\/\/(locations?|stores?|local|restaurants?|branches?)\.|\/(store|stores|store-directory|location|locations|store-locator|storelocator|find-a-store|findasheetz|branch|branches|restaurant|restaurants)\/[^/?#]+/i;
export function isChain(name: string | null | undefined, website: string | null | undefined) {
  return CHAIN_NAMES.test((name ?? "").trim()) || CHAIN_URL.test(website ?? "");
}

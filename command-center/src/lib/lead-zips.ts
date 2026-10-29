import ZIPS from "./data/county-zips.json";
import HOME from "./data/zip-home-county.json";

// Zip codes in every county ("PA|Jefferson County" -> "15711 Anita;15715 Big Run;..."), from the HUD zip-county
// crosswalk via the zipcodes-nrviens package (zip_fips_county_code_and_state.csv). A zip that crosses county
// lines is listed under each county it touches.
const BY_COUNTY = ZIPS as Record<string, string>;

export type ZipArea = { zip: string; town: string | null };

export function countyZips(state: string, county: string): ZipArea[] {
  const raw = BY_COUNTY[`${state}|${county}`];
  if (!raw) return [];
  return raw.split(";").map((s) => {
    const i = s.indexOf(" ");
    return i < 0 ? { zip: s, town: null } : { zip: s.slice(0, i), town: s.slice(i + 1) || null };
  });
}

let byZip: Map<string, { state: string; county: string }[]> | null = null;
let homeOf: Map<string, { state: string; county: string }> | null = null;

// The county a business is really in, from its zip: the zip's home county (GeoNames, via the zipcodes-us
// package's US.txt; Punxsutawney's 15767 is Jefferson though it reaches into Indiana and Clearfield). For a
// zip with no home county on file, the county being searched wins when the zip touches it.
export function zipCounty(zip: string | null | undefined, prefer?: { state: string; county: string }) {
  const z = (zip ?? "").slice(0, 5);
  if (!/^\d{5}$/.test(z)) return null;
  if (!homeOf) {
    homeOf = new Map();
    for (const [key, list] of Object.entries(HOME as Record<string, string>)) {
      const [state, county] = key.split("|");
      for (const zz of list.split(" ")) homeOf.set(zz, { state, county });
    }
  }
  const home = homeOf.get(z);
  if (home) return home;
  if (!byZip) {
    byZip = new Map();
    for (const [key, list] of Object.entries(BY_COUNTY)) {
      const [state, county] = key.split("|");
      for (const s of list.split(";")) {
        const zz = s.slice(0, 5);
        const arr = byZip.get(zz) ?? [];
        arr.push({ state, county });
        byZip.set(zz, arr);
      }
    }
  }
  const hits = byZip.get(z);
  if (!hits?.length) return null;
  return (prefer && hits.find((h) => h.state === prefer.state && h.county === prefer.county)) || hits[0];
}

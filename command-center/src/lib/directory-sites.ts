// Sites that list many businesses: directories, review sites, trucking lookups, news and public records. They are
// never a business's own website, and emails found on them aren't the business's. Built from the sites that came
// back for many different businesses in the first 12,580 researched for the master lead list (Nov 2026).
const NAMES = [
  // social, search and maps
  "facebook", "instagram", "linkedin", "twitter", "x", "tiktok", "youtube", "pinterest", "nextdoor", "google", "yahoo",
  "bing", "mapquest", "waze", "wikipedia",
  // business directories and lookups
  "yelp", "bbb", "yellowpages", "manta", "bizapedia", "opencorporates", "dnb", "dandb", "zoominfo", "buzzfile",
  "corporationwiki", "allbiz", "zaubacorp", "chamberofcommerce", "city-data", "usbusinesslookup", "whitepages",
  "rocketreach", "searchmule", "alignable", "showmelocal", "birdeye", "causeiq", "candid", "bloomberg", "govtribe",
  "govcb", "teamingpro", "mfg", "casemine", "pacermonitor", "punxsutawney", "visitpago",
  // jobs
  "indeed", "glassdoor",
  // contractors and home services
  "angi", "homeadvisor", "thumbtack", "houzz", "porch", "buildzoom", "procore", "thebluebook", "homeyou", "lawnstarter",
  // trucking and vehicles
  "truckerpath", "truckmap", "vektortms", "lanefinder", "carriersource", "loadconnect", "brokersnapshot", "motorcarrier",
  "roserocket", "fleetfax", "movecars", "carshipio", "carfax", "cargurus", "pavehicleinspections", "napaonline",
  // health and care
  "healthgrades", "carescout", "care", "healthdataatlas",
  // energy and industry lists
  "mineralanswers", "shalexp", "drillerdb", "scrapmonster", "claimspages", "coalcampusa",
  // news and obituaries
  "legacy", "newspapers", "tribdem", "indianagazette", "thecourierexpress", "theprogressnews", "punxsutawneyspirit", "wjactv",
  "theclarionnews", "myprogressnews", "latrobebulletinnews", "leadertimes", "mainlinemedianews", "newsbreak", "cbsnews",
  "worldenergynews", "frepouch",
  // added before the final Sheet (Nov 20): senior care and health listings
  "aplaceformom", "mcknightsseniorliving", "elderlifefinancial", "carelistings", "caring", "seniorcareauthority", "ltcnews",
  "nursinghomes", "whereassistedliving", "findcontinuingcare", "webmd", "psychwebmd", "medifind", "cortico", "deltadental",
  "rxlocal", "stedi",
  // booking, food ordering and real estate platforms
  "zillow", "vagaro", "fresha", "booksy", "grubhub", "ubereats", "toasttab", "singleplatform", "restaurantguru", "restaurantji",
  "placejoys", "wheree",
  // other listings, lookups and member directories
  "localsearch", "centrelocal", "dexknows", "loc8nearme", "cpadirectory", "jewelrystoredirectory", "theweddingvenuesfinder",
  "visualvisitor", "findtruckservice", "findwaterlab", "finditchesapeake", "experience", "networkofcare", "findhelp",
  "openplacement", "digitalworksjobs", "golfpass", "apple", "shell", "leadiq", "importgenius", "guidestar", "propublica",
  "millerwoodtradepub", "lumberheritage", "mpif", "humanservices-countyofindiana",
  // tourism, chambers, economic development and downtown groups
  "discoverclarioncounty", "exploreclarion", "explorejeffersonpa", "explorevenango", "explorepahistory", "visitjohnstownpa",
  "visitsmicksburg", "visitindianacountypa", "visitclearfieldcounty", "visitjeffersonpa", "visitparker", "visittreasurelake",
  "clarioncountyedc", "indianacountyceo", "duboisccci", "duboispachamber", "indianacountychamber", "crchamber", "jrvchamber",
  "marionchamber", "redbankchamber", "stmaryschamber", "downtownkittanning",
];
const DIRECTORY = new RegExp(`(^|\\.)(${NAMES.join("|")})\\.[a-z]{2,}$`, "i");

function host(url: string) {
  try {
    return new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname.toLowerCase();
  } catch {
    return null;
  }
}

export function isDirectorySite(url: string | null | undefined) {
  const h = url ? host(url.trim()) : null;
  if (!h) return false;
  // Government records, state agencies and library archives aren't a business's site either.
  return DIRECTORY.test(h) || /\.(gov|mil)$|\.pa\.us$|(^|\.)librar/i.test(h);
}

export function isDirectoryEmail(email: string) {
  const domain = email.split("@")[1];
  return !!domain && isDirectorySite(domain);
}

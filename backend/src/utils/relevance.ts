/**
 * Heuristic (not ML) relevance tag for a scraped tender, modelled on the
 * pure-function style of computeContentHash in hash.ts. Deliberately
 * conservative: falls back to "unclassified" rather than forcing every
 * tender into relevant/irrelevant when there's no clear signal either way.
 *
 * Rule order matches how a human would actually read a tender: a
 * parts/repair/AMC listing is irrelevant regardless of how prestigious the
 * client is (a spare part for an Army tank is still a spare part), so that
 * check runs first and short-circuits before the client check.
 */
export type Relevance = "relevant" | "irrelevant" | "unclassified";

// Parts/components/repair/AMC signal -- checked against title + category.
const COMPONENT_PATTERN =
  /\b(spares?|spare\s*parts?|components?|accessor(?:y|ies)|repair(?:ing)?\s*of|amc\b|annual\s+maintenance|refurbish(?:ment)?|overhaul|calibration|replacement\s+of|maintenance\s+of|servicing\s+of)\b/i;

// Defence/surveillance client signal -- checked against organisation + department.
const DEFENCE_CLIENT_PATTERN =
  /\b(army|navy|naval|air\s*force|defence|defense|drdo|ordnance|military|para\s*military|border\s*security|\bbsf\b|\bcrpf\b|\bitbp\b|\bssb\b|\bcisf\b|\bnsg\b|coast\s*guard|railway\s*protection|surveillance|intelligence\s+bureau|home\s+affairs)\b/i;

// Clearly civilian/non-defence client signal -- checked against organisation + department.
const NON_DEFENCE_CLIENT_PATTERN =
  /\b(college|university|school|polytechnic|panchayat|municipal|municipality|hospital|medical\s+college|agricultur|horticultur)\b/i;

export function classifyRelevance(fields: {
  title?: string | null;
  category?: string | null;
  organisation?: string | null;
  department?: string | null;
}): Relevance {
  const itemText = `${fields.title ?? ""} ${fields.category ?? ""}`;
  if (COMPONENT_PATTERN.test(itemText)) return "irrelevant";

  const clientText = `${fields.organisation ?? ""} ${fields.department ?? ""}`;
  if (DEFENCE_CLIENT_PATTERN.test(clientText)) return "relevant";
  if (NON_DEFENCE_CLIENT_PATTERN.test(clientText)) return "irrelevant";

  return "unclassified";
}

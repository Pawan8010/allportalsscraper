/**
 * Keyword list used to tag tenders whose title/description mention
 * defense / surveillance / optics equipment of interest.
 *
 * Sourced from the project brief. Matching is case-insensitive and
 * whole-phrase (not stemmed), run against the tender's title + description.
 */
export const KEYWORDS: string[] = [
  "Thermal Camera",
  "Thermal Weapon Sight",
  "Thermal Imager",
  "Thermal Imaging Sight",
  "Night Vision Sight",
  "Day Night Sight",
  "Night Vision Device",
  "Night Vision Device (NVD)",
  "Night Vision Goggles",
  "Night Vision Goggles (NVG)",
  "Image Intensifier",
  "Uncooled Thermal",
  "Cooled Thermal",
  "LWIR",
  "MWIR",
  "LWIR / MWIR",
  "Handheld Thermal Imager",
  "Target Acquisition System",
  "Laser Range Finder (LRF) integrated sight",
  "PTZ Camera",
  "Long Range PTZ Camera",
  "Longe range PTZ Camera",
  "Pan Tilt Zoom Camera",
  "PTZ with EO payload",
  "Pan Tilt Zoom Camera (PTZ with EO payload)",
  "Optical Camera",
  "Night Vision Camera",
  "Night vision Camera",
  "Laser Range Finder",
  "LOROS",
  "Long Range Observation System",
  "Long Range Observation System (LOROS)",
  "EOSS",
  "Electro Optical Surveillance System",
  "Electro Optical Surveillance System (EOSS)",
  "Battlefield Surveillance Radar",
  "Battlefield Surveillance Radar + EO",
  "Border Surveillance System",
  "Reflex Sight",
  "Red Dot Sight",
  "Holographic Sight",
  "Weapon Sight",
];

/**
 * Returns the subset of KEYWORDS found in the given text, matched as
 * whole phrases, case-insensitively. Longer/more specific phrases are
 * checked as-is (no need to de-duplicate substrings like "Thermal
 * Camera" vs "Thermal Imager" - each is reported independently since
 * they represent distinct equipment categories).
 */
export function matchKeywords(text: string): string[] {
  if (!text) return [];
  const haystack = normalizeForKeywordMatch(text);
  const matches: string[] = [];

  for (const keyword of KEYWORDS) {
    const needle = normalizeForKeywordMatch(keyword);
    if (haystack.includes(needle)) {
      matches.push(keyword);
    }
  }
  return matches;
}

function normalizeForKeywordMatch(value: string): string {
  return value.toLowerCase().replace(/[^\w]+/g, " ").replace(/\s+/g, " ").trim();
}

/** Comma-joined string for storage in Tender.keywordMatched, or null if none. */
export function matchKeywordsAsString(
  title: string | null | undefined,
  description: string | null | undefined
): string | null {
  const combined = `${title ?? ""} ${description ?? ""}`;
  const matches = matchKeywords(combined);
  return matches.length ? matches.join(", ") : null;
}

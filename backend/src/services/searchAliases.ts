/**
 * Small hand-maintained alias table so a search for an acronym also matches
 * spelled-out tenders and vice versa. Seeded directly from the "Specific
 * Keywords" table in the uploaded PDF.
 */
export const SEARCH_ALIASES: Record<string, string[]> = {
  nvg: ["night vision goggles"],
  nvd: ["night vision device"],
  eoss: ["electro optical surveillance system"],
  loros: ["long range observation system"],
  ptz: ["pan tilt zoom camera"],
  lrf: ["laser range finder"],
  lwir: ["long wave infrared"],
  mwir: ["mid wave infrared"],
};

export function expandAliases(normalizedQuery: string): string[] {
  const hits = SEARCH_ALIASES[normalizedQuery];
  return hits ? [normalizedQuery, ...hits] : [normalizedQuery];
}

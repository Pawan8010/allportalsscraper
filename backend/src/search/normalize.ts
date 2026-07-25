import { ABBREVIATIONS, ALIAS_GROUPS, SPELLING_CORRECTIONS } from "./aliases";

/** GeM bid numbers look like GEM/2026/B/7755763 (also .../R/... for RAs). */
const BID_NUMBER_PATTERN = /\bGEM[\/\-\s]*(\d{4})[\/\-\s]*([A-Z]{1,2})[\/\-\s]*(\d{3,})\b/i;
/** A bare numeric id long enough to only plausibly be a bid number. */
const BARE_BID_NUMBER_PATTERN = /^\d{6,}$/;

/**
 * Words that carry no discriminating power in tender titles. Dropped from token
 * matching but never from phrase matching, so "supply of thermal camera" still
 * phrase-matches while "supply" alone does not drag in unrelated tenders.
 */
const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "in",
  "is",
  "of",
  "on",
  "or",
  "the",
  "to",
  "with",
  "this",
  "that",
  "procurement",
  "purchase",
  "supply",
  "supplying",
  "provision",
  "providing",
  "tender",
  "bid",
  "item",
  "qty",
  "nos",
  "etc",
]);

/** Unicode-normalizes, strips diacritics, smart punctuation and control characters. */
export function normalizeUnicode(value: string): string {
  return (
    value
      .normalize("NFKD")
      // Combining diacritical marks left behind by NFKD decomposition.
      .replace(/[\u0300-\u036f]/g, "")
      // Smart quotes down to ASCII.
      .replace(/[\u2018\u2019\u201b\u2032]/g, "'")
      .replace(/[\u201c\u201d\u2033]/g, '"')
      // Every dash variant down to a plain hyphen.
      .replace(/[\u2010-\u2015\u2212]/g, "-")
      // Non-breaking, zero-width, ideographic and other exotic spaces.
      .replace(/[\u00a0\u1680\u2000-\u200b\u202f\u205f\u3000\ufeff]/g, " ")
      // Control characters.
      .replace(/[\u0000-\u001f\u007f]/g, " ")
  );
}

/**
 * Lowercases, removes harmless punctuation (keeping word characters), turns
 * hyphens/slashes into spaces and collapses whitespace.
 */
export function normalizeText(value: string): string {
  return normalizeUnicode(value)
    .toLowerCase()
    .replace(/[_\-\/\\.,;:!?"'`()\[\]{}<>|@#$%^&*+=~]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Singular nouns that already end in "s". Stripping the "s" would corrupt them,
 * and a corrupted token quietly stops matching anything.
 */
const NON_PLURAL_S_WORDS = new Set([
  "lens",
  "gas",
  "news",
  "series",
  "species",
  "means",
  "means",
  "canvas",
  "atlas",
  "gps",
  "bras",
  "chassis",
]);

/**
 * Very small, deliberately conservative English singulariser, covering the
 * equipment vocabulary this app searches.
 *
 * Note the "as" ending is NOT treated as protected: "cameras", "antennas" and
 * "aerials" are ordinary plurals, and excluding them left "thermal cameras"
 * failing to match "thermal camera". Latin-ish singulars are protected by their
 * own endings ("ss", "us", "is") plus the explicit list above.
 */
export function singularize(token: string): string {
  if (token.length <= 3) return token;
  if (NON_PLURAL_S_WORDS.has(token)) return token;
  if (/(ss|us|is)$/.test(token)) return token;
  if (/ies$/.test(token)) return `${token.slice(0, -3)}y`;
  if (/(ch|sh|x|z)es$/.test(token)) return token.slice(0, -2);
  if (/ves$/.test(token)) return `${token.slice(0, -3)}f`;
  if (/s$/.test(token)) return token.slice(0, -1);
  return token;
}

/** Applies spelling corrections, then singularises. */
function canonicalToken(token: string): string {
  const corrected = SPELLING_CORRECTIONS[token] ?? token;
  return SPELLING_CORRECTIONS[singularize(corrected)] ?? singularize(corrected);
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter((value) => value.length > 0)));
}

/** Normalizes a stored field the same way a query is normalized, for comparison. */
export function normalizePhrase(value: string): string {
  return normalizeText(value).split(" ").map(canonicalToken).join(" ").trim();
}

export interface NormalizedQuery {
  /** Exactly what the caller typed, trimmed. */
  raw: string;
  /** Lowercased, punctuation-free, whitespace-collapsed. */
  normalized: string;
  /** Normalized + spelling-corrected + singularised. */
  canonical: string;
  /** Canonical tokens with stop words removed. */
  tokens: string[];
  /** Every canonical token, including stop words - used for exact phrase checks. */
  allTokens: string[];
  /** Canonical phrase plus every alias/abbreviation expansion of it. */
  phrases: string[];
  /** True when the query looks like a GeM bid number. */
  isBidNumber: boolean;
  /** The bid number in GeM's canonical GEM/YYYY/X/NNNN form, when detected. */
  bidNumber: string | null;
}

/**
 * Expands abbreviations inside a canonical phrase, e.g. "ptz camera" ->
 * "pan tilt zoom camera". Returns the expanded phrase, or null when nothing
 * expanded.
 */
function expandAbbreviations(canonical: string): string | null {
  const tokens = canonical.split(" ").filter(Boolean);
  let changed = false;
  const expanded = tokens.map((token) => {
    const replacement = ABBREVIATIONS[token];
    if (!replacement) return token;
    changed = true;
    return normalizeText(replacement).split(" ").map(singularize).join(" ");
  });
  return changed ? expanded.join(" ") : null;
}

/**
 * Returns every alias phrase related to the given canonical phrase. A group
 * matches when the phrase equals, contains, or is contained by one of its
 * entries - so "thermal camera" pulls in "infrared camera", and
 * "handheld thermal imager for border post" still pulls in the thermal group.
 */
export function expandAliases(canonical: string): string[] {
  if (!canonical) return [];
  const seeds = unique([canonical, expandAbbreviations(canonical) ?? ""]);
  const matched: string[] = [];

  for (const group of ALIAS_GROUPS) {
    const normalizedGroup = group.map(normalizePhrase);
    const hit = seeds.some((seed) =>
      normalizedGroup.some((entry) => seed === entry || seed.includes(entry) || entry.includes(seed))
    );
    if (hit) matched.push(...normalizedGroup);
  }

  return unique(matched);
}

/** Extracts a GeM bid number from free text, normalized to GEM/YYYY/X/NNNN. */
export function extractBidNumber(value: string): string | null {
  const compact = normalizeUnicode(value ?? "").trim();
  const match = compact.match(BID_NUMBER_PATTERN);
  if (match) return `GEM/${match[1]}/${match[2].toUpperCase()}/${match[3]}`;
  if (BARE_BID_NUMBER_PATTERN.test(compact)) return compact;
  return null;
}

/** The single normalization pipeline every search path runs through. */
export function normalizeQuery(raw: string): NormalizedQuery {
  const trimmed = (raw ?? "").trim();
  const normalized = normalizeText(trimmed);
  const allTokens = normalized.split(" ").filter(Boolean).map(canonicalToken);
  const canonical = allTokens.join(" ");
  const tokens = unique(allTokens.filter((token) => token.length >= 2 && !STOP_WORDS.has(token)));
  const bidNumber = extractBidNumber(trimmed);

  const phrases = unique([canonical, normalized, expandAbbreviations(canonical) ?? "", ...expandAliases(canonical)]);

  return {
    raw: trimmed,
    normalized,
    canonical,
    tokens,
    allTokens,
    phrases,
    isBidNumber: bidNumber !== null,
    bidNumber,
  };
}

/**
 * Normalizes a set of selected keyword chips. Each chip is normalized
 * independently and keeps its own alias expansion, because chips combine with
 * OR semantics (a tender matching any one chip is a result).
 */
export function normalizeKeywordSelection(keywords: string[]): NormalizedQuery[] {
  return unique(keywords)
    .map(normalizeQuery)
    .filter((entry) => entry.canonical.length > 0);
}

/**
 * The tokens used for trigram (typo tolerant) matching. Stop words are already
 * gone from `tokens`; bid numbers are excluded because they are matched exactly
 * and their digits would trigram-match unrelated part numbers.
 */
export function trigramTokens(query: NormalizedQuery): string[] {
  if (query.isBidNumber) return [];
  return query.tokens.filter((token) => /[a-z]/.test(token));
}

/** Strips anything `tsquery` would treat as an operator. */
function escapeTsToken(token: string): string {
  return token.replace(/[^a-z0-9]/gi, "");
}

/**
 * Builds a PostgreSQL `tsquery` string for a normalized query.
 * Within the typed text every token is AND-ed (all must appear) and prefix
 * matched, so "therm camer" finds "thermal camera". Alias phrases are OR-ed in
 * as adjacent-word phrases. The result is passed to `to_tsquery` as a bound
 * parameter - it is never interpolated into SQL.
 */
export function buildTsQuery(query: NormalizedQuery): string {
  const clauses: string[] = [];

  if (query.tokens.length > 0) {
    const conjunction = query.tokens
      .map(escapeTsToken)
      .filter(Boolean)
      .map((token) => `${token}:*`)
      .join(" & ");
    if (conjunction) clauses.push(`(${conjunction})`);
  }

  for (const phrase of query.phrases) {
    const phraseTokens = phrase
      .split(" ")
      .filter((token) => token.length >= 2 && !STOP_WORDS.has(token))
      .map(escapeTsToken)
      .filter(Boolean);
    if (phraseTokens.length === 0) continue;
    clauses.push(`(${phraseTokens.join(" <-> ")})`);
  }

  return unique(clauses).join(" | ");
}

/**
 * Builds the OR-ed tsquery for a set of chips. Each chip contributes its own
 * complete tsquery; a tender matching any chip is a result.
 */
export function buildTsQueryForAny(queries: NormalizedQuery[]): string {
  return unique(queries.map(buildTsQuery)).join(" | ");
}

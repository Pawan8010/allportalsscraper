import { Prisma, TenderStatus } from "@prisma/client";
import { prisma } from "../config/db";
import { config } from "../config/env";
import { NormalizedQuery, buildTsQuery, normalizeQuery, normalizeKeywordSelection, trigramTokens } from "../search/normalize";

/**
 * Threshold for pg_trgm's word_similarity, applied per query token.
 *
 * Tuned against the live corpus: at 0.42 a query token still matches a
 * misspelled word in the tender title ("Tharmal Imaging Camera" is real GeM
 * data), while requiring *every* token to match keeps unrelated rows out -
 * "Thermal Cycler" matches `thermal` but not `camera`, so it is excluded.
 *
 * Set per transaction via set_config so the `%>` operator can still use the
 * GIN trigram index on "title" (an explicit word_similarity(...) call cannot).
 */
const TRIGRAM_WORD_THRESHOLD = 0.42;

/** Tokens shorter than this are too noisy for trigram matching. */
const MIN_TRIGRAM_TOKEN_LENGTH = 4;

export type SortOption =
  | "relevance"
  | "newest"
  | "oldest"
  | "closing_soon"
  | "highest_value"
  | "lowest_value"
  | "recently_updated";

export const SORT_OPTIONS: SortOption[] = [
  "relevance",
  "newest",
  "oldest",
  "closing_soon",
  "highest_value",
  "lowest_value",
  "recently_updated",
];

export interface SearchParams {
  /** Free text typed into the search box. */
  q?: string;
  /** Selected keyword chips. Combined with OR. */
  keywords?: string[];
  page?: number;
  limit?: number;
  sort?: SortOption;
  status?: TenderStatus | "ALL";
  fromDate?: string;
  toDate?: string;
  /** Structured filters, all optional. */
  state?: string;
  department?: string;
  organisation?: string;
  category?: string;
  portal?: string;
  portals?: string[];
}

export interface ResolvedSearch {
  page: number;
  limit: number;
  sort: SortOption;
  status: TenderStatus | "ALL";
  textQuery: NormalizedQuery | null;
  keywordQueries: NormalizedQuery[];
  hasSearchTerms: boolean;
  /** Every distinct human-readable term this search covers (for live GeM sync). */
  liveTerms: string[];
  fromDate: Date | null;
  toDate: Date | null;
  filters: Pick<SearchParams, "state" | "department" | "organisation" | "category" | "portal" | "portals">;
  /**
   * Bid numbers in the order GeM's own live search returned them. When present
   * (and sorting by relevance) these keep GeM's ordering; stored-only matches
   * follow, ranked by our relevance score.
   */
  liveOrder?: string[];
}

function parseDate(value?: string): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Turns raw request query params into a validated, normalized search descriptor. */
export function resolveSearch(params: SearchParams): ResolvedSearch {
  const page = Math.max(1, Math.floor(Number(params.page) || 1));
  const limit = Math.min(100, Math.max(1, Math.floor(Number(params.limit) || 20)));

  const rawText = (params.q ?? "").trim();
  const textQuery = rawText.length > 0 ? normalizeQuery(rawText) : null;
  const keywordQueries = normalizeKeywordSelection(params.keywords ?? []);

  const liveTerms = Array.from(
    new Set([...(textQuery ? [textQuery.raw] : []), ...keywordQueries.map((entry) => entry.raw)].filter(Boolean))
  );

  const sort = params.sort && SORT_OPTIONS.includes(params.sort) ? params.sort : "relevance";

  return {
    page,
    limit,
    sort,
    status: params.status ?? TenderStatus.LIVE,
    textQuery: textQuery && textQuery.canonical.length > 0 ? textQuery : null,
    keywordQueries,
    hasSearchTerms: Boolean(textQuery?.canonical) || keywordQueries.length > 0,
    liveTerms,
    fromDate: parseDate(params.fromDate),
    toDate: parseDate(params.toDate),
    filters: {
      state: params.state,
      department: params.department,
      organisation: params.organisation,
      category: params.category,
      portal: params.portal,
      portals: params.portals,
    },
  };
}

/**
 * A short single-word alias has to match on word boundaries.
 *
 * Unanchored substring matching on these produces real false positives: the
 * alias "swir" (short-wave infrared) matched "RELAY SWIRCH PRESSURE HORN" - a
 * misspelling of SWITCH - and pulled a starter-relay tender into the results
 * for "thermal camera". The same hazard applies to "nvg", "lrf", "ptz" and "eo".
 *
 * Phrases longer than this, and anything containing a space, are distinctive
 * enough that substring matching is what users actually want. The cutoff is
 * deliberately 4 rather than 5: it covers the acronyms that misfire while
 * leaving ordinary five-letter words ("drone", "sight", "laser", "night") on
 * substring matching, where they still match inflected forms in tender titles.
 */
const WORD_BOUNDARY_MAX_LENGTH = 4;

interface PhraseMatchers {
  /** `%phrase%` patterns, for ILIKE. */
  like: string[];
  /** `\mword\M` patterns, for a case-insensitive regex match. */
  word: string[];
}

/**
 * Splits alias phrases into substring patterns and word-boundary patterns.
 *
 * Both forms are supported by the GIN trigram indexes - gin_trgm_ops indexes
 * `~*` as well as `ILIKE` - so requiring boundaries costs no index usage.
 */
function phraseMatchers(queries: NormalizedQuery[]): PhraseMatchers {
  const like = new Set<string>();
  const word = new Set<string>();

  for (const query of queries) {
    for (const phrase of query.phrases) {
      // Single very short phrases would match almost anything.
      if (phrase.length < 3) continue;
      if (!phrase.includes(" ") && phrase.length <= WORD_BOUNDARY_MAX_LENGTH) {
        // `s?` so a pluralised acronym ("NVDs", "LRFs") still matches.
        word.add(`\\m${escapeRegex(phrase)}s?\\M`);
      } else {
        like.add(`%${escapeLike(phrase)}%`);
      }
    }
  }

  return { like: Array.from(like).slice(0, MAX_LIKE_PATTERNS), word: Array.from(word).slice(0, MAX_LIKE_PATTERNS) };
}

/** Every phrase matcher as a flat count, used to decide whether a branch is worth emitting. */
function hasMatchers(matchers: PhraseMatchers): boolean {
  return matchers.like.length > 0 || matchers.word.length > 0;
}

/** Predicates testing one column against every matcher. */
function columnPredicates(column: string, matchers: PhraseMatchers): Prisma.Sql[] {
  const reference = Prisma.raw(`t."${column}"`);
  return [
    ...matchers.like.map((pattern) => Prisma.sql`${reference} ILIKE ${pattern}`),
    ...matchers.word.map((pattern) => Prisma.sql`${reference} ~* ${pattern}`),
  ];
}

/** Escapes LIKE wildcards so user input cannot widen the match. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/** Escapes regex metacharacters so user input is matched literally. */
function escapeRegex(value: string): string {
  return value.replace(/[.^$*+?()[\]{}|\\\-]/g, (char) => `\\${char}`);
}

function structuredReference(query: NormalizedQuery): string | null {
  const value = query.raw.trim();
  if (value.length < 8 || value.length > 180) return null;
  if (!/[A-Za-z]/.test(value) || !/\d/.test(value) || !/[\/_-]/.test(value)) return null;
  return value;
}

/**
 * Columns carrying a GIN trigram index, so `ILIKE '%...%'` against them is an
 * index scan rather than a sequential one. See the search migration.
 */
const TRIGRAM_INDEXED_COLUMNS = ["title", "keywordMatched", "organisation", "department"] as const;

/**
 * Hard cap on alias patterns per query. Each pattern becomes its own index scan
 * inside a BitmapOr; unbounded expansion would turn one keystroke into hundreds.
 */
const MAX_LIKE_PATTERNS = 24;

/**
 * OR-ed `ILIKE` tests, one bound pattern at a time.
 *
 * Deliberately NOT `ILIKE ANY(array)`: the ANY form cannot use a trigram index,
 * so PostgreSQL degrades to filtering every LIVE row (measured at ~1.7s on this
 * corpus). Expanded into individual comparisons the planner builds a BitmapOr of
 * index scans instead, for the same results in ~40ms.
 */
function ilikeAnyColumn(matchers: PhraseMatchers): Prisma.Sql | null {
  if (!hasMatchers(matchers)) return null;

  // NULL ILIKE '...' is NULL, which an OR treats as false - exactly the
  // behaviour COALESCE(col,'') would give, but without blocking the index.
  const comparisons = TRIGRAM_INDEXED_COLUMNS.flatMap((column) => columnPredicates(column, matchers));
  if (comparisons.length === 0) return null;

  return Prisma.sql`(${Prisma.join(comparisons, " OR ")})`;
}

/**
 * "Does this row match this one query" predicate.
 *
 * A row matches when any of these hold:
 *   - the query looks like a bid number and "tenderId" contains it;
 *   - the full-text vector satisfies the query's tsquery (prefix matched,
 *     alias phrases OR-ed in);
 *   - an alias phrase appears in any searchable field;
 *   - *every* long token of the query trigram-matches the title (typo tolerance).
 *
 * The trigram branch deliberately AND-s its tokens. OR-ing them is what turns
 * trigram matching into a broad fallback that drags in unrelated tenders.
 *
 * Every value is bound as a parameter - nothing is string-interpolated.
 */
function buildQueryCondition(query: NormalizedQuery): Prisma.Sql | null {
  const clauses: Prisma.Sql[] = [];
  const reference = structuredReference(query);

  if (query.bidNumber) {
    clauses.push(Prisma.sql`t."tenderId" ILIKE ${`%${escapeLike(query.bidNumber)}%`}`);
  }
  if (reference) {
    const pattern = `%${escapeLike(reference)}%`;
    clauses.push(
      Prisma.sql`(t."tenderId" ILIKE ${pattern} OR t."description" ILIKE ${pattern} OR t."title" ILIKE ${pattern})`
    );
  }

  const tsQuery = buildTsQuery(query);
  if (tsQuery) {
    clauses.push(Prisma.sql`t."searchVector" @@ to_tsquery('english', ${tsQuery})`);
  }

  // Substring matching over the trigram-indexed columns. category, state,
  // location and description are not repeated here - they are all covered by
  // "searchVector", so ILIKE-ing them adds cost without adding results.
  const likeCondition = ilikeAnyColumn(phraseMatchers([query]));
  if (likeCondition) clauses.push(likeCondition);

  const trigram = trigramTokens(query).filter((token) => token.length >= MIN_TRIGRAM_TOKEN_LENGTH);
  if (trigram.length > 0) {
    const perToken = trigram.map((token) => Prisma.sql`t."title" %> ${token}`);
    clauses.push(Prisma.sql`(${Prisma.join(perToken, " AND ")})`);
  }

  if (clauses.length === 0) return null;
  return Prisma.sql`(${Prisma.join(clauses, " OR ")})`;
}

/**
 * Builds the "does this row match" predicate for one group of queries.
 * Within a group the queries are OR-ed (that is the chip behaviour); the caller
 * AND-s groups together.
 */
function buildMatchCondition(queries: NormalizedQuery[]): Prisma.Sql | null {
  const conditions = queries
    .map(buildQueryCondition)
    .filter((condition): condition is Prisma.Sql => condition !== null);

  if (conditions.length === 0) return null;
  return Prisma.sql`(${Prisma.join(conditions, " OR ")})`;
}

/**
 * The same match rules as `buildQueryCondition`, but split into one predicate
 * per usable index instead of a single OR.
 *
 * This split is what makes search fast. PostgreSQL will only use an index for
 * an OR when every branch of that OR hits the *same* index, so the combined
 * predicate - which mixes "searchVector", four trigram columns and the `%>`
 * operator - planned as a Parallel Seq Scan over every LIVE row, re-evaluating
 * ~70 ILIKE tests per row (measured: 3.2s for "thermal camera"). Emitting the
 * branches separately and UNION-ing their id sets lets each one use its own
 * index. Semantics are identical: a UNION of the branches is exactly the set
 * the OR described.
 *
 * Note the per-column ILIKE groups stay OR-ed together *within* one column, so
 * the planner can still build a BitmapOr over that column's trigram index.
 */
function buildQueryBranches(query: NormalizedQuery): Prisma.Sql[] {
  const branches: Prisma.Sql[] = [];
  const reference = structuredReference(query);

  if (query.bidNumber) {
    branches.push(Prisma.sql`t."tenderId" ILIKE ${`%${escapeLike(query.bidNumber)}%`}`);
  }
  if (reference) {
    const pattern = `%${escapeLike(reference)}%`;
    branches.push(Prisma.sql`t."tenderId" ILIKE ${pattern}`);
    branches.push(Prisma.sql`t."description" ILIKE ${pattern}`);
    branches.push(Prisma.sql`t."title" ILIKE ${pattern}`);
  }

  const tsQuery = buildTsQuery(query);
  if (tsQuery) {
    branches.push(Prisma.sql`t."searchVector" @@ to_tsquery('english', ${tsQuery})`);
  }

  const matchers = phraseMatchers([query]);
  if (hasMatchers(matchers)) {
    for (const column of TRIGRAM_INDEXED_COLUMNS) {
      const comparisons = columnPredicates(column, matchers);
      if (comparisons.length > 0) branches.push(Prisma.sql`(${Prisma.join(comparisons, " OR ")})`);
    }
  }

  const trigram = trigramTokens(query).filter((token) => token.length >= MIN_TRIGRAM_TOKEN_LENGTH);
  if (trigram.length > 0) {
    const perToken = trigram.map((token) => Prisma.sql`t."title" %> ${token}`);
    branches.push(Prisma.sql`(${Prisma.join(perToken, " AND ")})`);
  }

  return branches;
}

/** Every branch across a group of queries. The group's queries are OR-ed, so their branches simply pool. */
function buildMatchBranches(queries: NormalizedQuery[]): Prisma.Sql[] {
  return queries.flatMap(buildQueryBranches);
}

/**
 * Relevance score, highest first:
 *   exact bid number > bid number fragment > exact phrase in title >
 *   alias phrase in title > keyword tag > organisation/department/category/
 *   state/location > description > full-text rank > trigram similarity.
 *
 * Only evaluated for rows that already passed the WHERE clause, so the
 * non-indexable similarity() call here costs nothing measurable.
 */
function buildScoreExpression(queries: NormalizedQuery[]): Prisma.Sql {
  if (queries.length === 0) return Prisma.sql`0::double precision`;

  const matchers = phraseMatchers(queries);
  const titlePhrases = queries.map((query) => query.canonical).filter(Boolean);
  const tsQuery = queries
    .map(buildTsQuery)
    .filter(Boolean)
    .join(" | ");
  const bidNumbers = queries.map((query) => query.bidNumber).filter((value): value is string => Boolean(value));
  const references = queries.map(structuredReference).filter((value): value is string => Boolean(value));

  const parts: Prisma.Sql[] = [];

  if (bidNumbers.length > 0) {
    parts.push(
      Prisma.sql`CASE WHEN upper(t."tenderId") = ANY(${bidNumbers.map((bid) => bid.toUpperCase())}::text[]) THEN 10000 ELSE 0 END`
    );
    const bidPatterns = bidNumbers.map((bid) => `%${escapeLike(bid)}%`);
    parts.push(Prisma.sql`CASE WHEN t."tenderId" ILIKE ANY(${bidPatterns}::text[]) THEN 4000 ELSE 0 END`);
  }
  if (references.length > 0) {
    const referencePatterns = references.map((reference) => `%${escapeLike(reference)}%`);
    parts.push(
      Prisma.sql`CASE WHEN t."tenderId" ILIKE ANY(${referencePatterns}::text[]) THEN 9000 ELSE 0 END`
    );
    parts.push(
      Prisma.sql`CASE WHEN t."description" ILIKE ANY(${referencePatterns}::text[]) THEN 7000 ELSE 0 END`
    );
    parts.push(
      Prisma.sql`CASE WHEN t."title" ILIKE ANY(${referencePatterns}::text[]) THEN 6000 ELSE 0 END`
    );
  }

  if (titlePhrases.length > 0) {
    const exactTitlePatterns = titlePhrases.map((phrase) => `%${escapeLike(phrase)}%`);
    parts.push(Prisma.sql`CASE WHEN t."title" ILIKE ANY(${exactTitlePatterns}::text[]) THEN 1200 ELSE 0 END`);
  }

  // Every column that can put a row into the result set must also be able to
  // score it. A matched row scoring 0 falls through to the closing-date
  // tiebreaker and surfaces above genuinely relevant results.
  if (hasMatchers(matchers)) {
    const scoreFor = (column: string) => Prisma.join(columnPredicates(column, matchers), " OR ");

    parts.push(Prisma.sql`CASE WHEN ${scoreFor("title")} THEN 600 ELSE 0 END`);
    parts.push(Prisma.sql`CASE WHEN ${scoreFor("keywordMatched")} THEN 300 ELSE 0 END`);
    parts.push(
      Prisma.sql`CASE WHEN ${scoreFor("organisation")} OR ${scoreFor("department")} THEN 150 ELSE 0 END`
    );
    // category / state / location / description are not re-tested here: they are
    // all in "searchVector" with their own weights - title A, organisation and
    // department B, state/category/location C, description D - so ts_rank below
    // already ranks them. Scanning them again (especially the long description
    // text) cost ~1s per search on the live corpus and changed no orderings.
  }

  if (tsQuery) {
    parts.push(Prisma.sql`(ts_rank(t."searchVector", to_tsquery('english', ${tsQuery})) * 200)`);
  }

  for (const canonical of titlePhrases) {
    if (canonical.length < MIN_TRIGRAM_TOKEN_LENGTH) continue;
    parts.push(Prisma.sql`(word_similarity(${canonical}, t."title") * 100)`);
  }

  if (parts.length === 0) return Prisma.sql`0::double precision`;
  return Prisma.sql`(${Prisma.join(parts, " + ")})::double precision`;
}

/** Structured (non-text) filters shared by search and count. */
function buildFilterConditions(search: ResolvedSearch): Prisma.Sql[] {
  const conditions: Prisma.Sql[] = [];

  if (search.status !== "ALL") {
    conditions.push(Prisma.sql`t."tenderStatus" = ${search.status}::"TenderStatus"`);
  }
  if (search.filters.state) {
    conditions.push(Prisma.sql`t."state" ILIKE ${search.filters.state}`);
  }
  if (search.filters.department) {
    conditions.push(Prisma.sql`t."department" ILIKE ${`%${escapeLike(search.filters.department)}%`}`);
  }
  if (search.filters.organisation) {
    conditions.push(Prisma.sql`t."organisation" ILIKE ${`%${escapeLike(search.filters.organisation)}%`}`);
  }
  if (search.filters.category) {
    conditions.push(Prisma.sql`t."category" ILIKE ${`%${escapeLike(search.filters.category)}%`}`);
  }
  const portals = Array.from(
    new Set([...(search.filters.portals ?? []), ...(search.filters.portal ? [search.filters.portal] : [])])
  );
  if (portals.length > 0) {
    conditions.push(Prisma.sql`t."portal" = ANY(${portals}::text[])`);
  }
  if (search.fromDate) {
    conditions.push(Prisma.sql`COALESCE(t."publishedDate", t."createdAt") >= ${search.fromDate}`);
  }
  if (search.toDate) {
    conditions.push(Prisma.sql`COALESCE(t."publishedDate", t."createdAt") <= ${search.toDate}`);
  }

  return conditions;
}

export function buildWhereClause(search: ResolvedSearch): Prisma.Sql {
  const conditions = buildFilterConditions(search);

  // Typed text and selected chips are separate groups. Chips OR among
  // themselves; the typed text must also match when both are supplied.
  const textCondition = search.textQuery ? buildMatchCondition([search.textQuery]) : null;
  const keywordCondition = buildMatchCondition(search.keywordQueries);

  if (textCondition) conditions.push(textCondition);
  if (keywordCondition) conditions.push(keywordCondition);

  if (conditions.length === 0) return Prisma.sql`TRUE`;
  return Prisma.join(conditions, " AND ");
}

/**
 * Sort order for a page of results.
 *
 * Every branch ends with "tenderId" as a tiebreaker. Without it, ties on the
 * sort column (thousands of GeM bids share a publishing date) leave the row
 * order undefined, so PostgreSQL is free to return the same row on page 1 and
 * page 2 - pagination silently duplicates and skips results.
 */
function buildOrderClause(search: ResolvedSearch): Prisma.Sql {
  const tiebreaker = Prisma.sql`t."portal" ASC, t."tenderId" ASC`;

  switch (search.sort) {
    case "oldest":
      return Prisma.sql`t."publishedDate" ASC NULLS LAST, ${tiebreaker}`;
    case "closing_soon":
      return Prisma.sql`t."closingDate" ASC NULLS LAST, ${tiebreaker}`;
    case "highest_value":
      return Prisma.sql`t."estimatedValue" DESC NULLS LAST, ${tiebreaker}`;
    case "lowest_value":
      return Prisma.sql`t."estimatedValue" ASC NULLS LAST, ${tiebreaker}`;
    case "recently_updated":
      return Prisma.sql`t."lastUpdated" DESC NULLS LAST, ${tiebreaker}`;
    case "newest":
      return Prisma.sql`t."publishedDate" DESC NULLS LAST, ${tiebreaker}`;
    case "relevance":
    default: {
      // Relevance first, then soonest closing so actionable bids float up.
      const relevance = Prisma.sql`score DESC, t."closingDate" ASC NULLS LAST, t."publishedDate" DESC NULLS LAST, ${tiebreaker}`;
      if (!search.liveOrder || search.liveOrder.length === 0) return relevance;
      // GeM's live ordering wins for the bids GeM itself returned.
      return Prisma.sql`COALESCE(array_position(${search.liveOrder}::text[], t."tenderId"), 2147483647) ASC, ${relevance}`;
    }
  }
}

export interface SearchRow {
  id: string;
  tenderId: string;
  portal: string;
  title: string;
  organisation: string | null;
  department: string | null;
  location: string | null;
  state: string | null;
  category: string | null;
  description: string | null;
  estimatedValue: Prisma.Decimal | null;
  emdAmount: Prisma.Decimal | null;
  tenderFee: Prisma.Decimal | null;
  publishedDate: Date | null;
  closingDate: Date | null;
  openingDate: Date | null;
  keywordMatched: string | null;
  tenderStatus: TenderStatus;
  tenderURL: string;
  documentURL: string | null;
  createdAt: Date;
  updatedAt: Date;
  lastUpdated: Date;
  lastSeenAt: Date | null;
  score: number;
}

export interface SearchResult {
  rows: SearchRow[];
  totalItems: number;
}

/**
 * The set of candidate row ids, as an index-friendly id-only query.
 *
 * Typed text and selected chips are separate groups: chips OR among themselves,
 * and typed text must also match when both are supplied. That maps onto set
 * operations directly - UNION within a group, INTERSECT between them - which
 * keeps each branch on its own index instead of collapsing into one
 * unindexable OR.
 */
function buildCandidateQuery(
  textBranches: Prisma.Sql[],
  keywordBranches: Prisma.Sql[],
  filterClause: Prisma.Sql
): Prisma.Sql {
  const groupQuery = (branches: Prisma.Sql[]): Prisma.Sql =>
    Prisma.join(
      branches.map((branch) => Prisma.sql`SELECT t."id" FROM "tenders" t WHERE ${filterClause} AND ${branch}`),
      " UNION "
    );

  if (textBranches.length === 0 && keywordBranches.length === 0) {
    return Prisma.sql`SELECT t."id" FROM "tenders" t WHERE ${filterClause}`;
  }
  if (keywordBranches.length === 0) return groupQuery(textBranches);
  if (textBranches.length === 0) return groupQuery(keywordBranches);

  return Prisma.sql`(${groupQuery(textBranches)}) INTERSECT (${groupQuery(keywordBranches)})`;
}

/**
 * Runs the ranked search.
 *
 * Three phases, because doing it in one pass was the whole performance problem:
 *   1. Collect matching ids through per-index UNION branches (see
 *      `buildQueryBranches`).
 *   2. Score, sort and paginate over *narrow* rows - ids and sort keys only.
 *      The previous version selected every column, including `description`,
 *      for all ~48k matches and sorted that twice before applying LIMIT.
 *   3. Fetch full rows for just the ids on the requested page.
 *
 * Deduplication is structural: `(portal, tenderId)` is UNIQUE and UNION already
 * removes duplicate ids, so no DISTINCT pass is needed.
 *
 * Wrapped in a transaction so `set_config(..., is_local => true)` can lower
 * pg_trgm's word_similarity threshold without leaking onto a pooled connection.
 * Every value is bound as a parameter.
 */
export async function runSearch(search: ResolvedSearch): Promise<SearchResult> {
  const allQueries = [...(search.textQuery ? [search.textQuery] : []), ...search.keywordQueries];
  const scoreExpression = buildScoreExpression(allQueries);
  const orderClause = buildOrderClause(search);
  const offset = (search.page - 1) * search.limit;

  const filters = buildFilterConditions(search);
  const filterClause = filters.length > 0 ? Prisma.join(filters, " AND ") : Prisma.sql`TRUE`;
  const candidateQuery = buildCandidateQuery(
    search.textQuery ? buildMatchBranches([search.textQuery]) : [],
    buildMatchBranches(search.keywordQueries),
    filterClause
  );

  const { pageRows, totalItems } = await prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT set_config('pg_trgm.word_similarity_threshold', ${String(TRIGRAM_WORD_THRESHOLD)}, true)`;

      // Phase 1 + 2. COUNT(*) OVER () takes the pre-LIMIT total from the same
      // pass, so the match set is never evaluated twice.
      const ranked = await tx.$queryRaw<Array<{ id: string; score: number; totalItems: bigint }>>`
        WITH candidates AS (${candidateQuery}),
        ranked AS (
          SELECT
            t."id", t."portal", t."tenderId", t."closingDate", t."publishedDate",
            t."estimatedValue", t."lastUpdated",
            ${scoreExpression} AS score
          FROM "tenders" t
          JOIN candidates c ON c."id" = t."id"
        )
        SELECT t."id", t."score", COUNT(*) OVER ()::bigint AS "totalItems"
        FROM ranked t
        ORDER BY ${orderClause}
        LIMIT ${search.limit} OFFSET ${offset}
      `;

      if (ranked.length === 0) {
        const counted = await tx.$queryRaw<{ count: bigint }[]>`
          SELECT COUNT(*)::bigint AS count FROM (${candidateQuery}) c
        `;
        return { pageRows: [], totalItems: Number(counted[0]?.count ?? 0) };
      }

      // Phase 3: full rows for this page only - at most `limit` primary key lookups.
      const ids = ranked.map((row) => row.id);
      const rows = await tx.$queryRaw<Array<Omit<SearchRow, "score">>>`
        SELECT
          t."id", t."tenderId", t."portal", t."title", t."organisation", t."department",
          t."location", t."state", t."category", t."description",
          t."estimatedValue", t."emdAmount", t."tenderFee",
          t."publishedDate", t."closingDate", t."openingDate",
          t."keywordMatched", t."tenderStatus", t."tenderURL", t."documentURL",
          t."createdAt", t."updatedAt", t."lastUpdated", t."lastSeenAt"
        FROM "tenders" t
        WHERE t."id" = ANY(${ids}::text[])
      `;

      // Restore the ranked order the id query established.
      const scoreById = new Map(ranked.map((row) => [row.id, Number(row.score)]));
      const byId = new Map(rows.map((row) => [row.id, row]));
      const pageRows = ids
        .map((id) => {
          const row = byId.get(id);
          return row ? { ...row, score: scoreById.get(id) ?? 0 } : null;
        })
        .filter((row): row is SearchRow => row !== null);

      return { pageRows, totalItems: Number(ranked[0].totalItems) };
    },
    { timeout: config.requestTimeoutMs, maxWait: 5_000 }
  );

  return { rows: pageRows, totalItems };
}

/**
 * Total matches for a page that returned no rows, so pagination past the end
 * still reports the real total instead of zero.
 */
async function countMatches(whereClause: Prisma.Sql): Promise<number> {
  const rows = await prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT set_config('pg_trgm.word_similarity_threshold', ${String(TRIGRAM_WORD_THRESHOLD)}, true)`;
      return tx.$queryRaw<{ count: bigint }[]>`
        SELECT COUNT(DISTINCT (t."portal", t."tenderId"))::bigint AS count FROM "tenders" t WHERE ${whereClause}
      `;
    },
    { timeout: config.requestTimeoutMs, maxWait: 5_000 }
  );
  return Number(rows[0]?.count ?? 0);
}

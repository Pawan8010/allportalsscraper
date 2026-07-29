import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { expandAliases } from "./searchAliases";

export interface SearchParams {
  q?: string;
  portal?: string;
  portals?: string[];
  keywords?: string[];
  status?: string;
  page?: number;
  limit?: number;
  fromDate?: string;
  toDate?: string;
}

export interface SearchResultRow {
  id: string;
  portal: string;
  portalName: string;
  tenderId: string;
  title: string;
  organisation: string | null;
  department: string | null;
  state: string | null;
  category: string | null;
  status: string | null;
  publishedDate: Date | null;
  closingDate: Date | null;
  tenderURL: string;
  rank: number;
}

/**
 * Normalises a raw query string: Unicode NFKC, lowercase, whitespace
 * collapse, and light punctuation stripping (keeps alphanumerics and a few
 * separators that are meaningful inside reference numbers, e.g. "/", "-").
 */
export function normalizeQuery(raw: string): string {
  return raw
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s/\-.]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function searchTenders(params: SearchParams) {
  const page = Math.max(1, params.page ?? 1);
  const limit = Math.min(100, Math.max(1, params.limit ?? 20));
  const offset = (page - 1) * limit;

  const portalFilter: string[] = params.portals?.length
    ? params.portals
    : params.portal
    ? [params.portal]
    : [];

  // A tender past its own closing date is no longer something anyone can
  // act on -- never surfaced in browse or search results, regardless of
  // what else is filtered on. Tenders with no known closing date (a real
  // gap on some portals) are kept rather than guessed away.
  const conditions: Prisma.Sql[] = [Prisma.sql`("closingDate" IS NULL OR "closingDate" >= NOW())`];
  if (portalFilter.length > 0) {
    conditions.push(Prisma.sql`portal IN (${Prisma.join(portalFilter)})`);
  }
  if (params.status) {
    conditions.push(Prisma.sql`status = ${params.status}`);
  }
  if (params.fromDate) {
    conditions.push(Prisma.sql`"closingDate" >= ${new Date(params.fromDate)}`);
  }
  if (params.toDate) {
    conditions.push(Prisma.sql`"closingDate" <= ${new Date(params.toDate)}`);
  }

  const rawTerms = [params.q, ...(params.keywords ?? [])].filter(Boolean) as string[];

  if (rawTerms.length === 0) {
    // No search text: plain filtered listing, newest first. Never falls
    // back to "everything" silently mislabelled as a search result — this
    // is an explicit browse, not a search match.
    const where = conditions.length > 0 ? Prisma.sql`WHERE ${Prisma.join(conditions, " AND ")}` : Prisma.sql``;
    // COUNT(*) OVER() rides along with the same scan that fetches the page
    // of rows, instead of a second full-table COUNT(*) query repeating the
    // same predicate -- one scan instead of two, which matters once the
    // table holds 100k+ rows.
    const rows = await prisma.$queryRaw<(SearchResultRow & { total_count: bigint })[]>(Prisma.sql`
      SELECT id, portal, "portalName", "tenderId", title, organisation, department, state, category, status, "publishedDate", "closingDate", "tenderURL",
        0 AS rank, COUNT(*) OVER() AS total_count
      FROM "Tender"
      ${where}
      ORDER BY "publishedDate" DESC NULLS LAST
      OFFSET ${offset} LIMIT ${limit}
    `);
    const total = rows.length > 0 ? Number(rows[0].total_count) : 0;
    return { rows: rows.map(({ total_count: _total_count, ...row }) => row), total };
  }

  const normalized = normalizeQuery(rawTerms.join(" "));
  const expanded = expandAliases(normalized);
  const tsQuery = expanded.map((t) => t.split(" ").filter(Boolean).join(" & ")).join(" | ");

  // Ranking, highest priority first:
  //   1. exact tenderId match
  //   2. exact title phrase match
  //   3. ts_rank on title/org/dept (full-text)
  //   4. trigram similarity (fuzzy -- only included for the tier-2 fallback
  //      below; computing similarity() per row is real per-row CPU cost
  //      (measured ~30% of total query time on a broad term), so tier 1
  //      skips it entirely rather than ranking by a signal it doesn't use)
  async function runRanked(extraCondition: Prisma.Sql, includeSimilarity: boolean) {
    const searchConditions = [...conditions, extraCondition];
    const where = Prisma.sql`WHERE ${Prisma.join(searchConditions, " AND ")}`;
    const similarityTerm = includeSimilarity
      ? Prisma.sql`+ COALESCE(similarity(title, ${normalized}), 0) * 10`
      : Prisma.sql``;
    const rows = await prisma.$queryRaw<(SearchResultRow & { total_count: bigint })[]>(Prisma.sql`
      SELECT id, portal, "portalName", "tenderId", title, organisation, department, state, category, status, "publishedDate", "closingDate", "tenderURL",
        (
          CASE WHEN lower("tenderId") = ${normalized} THEN 1000 ELSE 0 END +
          CASE WHEN lower(title) = ${normalized} THEN 500 ELSE 0 END +
          CASE WHEN "tenderId" ILIKE ${normalized + "%"} THEN 200 ELSE 0 END +
          COALESCE(ts_rank(search_vector, to_tsquery('english', ${tsQuery})), 0) * 100
          ${similarityTerm}
        ) AS rank,
        COUNT(*) OVER() AS total_count
      FROM "Tender"
      ${where}
      ORDER BY rank DESC, "publishedDate" DESC NULLS LAST
      OFFSET ${offset} LIMIT ${limit}
    `);
    const total = rows.length > 0 ? Number(rows[0].total_count) : 0;
    return { rows: rows.map(({ total_count: _total_count, ...row }) => row), total };
  }

  // Tier 1: ILIKE-prefix + full-text only. Both conditions are backed by a
  // GIN index and stay fast (tens of ms for typical multi-word queries) even
  // on a 100k+ row table because the planner can use a Bitmap Index Scan for
  // either branch of the OR. This covers the overwhelming majority of real
  // searches.
  const fast = await runRanked(
    Prisma.sql`(
      "tenderId" ILIKE ${normalized + "%"} OR
      search_vector @@ to_tsquery('english', ${tsQuery})
    )`,
    false
  );
  if (fast.total > 0) return fast;

  // Tier 2 (fallback only): trigram fuzzy match for typo tolerance. This
  // condition alone accounts for the large majority of search cost -- a
  // plain function-call predicate never uses the trigram GIN index, and
  // even OR-ed in via the indexed `%` operator its broad selectivity often
  // pushes the planner to a sequential scan (measured 700ms-4.5s on this
  // table for common terms). Running it only when tier 1 found nothing
  // keeps the expensive path rare instead of paying it on every keystroke.
  return runRanked(
    Prisma.sql`(
      "tenderId" ILIKE ${normalized + "%"} OR
      search_vector @@ to_tsquery('english', ${tsQuery}) OR
      similarity(title, ${normalized}) > 0.2
    )`,
    true
  );
}

export async function getPortalCounts(): Promise<Record<string, number>> {
  const rows = await prisma.$queryRaw<{ portal: string; count: bigint }[]>(Prisma.sql`
    SELECT portal, COUNT(*)::bigint AS count FROM "Tender" GROUP BY portal
  `);
  const out: Record<string, number> = {};
  for (const r of rows) out[r.portal] = Number(r.count);
  return out;
}

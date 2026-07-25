import { Request, Response, NextFunction } from "express";
import { TenderStatus } from "@prisma/client";
import { resolveSearch, runSearch, SearchParams, SortOption, SORT_OPTIONS } from "../services/searchService";
import { getLiveSearchStatus } from "../services/liveSearchService";

/** Reads a query param that may arrive as a string, a repeated key, or absent. */
function stringParam(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  return undefined;
}

/**
 * Keyword chips arrive either repeated (`keywords=a&keywords=b`) or as a single
 * comma-separated value. Both are accepted; `||` is also tolerated because an
 * earlier version of the UI packed chips that way.
 */
function listParam(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : value === undefined ? [] : [value];
  return raw
    .filter((entry): entry is string => typeof entry === "string")
    .flatMap((entry) => entry.split(/\|\||,/))
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function statusParam(value: unknown): TenderStatus | "ALL" | undefined {
  const raw = stringParam(value);
  if (!raw) return undefined;
  const upper = raw.toUpperCase();
  if (upper === "ALL") return "ALL";
  if ((Object.values(TenderStatus) as string[]).includes(upper)) return upper as TenderStatus;
  return undefined;
}

function sortParam(value: unknown): SortOption | undefined {
  const raw = stringParam(value);
  if (!raw) return undefined;
  return SORT_OPTIONS.includes(raw as SortOption) ? (raw as SortOption) : undefined;
}

function parseSearchParams(req: Request): SearchParams {
  const query = req.query;
  return {
    q: stringParam(query.q),
    keywords: listParam(query.keywords),
    // `limit` is the documented name; `pageSize` is accepted as an alias.
    page: stringParam(query.page) ? Number(stringParam(query.page)) : undefined,
    limit: Number(stringParam(query.limit) ?? stringParam(query.pageSize)) || undefined,
    sort: sortParam(query.sort),
    status: statusParam(query.status),
    fromDate: stringParam(query.fromDate),
    toDate: stringParam(query.toDate),
    state: stringParam(query.state),
    department: stringParam(query.department),
    organisation: stringParam(query.organisation),
    category: stringParam(query.category),
    portal: stringParam(query.portal),
    portals: listParam(query.portals),
  };
}

/**
 * GET /api/tenders/search
 *
 * Served entirely from PostgreSQL so it stays fast enough to run on every
 * keystroke. When live GeM sync is enabled it is consulted only through its
 * cache: a stale term schedules a background refresh and this request still
 * returns immediately.
 */
export async function searchTenders(req: Request, res: Response, next: NextFunction) {
  try {
    const params = parseSearchParams(req);
    const search = resolveSearch(params);
    const requestedPortals = Array.from(
      new Set([...(params.portals ?? []), ...(params.portal ? [params.portal] : [])])
    );
    const includeGemLive = requestedPortals.length === 0 || requestedPortals.includes("GeM");
    const live = getLiveSearchStatus(includeGemLive ? search.liveTerms : []);

    const { rows, totalItems } = await runSearch({
      ...search,
      liveOrder: live.orderedTenderIds,
    });

    // `score` is an internal ranking signal - exposed under meta, not per row.
    const data = rows.map(({ score, ...tender }) => tender);
    const topScore = rows.length > 0 ? rows[0].score : null;

    res.json({
      data,
      total: totalItems,
      pagination: {
        page: search.page,
        limit: search.limit,
        pageSize: search.limit,
        totalItems,
        totalPages: Math.max(1, Math.ceil(totalItems / search.limit)),
        hasNextPage: search.page * search.limit < totalItems,
        hasPreviousPage: search.page > 1,
      },
      source: live.state === "fresh" ? "postgres+live-gem" : "postgres",
      searchedAt: new Date().toISOString(),
      meta: {
        query: search.textQuery?.raw ?? null,
        normalizedQuery: search.textQuery?.canonical ?? null,
        keywords: search.keywordQueries.map((entry) => entry.raw),
        /** Alias phrases the query was expanded to - useful for debugging relevance. */
        expandedPhrases: Array.from(
          new Set([...(search.textQuery?.phrases ?? []), ...search.keywordQueries.flatMap((entry) => entry.phrases)])
        ),
        bidNumber: search.textQuery?.bidNumber ?? null,
        sort: search.sort,
        status: search.status,
        topScore,
        live: {
          state: live.state,
          gemStatedTotal: live.gemStatedTotal,
          syncedAt: live.syncedAt,
          terms: live.terms,
        },
      },
    });
  } catch (err) {
    next(err);
  }
}

import { ChevronLeft, ChevronRight } from "lucide-react";

interface PaginationProps {
  page: number;
  totalPages: number;
  total: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  disabled?: boolean;
}

/**
 * Always shows page 1, the last page, and a small window around the
 * current page, collapsing any gap into a single "…" -- so page 500 of
 * 5000 renders "1 … 498 499 500 501 502 … 5000" instead of 5000 buttons.
 */
function pageWindow(page: number, totalPages: number): (number | "ellipsis")[] {
  const pages = new Set<number>([1, totalPages, page - 2, page - 1, page, page + 1, page + 2]);
  const sorted = [...pages].filter((p) => p >= 1 && p <= totalPages).sort((a, b) => a - b);

  const result: (number | "ellipsis")[] = [];
  let prev: number | null = null;
  for (const p of sorted) {
    if (prev !== null && p - prev > 1) result.push("ellipsis");
    result.push(p);
    prev = p;
  }
  return result;
}

export default function Pagination({ page, totalPages, total, pageSize, onPageChange, disabled }: PaginationProps) {
  if (totalPages <= 1) return null;

  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  const windowed = pageWindow(page, totalPages);

  return (
    <div className="pagination">
      <div className="pagination-summary">
        Showing <strong>{from.toLocaleString("en-IN")}</strong>–<strong>{to.toLocaleString("en-IN")}</strong> of{" "}
        <strong>{total.toLocaleString("en-IN")}</strong> results
      </div>
      <div className="pagination-controls">
        <button
          className="btn small secondary"
          disabled={disabled || page <= 1}
          onClick={() => onPageChange(page - 1)}
          aria-label="Previous page"
        >
          <ChevronLeft size={13} />
          Previous
        </button>

        <div className="pagination-pages">
          {windowed.map((p, i) =>
            p === "ellipsis" ? (
              <span key={`e${i}`} className="pagination-ellipsis">
                …
              </span>
            ) : (
              <button
                key={p}
                className={`pagination-page ${p === page ? "active" : ""}`}
                disabled={disabled}
                onClick={() => onPageChange(p)}
                aria-current={p === page ? "page" : undefined}
              >
                {p}
              </button>
            )
          )}
        </div>

        <button
          className="btn small secondary"
          disabled={disabled || page >= totalPages}
          onClick={() => onPageChange(page + 1)}
          aria-label="Next page"
        >
          Next
          <ChevronRight size={13} />
        </button>
      </div>
      <div className="pagination-jump">
        Page {page} of {totalPages.toLocaleString("en-IN")}
      </div>
    </div>
  );
}

/** A single shimmering placeholder bar. Width/height are plain CSS values. */
export function SkeletonBar({ width = "100%", height = 14 }: { width?: string | number; height?: number }) {
  return <span className="skeleton-bar" style={{ width, height }} />;
}

/** Placeholder shaped like one TenderCard, for the results list while loading. */
export function SkeletonTenderCard() {
  return (
    <div className="tender-card skeleton-card">
      <div className="tender-card-top">
        <SkeletonBar width="70%" height={16} />
        <SkeletonBar width={90} height={20} />
      </div>
      <div style={{ marginTop: 10, display: "flex", gap: 14 }}>
        <SkeletonBar width={110} height={12} />
        <SkeletonBar width={140} height={12} />
        <SkeletonBar width={160} height={12} />
      </div>
    </div>
  );
}

export function SkeletonTenderList({ count = 5 }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <SkeletonTenderCard key={i} />
      ))}
    </>
  );
}

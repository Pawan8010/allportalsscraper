import { PortalSummary } from "@/lib/api";

interface Props {
  portals: PortalSummary[];
  selected: string[];
  onChange: (keys: string[]) => void;
}

export default function PortalFilter({ portals, selected, onChange }: Props) {
  function toggle(key: string) {
    if (selected.includes(key)) onChange(selected.filter((k) => k !== key));
    else onChange([...selected, key]);
  }

  return (
    <div>
      <div className="section-title">Portals</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <button
          className={`chip ${selected.length === 0 ? "active" : ""}`}
          onClick={() => onChange([])}
          type="button"
        >
          All portals
        </button>
        {portals.map((p) => (
          <button
            key={p.key}
            type="button"
            className={`chip ${selected.includes(p.key) ? "active" : ""}`}
            onClick={() => toggle(p.key)}
            title={p.enabled ? p.name : `${p.name} (disabled)`}
          >
            {p.name}
            {!p.enabled && <span style={{ opacity: 0.6 }}>&nbsp;(off)</span>}
          </button>
        ))}
      </div>
    </div>
  );
}

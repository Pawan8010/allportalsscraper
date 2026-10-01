import { useEffect, useState } from "react";
import { Search, Radar, CheckCircle2 } from "lucide-react";

const DEMO_QUERY = "Thermal Weapon Sight";
const DEMO_RESULTS = [
  { portal: "GeM", title: "Procurement of Thermal Weapon Sight for infantry battalions" },
  { portal: "Defence eProcurement", title: "Supply of Thermal Weapon Sight, uncooled detector" },
  { portal: "Ordnance Factory Board", title: "Thermal Weapon Sight — night operations, batch tender" },
];
const TYPE_SPEED_MS = 85;
const HOLD_AFTER_TYPE_MS = 500;
const RESULT_STAGGER_MS = 550;
const HOLD_END_MS = 2600;
const RESET_PAUSE_MS = 500;

/**
 * A scripted, looping recreation of the search flow -- typed query, results
 * fading in one by one, portal chip highlighting -- standing in for an
 * actual product-demo video (fake data throughout, purely illustrative).
 */
export default function DemoShowcase() {
  const [typedLength, setTypedLength] = useState(0);
  const [visibleResults, setVisibleResults] = useState(0);
  const [chipActive, setChipActive] = useState(false);

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    let cancelled = false;

    function schedule(fn: () => void, delay: number) {
      const id = setTimeout(() => {
        if (!cancelled) fn();
      }, delay);
      timers.push(id);
      return id;
    }

    function runCycle() {
      setTypedLength(0);
      setVisibleResults(0);
      setChipActive(false);

      // Type the query one character at a time.
      for (let i = 1; i <= DEMO_QUERY.length; i++) {
        schedule(() => setTypedLength(i), i * TYPE_SPEED_MS);
      }
      const afterType = DEMO_QUERY.length * TYPE_SPEED_MS + HOLD_AFTER_TYPE_MS;

      schedule(() => setChipActive(true), afterType);

      DEMO_RESULTS.forEach((_, i) => {
        schedule(() => setVisibleResults(i + 1), afterType + (i + 1) * RESULT_STAGGER_MS);
      });

      const cycleEnd = afterType + DEMO_RESULTS.length * RESULT_STAGGER_MS + HOLD_END_MS;
      schedule(runCycle, cycleEnd + RESET_PAUSE_MS);
    }

    runCycle();
    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
    };
  }, []);

  return (
    <div className="demo-showcase" aria-hidden="true">
      <div className="demo-window">
        <div className="demo-window-bar">
          <span className="demo-dot" />
          <span className="demo-dot" />
          <span className="demo-dot" />
        </div>
        <div className="demo-search-field">
          <Search size={14} />
          <span className="demo-typed">
            {DEMO_QUERY.slice(0, typedLength)}
            <span className="demo-caret" />
          </span>
        </div>
        <div className="demo-chips">
          <span className={`demo-chip ${chipActive ? "active" : ""}`}>
            <Radar size={11} /> All portals
          </span>
          <span className="demo-chip">GeM</span>
          <span className="demo-chip">Defence</span>
        </div>
        <div className="demo-results">
          {DEMO_RESULTS.map((r, i) => (
            <div key={r.title} className={`demo-result ${i < visibleResults ? "visible" : ""}`}>
              <CheckCircle2 size={13} />
              <div>
                <div className="demo-result-portal">{r.portal}</div>
                <div className="demo-result-title">{r.title}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

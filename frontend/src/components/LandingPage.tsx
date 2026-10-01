import Link from "next/link";
import { useEffect, useRef, useState, ReactNode } from "react";
import {
  ShieldCheck,
  Radar,
  Search,
  BellRing,
  History,
  DatabaseBackup,
  ArrowRight,
  CheckCircle2,
  UserPlus,
  SlidersHorizontal,
  Sparkles,
} from "lucide-react";
import CursorGlow from "./CursorGlow";
import DemoShowcase from "./DemoShowcase";

const FEATURES = [
  {
    icon: Radar,
    title: "22-Portal Coverage",
    body: "GeM, CPPP, Defence eProcurement, and every major state portal scraped automatically, around the clock.",
  },
  {
    icon: Search,
    title: "Smart Search",
    body: "Full-text and typo-tolerant fuzzy search across every tender, ranked by relevance in milliseconds.",
  },
  {
    icon: ShieldCheck,
    title: "Relevance Tagging",
    body: "Every tender auto-classified as relevant, irrelevant, or unclassified — parts and non-defence noise filtered out automatically.",
  },
  {
    icon: BellRing,
    title: "Email Alerts",
    body: "Subscribe to your keywords and get a single digest email the moment a matching tender appears — never twice.",
  },
  {
    icon: History,
    title: "Live Scrape Activity",
    body: "Watch every portal's scrape run in real time, with per-portal coverage bars against each portal's own reported totals.",
  },
  {
    icon: DatabaseBackup,
    title: "Secure & Backed Up",
    body: "Role-based accounts, session tracking, and automated daily backups keep your data safe and auditable.",
  },
];

const STEPS = [
  { n: "01", icon: UserPlus, title: "Sign up", body: "Create your secure workspace in seconds — no approval wait." },
  { n: "02", icon: SlidersHorizontal, title: "Pick your keywords", body: "Choose defence and surveillance terms or add your own watchlist." },
  { n: "03", icon: Sparkles, title: "Get matched tenders", body: "Receive ranked results from every connected portal in one searchable feed." },
];

/** Fades an element up into place the first time it scrolls into view. */
function Reveal({ children, delay = 0 }: { children: ReactNode; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.15 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={ref} className={`reveal ${visible ? "reveal-visible" : ""}`} style={{ transitionDelay: `${delay}ms` }}>
      {children}
    </div>
  );
}

export default function LandingPage() {
  return (
    <div className="landing">
      <CursorGlow />
      <div className="landing-glow landing-glow-a" />
      <div className="landing-glow landing-glow-b" />

      <header className="landing-nav">
        <div className="landing-brand">
          <div className="brand-mark">
            <ShieldCheck size={18} />
          </div>
          <div className="brand-text">
            <strong>RRP Groups</strong>
            <span>Tender Intelligence</span>
          </div>
        </div>
        <div className="landing-nav-actions">
          <Link href="/login" className="btn secondary small">
            Log in
          </Link>
          <Link href="/signup" className="btn small">
            Sign up
          </Link>
        </div>
      </header>

      <main>
        <section className="landing-hero">
          <div className="landing-hero-badge">
            <span className="live-dot" />
            22 government portals monitored live
          </div>
          <h1>
            Never miss a defence
            <br />
            <span className="landing-gradient-text">tender again.</span>
          </h1>
          <p>
            Automated scraping across every major Indian government e-procurement portal, smart keyword search, and
            instant email alerts — all in one place.
          </p>
          <div className="landing-hero-actions">
            <Link href="/signup" className="btn landing-cta">
              Get started free
              <ArrowRight size={16} />
            </Link>
            <Link href="/login" className="btn secondary landing-cta">
              Log in
            </Link>
          </div>
          <ul className="landing-hero-checks">
            <li>
              <CheckCircle2 size={14} /> No credit card required
            </li>
            <li>
              <CheckCircle2 size={14} /> Set up in under a minute
            </li>
          </ul>
        </section>

        <section className="landing-section landing-demo-section">
          <Reveal>
            <h2 className="landing-section-title">See it in action</h2>
            <p className="landing-section-sub">A live look at how a search actually plays out — no video needed.</p>
            <DemoShowcase />
          </Reveal>
        </section>

        <section className="landing-section">
          <Reveal>
            <h2 className="landing-section-title">Everything you need to track opportunities</h2>
            <p className="landing-section-sub">
              Built for teams who can&apos;t afford to scroll through 22 different government websites every day.
            </p>
          </Reveal>
          <div className="landing-feature-grid">
            {FEATURES.map((f, i) => (
              <Reveal key={f.title} delay={i * 60}>
                <div className="landing-feature-card">
                  <div className="landing-feature-icon">
                    <f.icon size={20} />
                  </div>
                  <h3>{f.title}</h3>
                  <p>{f.body}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </section>

        <section className="landing-section landing-steps-section">
          <Reveal>
            <h2 className="landing-section-title">Up and running in three steps</h2>
          </Reveal>
          <div className="landing-steps">
            <div className="landing-step-rail" aria-hidden="true"><span /></div>
            {STEPS.map((s, i) => (
              <Reveal key={s.n} delay={i * 80}>
                <div className="landing-step">
                  <div className="landing-step-icon"><s.icon size={21} /></div>
                  <div className="landing-step-num">STEP {s.n}</div>
                  <h3>{s.title}</h3>
                  <p>{s.body}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </section>

        <section className="landing-section">
          <Reveal>
            <div className="landing-final-cta">
              <h2>Ready to stop searching manually?</h2>
              <p>Join now and let every tender find you.</p>
              <Link href="/signup" className="btn landing-cta">
                Create your free account
                <ArrowRight size={16} />
              </Link>
            </div>
          </Reveal>
        </section>
      </main>

      <footer className="landing-footer">
        <span>© {new Date().getFullYear()} RRP Groups Tender Intelligence</span>
      </footer>
    </div>
  );
}

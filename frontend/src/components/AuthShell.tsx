import { ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft, Database, Radar, Search, ShieldCheck } from "lucide-react";

interface Props {
  eyebrow: string;
  title: string;
  subtitle: string;
  children: ReactNode;
}

export default function AuthShell({ eyebrow, title, subtitle, children }: Props) {
  return (
    <div className="auth-page auth-page-cinematic">
      <div className="auth-motion-bg" aria-hidden="true">
        <div className="auth-grid" />
        <div className="auth-orbit auth-orbit-one" />
        <div className="auth-orbit auth-orbit-two" />
        <div className="auth-flow-line auth-flow-line-one"><span /></div>
        <div className="auth-flow-line auth-flow-line-two"><span /></div>
      </div>

      <Link href="/" className="auth-back"><ArrowLeft size={15} /> Back to home</Link>

      <div className="auth-layout">
        <section className="auth-story">
          <div className="auth-story-badge"><span className="live-dot" /> Live procurement intelligence</div>
          <h1>From public portal<br /><span>to the right opportunity.</span></h1>
          <p>RRP Groups continuously collects, classifies, and ranks tenders across India&apos;s government procurement network.</p>
          <div className="auth-flow-preview" aria-label="Platform workflow">
            <div className="auth-flow-node"><Radar size={18} /><span>22 portals</span></div>
            <div className="auth-flow-arrow"><span /></div>
            <div className="auth-flow-node"><Database size={18} /><span>PostgreSQL</span></div>
            <div className="auth-flow-arrow"><span /></div>
            <div className="auth-flow-node"><Search size={18} /><span>Smart search</span></div>
          </div>
        </section>

        <section className="card auth-card auth-card-premium">
          <div className="auth-brand">
            <div className="brand-mark"><ShieldCheck size={18} /></div>
            <div><strong>RRP Groups</strong><span>Tender Intelligence</span></div>
          </div>
          <div className="auth-heading">
            <span>{eyebrow}</span>
            <h2>{title}</h2>
            <p>{subtitle}</p>
          </div>
          {children}
        </section>
      </div>
    </div>
  );
}

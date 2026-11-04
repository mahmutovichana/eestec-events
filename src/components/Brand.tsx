/* eslint-disable @next/next/no-img-element */
import { UserMenu } from "./UserMenu";

export function Logos() {
  return (
    <div className="logos">
      <img src="/eestec-logo.png" alt="EESTEC LC Sarajevo" />
      <span className="sep" aria-hidden="true" />
      <img src="/jobfair-logo.png" alt="JobFAIR" />
    </div>
  );
}

export function Hero({
  kicker,
  title,
  sub,
  facts,
  actions,
}: {
  kicker: string;
  title: string;
  sub?: string;
  facts?: string[];
  actions?: React.ReactNode;
}) {
  return (
    <header className="hero">
      <div className="wrap">
        <div className="hero-top">
          <Logos />
          <UserMenu />
        </div>
        <div className="hero-body">
          <span className="kicker">{kicker}</span>
          <h1>{title}</h1>
          {sub ? <p className="sub">{sub}</p> : null}
          {facts && facts.length > 0 ? (
            <ul className="facts">
              {facts.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          ) : null}
          {actions ? <div className="hero-actions">{actions}</div> : null}
        </div>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="site">
      <div className="wrap">
        <img src="/eestec-logo.png" alt="EESTEC LC Sarajevo" />
        <span>eestec-sa.ba</span>
        <img src="/jobfair-logo.png" alt="JobFAIR" />
      </div>
    </footer>
  );
}

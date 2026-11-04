import { useCallback, useEffect, useState } from "react";
import { AdminEvent, AdminGate, AdminAdmins, AdminHome, AdminImport } from "./admin";
import { AuthProvider, GoogleSignIn, useAuth } from "./auth";
import { EventPage, Home } from "./public";
import { Spinner, ToastProvider, useToast } from "./ui";

function useRoute() {
  const get = () => location.hash.replace(/^#/, "") || "/";
  const [path, setPath] = useState(get);
  useEffect(() => {
    const f = () => { setPath(get()); window.scrollTo(0, 0); };
    window.addEventListener("hashchange", f);
    return () => window.removeEventListener("hashchange", f);
  }, []);
  const nav = useCallback((to: string) => { location.hash = to; }, []);
  return { path, nav };
}

function Shell({ nav, children }: { nav: (to: string) => void; children: React.ReactNode }) {
  const { me, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  useEffect(() => { if (me.loggedIn) setOpen(false); }, [me.loggedIn]);
  return (
    <>
      <a className="skip" href="#main">Preskoči na sadržaj</a>
      <header className="hero">
        <div className="wrap bar-top">
          <a className="logos" href="#/" onClick={(e) => { e.preventDefault(); nav("/"); }} aria-label="EESTEC LC Sarajevo — početna">
            <img src="./eestec-logo.png" alt="" /><span className="sep" aria-hidden="true" /><img src="./jobfair-logo.png" alt="" />
          </a>
          <div className="who">
            {me.isAdmin && <a className="chipbtn" href="#/admin" onClick={(e) => { e.preventDefault(); nav("/admin"); }}>Administracija</a>}
            {me.loggedIn
              ? <><span className="uname" title={me.email}>{me.name || me.email}</span><button className="chipbtn" onClick={signOut}>Odjava</button></>
              : <button className="chipbtn" aria-expanded={open} onClick={() => setOpen(!open)}>Prijava</button>}
          </div>
        </div>
        {open && !me.loggedIn && (
          <div className="wrap"><div className="login-pop" role="dialog" aria-label="Prijava">
            <p>Prijava je potrebna samo za glasanje i identificirani feedback.</p>
            <GoogleSignIn />
            <p className="muted">Prijavom prihvatate <a href="./terms/">Uslove korištenja</a> i <a href="./privacy/">Politiku privatnosti</a>.</p>
          </div></div>
        )}
      </header>
      <main id="main" className="wrap" tabIndex={-1}>{children}</main>
      <footer className="wrap foot">
        <span>EESTEC LC Sarajevo · <a href="https://eestec-sa.ba/">eestec-sa.ba</a></span>
        <nav aria-label="Pravne informacije"><a href="./privacy/">Privatnost</a><a href="./terms/">Uslovi korištenja</a></nav>
      </footer>
    </>
  );
}

function Routes() {
  const { path, nav } = useRoute();
  const parts = path.split("/").filter(Boolean);
  useEffect(() => { document.title = "EESTEC LC Sarajevo — Events"; }, [path]);
  // #/privacy i #/terms vode na statične stranice (čitljive i bez JavaScripta; potrebne za Google OAuth)
  const legal = parts.length === 1 && (parts[0] === "privacy" || parts[0] === "terms") ? parts[0] : null;
  useEffect(() => { if (legal) location.replace(`./${legal}/`); }, [legal]);
  let page: React.ReactNode;
  if (legal) page = <Spinner />;
  else if (parts[0] === "e" && parts[1]) page = <EventPage slug={parts[1]} tab={parts[2] ?? ""} nav={nav} />;
  else if (parts[0] === "admin") page = <AdminGate>{parts[1] === "_admini" ? <AdminAdmins nav={nav} /> : parts[1] === "_uvoz" ? <AdminImport nav={nav} /> : parts[1] ? <AdminEvent slug={parts[1]} tab={parts[2] ?? ""} nav={nav} /> : <AdminHome nav={nav} />}</AdminGate>;
  else if (parts.length === 0) page = <Home nav={nav} />;
  else page = <div className="empty"><h2>Stranica ne postoji</h2><p><a href="#/">Nazad na događaje</a></p></div>;
  return <Shell nav={nav}>{page}</Shell>;
}

function Inner() {
  const toast = useToast();
  const onExpired = useCallback(() => toast("Sesija je istekla. Prijavite se ponovo.", "err"), [toast]);
  return <AuthProvider onExpired={onExpired}><Routes /></AuthProvider>;
}

export default function App() {
  return <ToastProvider><Inner /></ToastProvider>;
}

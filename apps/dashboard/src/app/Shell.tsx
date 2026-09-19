import { useEffect } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { api, session } from "./api";
import { AppDataProvider, useApp } from "./store";

const NAV = [
  { to: "/app", label: "Home", end: true },
  { to: "/app/rules", label: "Rules" },
  { to: "/app/analytics", label: "Analytics" },
];

/** Guard + layout: no wallet yet → the passkey onboarding. */
export function Shell() {
  const nav = useNavigate();
  const has = session.exists();
  useEffect(() => {
    if (!has) nav("/app/onboard", { replace: true });
  }, [has, nav]);
  if (!has) return null;
  return (
    <AppDataProvider>
      <Frame />
    </AppDataProvider>
  );
}

function Frame() {
  const nav = useNavigate();
  const { me, error } = useApp();
  const demo = session.isDemo();

  // an expired session is cleared by the API client on 401 → back to the passkey screen
  useEffect(() => {
    if (error && !session.exists()) nav("/app/onboard", { replace: true });
  }, [error, nav]);

  async function signOut() {
    await api().logout();
    session.setToken(null);
    session.setDemo(false);
    nav("/app/onboard", { replace: true });
  }

  return (
    <div className="dash">
      <aside className="dash-side">
        <a className="logo" href="/">
          pera
          <i className="logo-dot" />
        </a>
        <nav>
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => (isActive ? "on" : "")}>
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="dash-user">
          <span className="chip">{demo ? "demo data" : "Stellar testnet"}</span>
          <b>{me?.displayName ?? "…"}</b>
          <button type="button" onClick={() => void signOut()}>
            Sign out
          </button>
        </div>
      </aside>
      <main className="dash-main">
        {demo && <div className="banner">You're looking at demo data generated in this browser. Nothing here is on-chain — sign out to create a real wallet.</div>}
        {error && !demo && <div className="banner warn">{error}</div>}
        <Outlet />
      </main>
    </div>
  );
}

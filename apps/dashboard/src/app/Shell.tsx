import { useEffect } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { MagnetTabs } from "@/components/block/magnet-tabs";
import { api, session } from "./api";
import { AppDataProvider, useApp } from "./store";

const NAV: Record<string, string> = { Home: "/app", Rules: "/app/rules", Agents: "/app/agents", Analytics: "/app/analytics" };

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
  const { pathname } = useLocation();
  const { me, error } = useApp();
  const demo = session.isDemo();
  const active = Object.keys(NAV).find((k) => NAV[k] === pathname.replace(/\/$/, "")) ?? "Home";

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
      {/* the landing page's floating glass pill, with the dashboard's sections in it */}
      <header className="nav pill app-nav">
        <div className="nav-inner">
          <a className="logo" href="/">
            pera
            <i className="logo-dot" />
          </a>
          <div className="app-tabs">
            <MagnetTabs slug="app-nav" options={Object.keys(NAV)} activeTab={active} onSelect={(k) => nav(NAV[k])} />
          </div>
          <div className="app-user">
            {demo && (
              <span className="eyebrow">
                <i /> demo data
              </span>
            )}
            <b>{me?.displayName ?? session.name() ?? ""}</b>
            <button type="button" onClick={() => void signOut()}>
              Sign out
            </button>
          </div>
        </div>
      </header>
      <main className="dash-main">
        {demo && <div className="banner">You're looking at demo data generated in this browser. Nothing here is on-chain. Sign out to create a real wallet.</div>}
        {error && !demo && <div className="banner warn">{error}</div>}
        <Outlet />
      </main>
    </div>
  );
}

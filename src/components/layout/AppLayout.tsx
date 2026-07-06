import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import { useState, useEffect, type ReactNode } from "react";
import { ArrowLeft, Dices } from "lucide-react";

export function AppLayout({ children }: { children: ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);

  // The marketing landing page ("/") owns the whole screen — no sidebar, no
  // topbar, no padding. It renders its own full-bleed layout. (Track route
  // client-side so SPA navigations flip the chrome on/off.)
  const [pathname, setPathname] = useState(() =>
    typeof window === "undefined" ? "/" : window.location.pathname,
  );
  useEffect(() => {
    if (typeof window === "undefined") return;
    const update = () => setPathname(window.location.pathname);
    window.addEventListener("popstate", update);
    const origPush = history.pushState;
    const origReplace = history.replaceState;
    history.pushState = function (...args) { origPush.apply(this, args); update(); };
    history.replaceState = function (...args) { origReplace.apply(this, args); update(); };
    return () => {
      window.removeEventListener("popstate", update);
      history.pushState = origPush;
      history.replaceState = origReplace;
    };
  }, []);

  if (pathname === "/") {
    return <>{children}</>;
  }

  // Casino routes get their own full-screen layout — no sidebar, just a slim
  // top bar with a back button and the casino nav.
  const isCasino = pathname.startsWith("/casino");
  if (isCasino) {
    return <CasinoLayout>{children}</CasinoLayout>;
  }

  return (
    <div className="flex h-screen w-full overflow-hidden">
      <Sidebar mobileOpen={mobileOpen} onCloseMobile={() => setMobileOpen(false)} />
      <div className="flex-1 flex flex-col min-w-0 h-screen">
        <Topbar onOpenMobile={() => setMobileOpen(true)} />
        <main className="flex-1 p-3 sm:p-4 md:p-6 pb-24 md:pb-6 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}

// ─── Casino layout — full screen, no sidebar, own topbar ─────────────────────
function CasinoLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col h-screen w-full overflow-hidden" style={{ background: "#000" }}>
      {/* Casino topbar */}
      <header className="shrink-0 h-13 flex items-center justify-between px-4 sm:px-6"
        style={{ borderBottom: "1px solid rgba(255,255,255,0.06)", background: "#000" }}>
        <div className="flex items-center gap-3">
          <a href="/" className="flex items-center gap-1.5 text-sm font-semibold transition-colors hover:text-white"
            style={{ color: "rgba(255,255,255,0.5)" }}>
            <ArrowLeft className="size-4" /> Home
          </a>
          <span style={{ color: "rgba(255,255,255,0.15)" }}>·</span>
          <a href="/casino" className="flex items-center gap-1.5 font-black text-white text-sm">
            <Dices className="size-4" style={{ color: "#a855f7" }} />
            Casino
          </a>
        </div>
        <div className="flex items-center gap-2">
          <div className="text-xs font-semibold px-3 py-1.5 rounded-lg"
            style={{ background: "rgba(168,85,247,0.15)", color: "#a855f7", border: "1px solid rgba(168,85,247,0.25)" }}>
            Balance: — MON
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto px-3 sm:px-5 md:px-8 py-5 pb-24"
        style={{ background: "#000" }}>
        {children}
      </main>
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex items-end justify-between gap-3 mb-4 sm:mb-6 flex-wrap">
      <div className="min-w-0">
        <h1 className="text-xl sm:text-2xl md:text-3xl font-bold truncate">{title}</h1>
        {subtitle && <p className="text-xs sm:text-sm text-muted-foreground mt-1">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 flex-wrap">{actions}</div>}
    </div>
  );
}

export function Card({
  title,
  action,
  children,
  className = "",
}: {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-xl border border-border bg-surface overflow-hidden ${className}`}>
      {title && (
        <div className="flex items-center justify-between px-3 sm:px-4 py-2.5 sm:py-3 border-b border-border">
          <h3 className="font-semibold text-sm">{title}</h3>
          {action}
        </div>
      )}
      <div className="p-3 sm:p-4">{children}</div>
    </div>
  );
}

export function Stat({ label, value, delta }: { label: string; value: string; delta?: string }) {
  const positive = delta?.startsWith("+");
  return (
    <div className="rounded-2xl glass p-3 sm:p-4">
      <div className="text-[11px] sm:text-xs text-muted-foreground">{label}</div>
      <div className="text-lg sm:text-xl font-display font-semibold mt-1">{value}</div>
      {delta && (
        <div className={`text-xs mt-1 ${positive ? "text-up" : "text-down"}`}>{delta}</div>
      )}
    </div>
  );
}

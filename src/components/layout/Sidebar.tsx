import { Link, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard,
  Brain,
  Copy,
  Bell,
  MessageSquare,
  Trophy,
  ChevronLeft,
  X,
  User,
  UserCircle,
  Mic,
  Inbox as InboxIcon,
  Settings as Cog,
  Gift,
} from "lucide-react";
import { useState } from "react";
import { APP_NAME, APP_LOGO } from "@/lib/brand";
import { useMe } from "@/lib/useMe";
import { useIdentity } from "@/lib/identity";
import { defaultAccountHandle } from "@/lib/handles";
import { profileRoute } from "@/lib/identity";

const nav: { to: any; params?: any; label: string; icon: any }[] = [
  { to: "/meme", label: "Dashboard", icon: LayoutDashboard },
  { to: "/wallet", label: "Wallet", icon: User },
  { to: "/smart-money", label: "Smart Money", icon: Brain },
  { to: "/copy-trading", label: "Copy Trading", icon: Copy },
  { to: "/alerts", label: "Alerts", icon: Bell },
  { to: "/feed", label: "Feed", icon: MessageSquare },
  { to: "/inbox", label: "Inbox", icon: InboxIcon },
  { to: "/cabals", label: "Cabals", icon: Mic },
  { to: "/leaderboards", label: "Leaderboards", icon: Trophy },
  { to: "/rewards", label: "Rewards", icon: Gift },
  { to: "/settings", label: "Settings", icon: Cog },
];

export function Sidebar({
  mobileOpen = false,
  onCloseMobile,
}: { mobileOpen?: boolean; onCloseMobile?: () => void } = {}) {
  const [hovered, setHovered] = useState(false);
  const collapsed = !hovered;
  const path = useRouterState({ select: (s) => s.location.pathname });
  const me = useMe();
  const myId = useIdentity(me);
  const mySlug = myId?.handle ?? (me ? defaultAccountHandle(me) : null);

  // Profile → your own page (shows Edit profile when the connected wallet matches).
  const profileLink = mySlug
    ? { ...profileRoute(mySlug), label: "Profile", icon: UserCircle }
    : null;

  const isActive = (to: string) =>
    to === "/" ? path === "/" : path.startsWith(to.split("/").slice(0, 2).join("/"));

  const renderLink = (item: typeof nav[number], showLabel: boolean) => {
    const Icon = item.icon;
    const active = isActive(item.to);
    return (
      <Link
        key={item.label}
        to={item.to}
        params={item.params}
        onClick={onCloseMobile}
        className={`relative flex items-center gap-3 px-2.5 py-2 rounded-xl text-sm transition-colors ${
          active
            ? "text-foreground"
            : "text-muted-foreground hover:text-foreground hover:bg-white/[0.03]"
        }`}
      >
        {/* Active indicator rail — sole signal of active state, no pill bg */}
        {active && (
          <span className="absolute inset-y-1.5 left-0 w-0.5 rounded-r-full bg-primary" />
        )}
        <Icon className={`size-4 shrink-0 ${active ? "text-primary" : ""}`} />
        {showLabel && <span className="truncate font-medium">{item.label}</span>}
      </Link>
    );
  };

  const content = (showLabel: boolean) => (
    <>
      <div className="h-14 flex items-center justify-between px-4 border-b border-border">
        {showLabel && (
          <Link to="/meme" onClick={onCloseMobile} className="flex items-center gap-2">
            <img
              src={APP_LOGO}
              alt={APP_NAME}
              className="size-7 rounded-md object-cover"
            />
            <span className="font-display font-bold tracking-tight text-foreground">
              {APP_NAME}
            </span>
          </Link>
        )}
        {showLabel && (
          <span className="hidden md:grid size-7 place-items-center rounded-md text-muted-foreground/40">
            <ChevronLeft className="size-4" />
          </span>
        )}
        <button
          onClick={onCloseMobile}
          className="md:hidden size-7 grid place-items-center rounded-md hover:bg-surface-2 text-muted-foreground"
        >
          <X className="size-4" />
        </button>
      </div>

      <nav className="flex-1 flex flex-col py-3 px-2 overflow-y-auto scrollbar-hide">
        <div className="flex-1 flex flex-col justify-evenly">
          {nav.map((item) => renderLink(item, showLabel))}
          {profileLink && renderLink(profileLink, showLabel)}
        </div>
      </nav>
    </>
  );

  return (
    <>
      <aside
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        className={`hidden md:flex ${collapsed ? "w-16" : "w-60"} shrink-0 border-r border-border bg-background h-full flex-col transition-[width] duration-200 overflow-hidden`}
      >
        {content(!collapsed)}
      </aside>

      {mobileOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onCloseMobile} />
          <aside className="relative w-64 max-w-[80%] h-full bg-background border-r border-border flex flex-col animate-in slide-in-from-left">
            {content(true)}
          </aside>
        </div>
      )}
    </>
  );
}

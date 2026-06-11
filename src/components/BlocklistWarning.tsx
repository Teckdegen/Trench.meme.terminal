import { Link } from "@tanstack/react-router";
import { Ban, ShieldAlert, Skull, X } from "lucide-react";
import {
  dismissTokenWarning,
  isTokenWarningDismissed,
  type TokenBlockCheck,
} from "@/lib/blocklist";
import { useEffect, useState } from "react";

export function BlocklistWarning({
  tokenAddress,
  symbol,
  check,
  onUnblockToken,
  onUnblockLauncher,
}: {
  tokenAddress: string;
  symbol: string;
  check: TokenBlockCheck;
  onUnblockToken?: () => void;
  onUnblockLauncher?: () => void;
}) {
  const [dismissed, setDismissed] = useState(() => isTokenWarningDismissed(tokenAddress));

  useEffect(() => {
    setDismissed(isTokenWarningDismissed(tokenAddress));
  }, [tokenAddress]);

  if (dismissed) return null;
  if (!check.tokenBlocked && !check.launcherBlocked) return null;

  const dismiss = () => {
    dismissTokenWarning(tokenAddress);
    setDismissed(true);
  };

  return (
    <div
      role="alert"
      className="relative overflow-hidden rounded-xl border border-purple-500/40 bg-gradient-to-r from-purple-950/80 via-black to-purple-950/60"
    >
      <div
        className="absolute inset-0 opacity-[0.07] pointer-events-none"
        style={{
          backgroundImage:
            "repeating-linear-gradient(-45deg, #a855f7 0, #a855f7 8px, transparent 8px, transparent 16px)",
        }}
      />
      <div className="relative px-4 py-3.5 flex gap-3">
        <div className="size-10 rounded-xl bg-purple-500/20 border border-purple-500/30 grid place-items-center shrink-0">
          {check.tokenBlocked ? (
            <Skull className="size-5 text-purple-300" />
          ) : (
            <ShieldAlert className="size-5 text-purple-300" />
          )}
        </div>
        <div className="flex-1 min-w-0 space-y-2">
          <div>
            <p className="text-sm font-bold text-purple-100">Your private blocklist</p>
            <p className="text-xs text-purple-200/80 mt-0.5 leading-relaxed">
              {check.tokenBlocked && check.launcherBlocked && (
                <>
                  You blocked <span className="font-semibold text-foreground">${symbol}</span> and the
                  wallet that launched it. Trade at your own risk — only you see this flag.
                </>
              )}
              {check.tokenBlocked && !check.launcherBlocked && (
                <>
                  You blocked this token (<span className="font-semibold text-foreground">${symbol}</span>).
                  Charts and trading still work — this is your heads-up, not a global ban.
                </>
              )}
              {!check.tokenBlocked && check.launcherBlocked && (
                <>
                  The launcher wallet is on your blocklist. Any token they deploy — including{" "}
                  <span className="font-semibold text-foreground">${symbol}</span> — is flagged for you only.
                </>
              )}
            </p>
            {check.tokenEntry?.note && (
              <p className="text-[11px] text-muted-foreground mt-1 italic">
                Token note: {check.tokenEntry.note}
              </p>
            )}
            {check.launcherEntry?.note && (
              <p className="text-[11px] text-muted-foreground mt-0.5 italic">
                Wallet note: {check.launcherEntry.note}
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {check.tokenBlocked && onUnblockToken && (
              <button
                type="button"
                onClick={onUnblockToken}
                className="h-8 px-3 rounded-full bg-white/10 text-[11px] font-semibold hover:bg-white/15 inline-flex items-center gap-1"
              >
                <Ban className="size-3" /> Unblock token
              </button>
            )}
            {check.launcherBlocked && onUnblockLauncher && check.launcherEntry && (
              <button
                type="button"
                onClick={onUnblockLauncher}
                className="h-8 px-3 rounded-full bg-white/10 text-[11px] font-semibold hover:bg-white/15 inline-flex items-center gap-1"
              >
                <Ban className="size-3" /> Unblock launcher
              </button>
            )}
            <Link
              to="/settings"
              className="h-8 px-3 rounded-full border border-purple-500/40 text-[11px] font-semibold text-purple-200 hover:bg-purple-500/10 inline-flex items-center"
            >
              Manage blocklist
            </Link>
            <button
              type="button"
              onClick={dismiss}
              className="h-8 px-3 rounded-full text-[11px] font-semibold text-muted-foreground hover:text-foreground"
            >
              I know, hide for now
            </button>
          </div>
        </div>
        <button
          type="button"
          onClick={dismiss}
          className="size-8 rounded-lg hover:bg-white/10 grid place-items-center text-muted-foreground shrink-0"
          aria-label="Dismiss warning"
        >
          <X className="size-4" />
        </button>
      </div>
    </div>
  );
}

export function BlocklistChip({ label }: { label: "token" | "launcher" }) {
  return (
    <span
      className="inline-flex items-center gap-0.5 px-1.5 py-px rounded text-[9px] font-bold uppercase tracking-wide bg-purple-500/15 text-purple-300 border border-purple-500/25"
      title={label === "token" ? "On your token blocklist" : "Launcher on your wallet blocklist"}
    >
      <Skull className="size-2.5" />
      {label === "token" ? "Blocked" : "Blocked dev"}
    </span>
  );
}

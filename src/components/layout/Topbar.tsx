import { Search, Plus, Menu, Star, Copy, ChevronDown, Loader2, BadgeCheck, Check, KeyRound } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { APP_NAME, APP_LOGO } from "@/lib/brand";
import { useTokenSearch, type DirolToken } from "@/lib/dirol";
import { useMe } from "@/lib/useMe";
import { useIdentity, labelFor } from "@/lib/identity";
import { useMonBalance } from "@/lib/wallet-tx";
import { withdrawMon } from "@/lib/para-session";
import { txUrl } from "@/lib/explorer";
import { parseEther, type Hex } from "viem";
import { MonLogo } from "@/components/MonLogo";
import { ModalHeader, ModalShell } from "@/components/ui/modal-shell";
import { useParaSdk } from "@/components/ParaWalletProvider";
import { toast } from "sonner";

type FundView = "home" | "deposit" | "withdraw";

export function Topbar({ onOpenMobile }: { onOpenMobile?: () => void }) {
  const [fundsOpen, setFundsOpen] = useState(false);
  const [fundView, setFundView] = useState<FundView>("home");
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [recents, setRecents] = useState<string[]>([]);  // addresses

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSearchOpen(false);
        setFundsOpen(false);
      }
      if (e.key === "/" && !searchOpen && document.activeElement?.tagName !== "INPUT") {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [searchOpen]);

  return (
    <>
      <div className="shrink-0 z-30 bg-background/70 backdrop-blur-md border-b border-white/[0.04]">
        <div className="h-14 flex items-center gap-2 sm:gap-3 px-3 sm:px-4">
          {/* Logo + name — far left */}
          <Link to="/" className="flex items-center gap-1.5 shrink-0">
            <img src={APP_LOGO} alt={APP_NAME} className="size-6 rounded object-contain" />
            <span className="font-bold text-sm tracking-tight whitespace-nowrap hidden sm:inline">{APP_NAME}</span>
          </Link>

          <div className="flex-1" />

          {/* Menu + search + funds — right */}
          <button
            onClick={onOpenMobile}
            className="md:hidden size-9 grid place-items-center rounded-md bg-white/5 shrink-0"
            title="Menu"
          >
            <Menu className="size-4" />
          </button>
          <button
            onClick={() => setSearchOpen(true)}
            className="sm:hidden size-9 grid place-items-center rounded-full bg-white/5 shrink-0"
            title="Search"
          >
            <Search className="size-4 text-muted-foreground" />
          </button>
          <button
            onClick={() => setSearchOpen(true)}
            className="hidden sm:flex h-9 px-3 rounded-full bg-white/5 items-center gap-2 w-56 lg:w-72 text-left shrink-0"
          >
            <Search className="size-4 text-muted-foreground" />
            <span className="flex-1 text-sm text-muted-foreground truncate">
              Search for tokens or traders...
            </span>
            <kbd className="text-[10px] px-1.5 py-0.5 rounded bg-background">/</kbd>
          </button>

          <button
            onClick={() => {
              setFundView("home");
              setFundsOpen(true);
            }}
            className="flex items-center gap-1.5 sm:gap-2 h-9 px-3 sm:px-4 rounded-full lit-purple text-xs sm:text-sm font-semibold shrink-0"
          >
            <Plus className="size-4" />
            <span className="hidden sm:inline">Add Funds</span>
            <span className="sm:hidden">Funds</span>
          </button>
        </div>
      </div>

      {searchOpen && <SearchOverlay
        query={query}
        setQuery={setQuery}
        recents={recents}
        setRecents={setRecents}
        onClose={() => setSearchOpen(false)}
      />}

      {fundsOpen && <FundsModal view={fundView} setView={setFundView} onClose={() => setFundsOpen(false)} />}
    </>
  );
}

function SearchOverlay({
  query, setQuery, recents, setRecents, onClose,
}: {
  query: string;
  setQuery: (v: string) => void;
  matches?: unknown;                // legacy, unused
  recents: string[];
  setRecents: (v: string[] | ((s: string[]) => string[])) => void;
  onClose: () => void;
}) {
  const { data: results, isFetching } = useTokenSearch(query);
  const hits: DirolToken[] = results ?? [];
  const trimmed = query.trim();

  return (
    <div className="fixed inset-0 z-50 flex items-start sm:items-center justify-center pt-[10vh] sm:pt-0 px-3 sm:px-6">
      <button className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} aria-label="Close" />
      <div className="relative w-full max-w-2xl rounded-3xl bg-background overflow-hidden" style={{ boxShadow: "0 30px 80px rgba(0,0,0,0.8)" }}>
        <div className="px-4 py-4 flex items-center gap-3">
          <Search className="size-5 text-muted-foreground" />
          <input
            autoFocus
            placeholder="Search by name, symbol or paste contract address…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="flex-1 bg-transparent text-base placeholder:text-muted-foreground focus:outline-none"
          />
          {isFetching && <Loader2 className="size-4 text-muted-foreground animate-spin" />}
          <button
            onClick={() => navigator.clipboard?.readText().then(setQuery).catch(() => {})}
            className="text-xs h-8 px-3 rounded-lg bg-white/5"
          >
            Paste
          </button>
          <button onClick={onClose} className="text-xs h-8 px-3 rounded-lg bg-white/5">ESC</button>
        </div>

        <div className="px-4 py-2 flex items-center justify-between">
          <span className="text-sm font-semibold">
            {trimmed ? (isFetching && hits.length === 0 ? "Searching…" : "Results") : "Recents"}
          </span>
          {!trimmed && recents.length > 0 && (
            <button onClick={() => setRecents([])} className="text-xs font-bold text-primary">Clear all</button>
          )}
        </div>

        <ul className="max-h-[60vh] overflow-y-auto scrollbar-hide pb-3">
          {trimmed && hits.length === 0 && !isFetching && (
            <li className="px-4 py-10 text-center text-sm text-muted-foreground">
              No matches for "{trimmed}"
            </li>
          )}
          {!trimmed && recents.length === 0 && (
            <li className="px-4 py-10 text-center text-sm text-muted-foreground">
              Search by name, symbol, or contract address.
            </li>
          )}
          {trimmed && hits.slice(0, 20).map((t) => (
            <li key={t.address}>
              <Link
                to="/token/$id"
                params={{ id: t.address }}
                onClick={() => {
                  onClose();
                  setRecents((r) => [t.address, ...r.filter((x) => x !== t.address)].slice(0, 8));
                }}
                className="flex items-center gap-3 px-4 py-3 hover:bg-white/5"
              >
                <div className="size-11 rounded-full grid place-items-center text-xs font-bold text-background overflow-hidden shrink-0 bg-white/5">
                  {t.logoURI ? (
                    <img src={t.logoURI} alt={t.symbol} className="size-full object-cover" />
                  ) : (
                    <span>{t.symbol.slice(0, 2)}</span>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 text-base font-semibold">
                    <span className="truncate">{t.symbol}</span>
                    {t.isVerified && <BadgeCheck className="size-4 text-primary shrink-0" />}
                    <Star className="size-3.5 text-muted-foreground shrink-0" />
                  </div>
                  <p className="text-xs text-muted-foreground truncate">{t.name}</p>
                </div>
                <p className="text-[11px] text-muted-foreground font-mono shrink-0 hidden sm:block">
                  {t.address.slice(0, 6)}…{t.address.slice(-4)}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function FundsModal({ view, setView, onClose }: { view: FundView; setView: (v: FundView) => void; onClose: () => void }) {
  return (
    <ModalShell onClose={onClose} className="sm:w-[460px]">
      {view === "home" && <FundsHome onClose={onClose} onPick={setView} />}
      {view === "deposit" && <DepositView onBack={() => setView("home")} onClose={onClose} />}
      {view === "withdraw" && <WithdrawView onBack={() => setView("home")} onClose={onClose} />}
    </ModalShell>
  );
}

function FundsHome({ onClose, onPick }: { onClose: () => void; onPick: (v: FundView) => void }) {
  const me = useMe();
  const myId = useIdentity(me);
  const { balance, loading } = useMonBalance(me);
  const paraSdk = useParaSdk();
  return (
    <>
      <ModalHeader title="Funds" onClose={onClose} />
      <div className="px-4 pb-5 space-y-3">
        <div className="rounded-2xl bg-white/5 p-4">
          <p className="text-xs text-muted-foreground">Available balance</p>
          <div className="flex items-center gap-2 mt-1">
            <MonLogo size={28} />
            <p className="text-3xl font-bold">
              {loading ? "…" : `${balance.toFixed(4)} MON`}
            </p>
          </div>
          {me && (
            <p className="text-[11px] text-muted-foreground mt-1.5 truncate">
              {labelFor(myId)}
            </p>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <button onClick={() => onPick("deposit")} className="h-14 rounded-2xl lit-purple font-semibold">
            Deposit
          </button>
          <button onClick={() => onPick("withdraw")} className="h-14 rounded-2xl bg-white/5 font-semibold">
            Withdraw
          </button>
        </div>
        <button
          disabled
          className="w-full h-14 rounded-2xl bg-white/5 font-semibold inline-flex items-center justify-center gap-2 opacity-60 cursor-not-allowed"
        >
          <span>Buy with debit card</span>
          <span className="text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full bg-primary/20 text-primary font-bold">
            Coming soon
          </span>
        </button>
        {paraSdk && <ExportWalletButton hooks={paraSdk} />}
      </div>
    </>
  );
}

// Opens Para's secure export portal (popup) where the user authenticates
// and reveals their wallet's private key. The key is reconstructed inside
// Para's hosted page — it never touches our code, so this is a pure
// "open the door" button.
function ExportWalletButton({ hooks }: { hooks: any }) {
  const wallet = hooks.useWallet?.() ?? {};
  const exp = hooks.useExportPrivateKey?.() ?? {};
  if (!exp.exportPrivateKey && !exp.exportPrivateKeyAsync) return null;

  const click = async () => {
    try {
      const walletId = wallet?.data?.id;
      await exp.exportPrivateKeyAsync?.(walletId ? { walletId } : {});
    } catch (e: any) {
      console.warn("[export-wallet]", e);
      toast.error(e?.message?.includes("popup")
        ? "Popup blocked — allow popups and try again."
        : "Couldn't open the export portal — try again.");
    }
  };

  return (
    <div>
      <button
        onClick={click}
        disabled={exp.isPending}
        className="w-full h-14 rounded-2xl bg-white/5 hover:bg-white/10 font-semibold inline-flex items-center justify-center gap-2 disabled:opacity-50"
      >
        <KeyRound className="size-4" />
        {exp.isPending ? "Opening…" : "Export wallet"}
      </button>
      <p className="text-[10px] text-muted-foreground text-center mt-1.5">
        Reveals your private key in Para's secure portal. Never share it with anyone.
      </p>
    </div>
  );
}

function WithdrawView({ onBack, onClose }: { onBack: () => void; onClose: () => void }) {
  const me = useMe();
  const { balance: monBalance, refresh: refreshMon } = useMonBalance(me);

  // MON-only withdrawals. To move trading tokens, sell them first on the
  // token page — the MON proceeds land in this same wallet and can be
  // withdrawn here.
  const balance = monBalance;
  const symbol = "MON" as const;

  const [amount, setAmount] = useState("");
  const [to, setTo] = useState("");
  const [sending, setSending] = useState(false);
  const [hash, setHash] = useState<string | null>(null);
  const [sentAmount, setSentAmount] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const gasBufferMon = 0.005;
  const maxWithdraw = Math.max(0, balance - gasBufferMon);
  const setPct = (pct: number) =>
    setAmount((maxWithdraw * pct).toFixed(6));
  const validTo = /^0x[a-fA-F0-9]{40}$/.test(to.trim());
  const amt = Number(amount);
  const valid = me && validTo && amt > 0 && amt <= maxWithdraw;

  const send = async () => {
    if (!valid || !me) return;
    setSending(true); setErr(null); setHash(null); setSentAmount(null);
    try {
      const currentAmount = amt;
      const amountWei = parseEther(amount.trim()).toString();
      const h = await withdrawMon({ data: {
        owner: me,
        to: to.trim() as `0x${string}`,
        amountWei,
      } });
      setHash(h as Hex);
      setSentAmount(currentAmount);
      setAmount("");
      setTimeout(() => { refreshMon(); }, 3000);
    } catch (e: any) {
      setErr(e?.shortMessage ?? e?.message ?? String(e));
    } finally { setSending(false); }
  };

  if (hash) {
    return (
      <>
        <ModalHeader title="Withdrawal sent" onBack={onBack} onClose={onClose} />
        <div className="px-4 pb-5 text-center space-y-3">
          <div className="size-12 rounded-full bg-up/15 text-up grid place-items-center mx-auto">
            <Check className="size-5" />
          </div>
          <p className="text-sm font-semibold">{(sentAmount ?? 0).toFixed(4)} MON sent</p>
          <a
            href={txUrl(hash)}
            target="_blank" rel="noreferrer"
            className="block text-xs text-primary font-mono hover:underline truncate"
          >
            {hash}
          </a>
          <button onClick={onClose} className="w-full h-12 rounded-2xl lit-purple font-semibold">Done</button>
        </div>
      </>
    );
  }

  return (
    <>
      <ModalHeader title="Withdraw" onBack={onBack} onClose={onClose} />
      <div className="px-4 pb-5 space-y-3">
        {/* MON-only — no asset picker. Sell tokens on their page first to convert to MON. */}
        <div className="h-12 rounded-xl bg-white/5 px-3 flex items-center gap-3">
          <MonLogo size={36} />
          <div className="flex-1 text-left">
            <div className="text-sm font-semibold">MON</div>
            <div className="text-[11px] text-muted-foreground">Native Monad</div>
          </div>
          <div className="text-xs font-semibold">{balance.toFixed(4)}</div>
        </div>

        {/* Recipient */}
        <label className="block">
          <span className="text-xs text-muted-foreground">Send to address</span>
          <input
            value={to}
            onChange={(e) => setTo(e.target.value)}
            placeholder="0x…"
            className="mt-1 h-11 w-full rounded-xl bg-white/5 px-3 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-primary/40"
          />
        </label>

        {/* Amount */}
        <div className="rounded-2xl bg-white/5 px-4 py-5 flex items-center justify-between">
          <div className="flex items-center gap-1 text-3xl font-bold min-w-0 flex-1">
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
              placeholder="0"
              inputMode="decimal"
              className="w-full bg-transparent focus:outline-none placeholder:text-muted-foreground/50"
            />
            <span className="text-base text-muted-foreground">{symbol}</span>
          </div>
        </div>

        <div className="grid grid-cols-4 gap-2">
          <button onClick={() => setPct(0.10)} className="h-10 rounded-xl bg-white/5 text-xs font-bold">10%</button>
          <button onClick={() => setPct(0.25)} className="h-10 rounded-xl bg-white/5 text-xs font-bold">25%</button>
          <button onClick={() => setPct(0.50)} className="h-10 rounded-xl bg-white/5 text-xs font-bold">50%</button>
          <button onClick={() => setPct(1.00)} className="h-10 rounded-xl bg-white/5 text-xs font-bold">Max</button>
        </div>

        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">Available</span>
          <span className="font-semibold">{maxWithdraw.toFixed(6)} {symbol}</span>
        </div>
        <p className="text-[11px] text-muted-foreground -mt-1">
          Max leaves ~{gasBufferMon} MON for network gas.
        </p>

        {err && <p className="text-xs text-down">{err}</p>}

        <button
          onClick={send}
          disabled={!valid || sending}
          className="w-full h-14 rounded-2xl lit-purple font-semibold mt-2 disabled:opacity-50"
        >
          {sending ? "Sending…" : `Withdraw ${symbol}`}
        </button>

        <p className="text-[11px] text-muted-foreground text-center leading-relaxed">
          MON only. To withdraw value held in other tokens, sell them on the token page first —
          the MON proceeds land in this same wallet.
        </p>
      </div>
    </>
  );
}

function DepositView({ onBack, onClose }: { onBack: () => void; onClose: () => void }) {
  const me = useMe();
  const [copied, setCopied] = useState(false);
  // The deposit address is the Para API execution wallet used by server-side
  // REST signing.
  const address = me ?? "";
  const copy = () => {
    if (!address) return;
    navigator.clipboard?.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  if (!me) {
    return (
      <>
        <ModalHeader title="Deposit" onBack={onBack} onClose={onClose} />
        <div className="px-4 pb-5 text-center">
          <p className="text-sm text-muted-foreground py-8">
            Sign in to see your deposit address.
          </p>
        </div>
      </>
    );
  }
  return (
    <>
      <ModalHeader title="Deposit with crypto" onBack={onBack} onClose={onClose} />
      <div className="px-4 pb-5 space-y-4">
        <button className="w-full h-12 rounded-2xl bg-white/5 inline-flex items-center justify-center gap-2 font-semibold">
          <MonLogo size={20} />
          Monad
          <ChevronDown className="size-4" />
        </button>

        <p className="text-center text-sm text-muted-foreground">
          Send <span className="font-semibold text-foreground">MON</span> on the Monad network
          to this address.
          <br />
          <span className="text-down/80">Only MON is supported.</span> Sending other tokens may
          result in loss of funds.
        </p>

        <div className="flex justify-center">
          <div className="size-56 rounded-3xl bg-white grid place-items-center p-3">
            <AddressQr value={address} />
          </div>
        </div>

        <button
          onClick={copy}
          className="w-full h-14 rounded-2xl bg-white/5 px-4 inline-flex items-center justify-center gap-2 text-center text-xs font-mono break-all"
        >
          <span className="flex-1 break-all">{address}</span>
          <Copy className="size-4 shrink-0" />
        </button>
        {copied && <p className="text-center text-xs text-up">Copied to clipboard</p>}
      </div>
    </>
  );
}

// Real QR for the user's address. Uses the `qrcode` package — install with
// `npm i qrcode @types/qrcode`. Falls back to a styled placeholder if not
// installed.
function AddressQr({ value }: { value: string }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        // Static import so Vite bundles the qrcode lib.
        const QR: any = await import("qrcode");
        const toDataURL = QR.toDataURL ?? QR.default?.toDataURL;
        const url = await toDataURL(value, {
          margin: 1,
          width: 240,
          color: { dark: "#0a0410", light: "#ffffff" },
        });
        if (!cancel) setDataUrl(url);
      } catch (e) {
        console.warn("[qr] failed to render", e);
      }
    })();
    return () => { cancel = true; };
  }, [value]);
  if (dataUrl) return <img src={dataUrl} alt="Address QR" className="w-full h-full" />;
  return (
    <div className="w-full h-full grid place-items-center text-[10px] text-black/60 font-mono break-all px-2 text-center">
      Generating QR…
    </div>
  );
}

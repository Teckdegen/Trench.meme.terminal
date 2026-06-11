import { useMemo, useRef, useState } from "react";
import {
  Ban, Code2, Download, Info, Trash2, Upload, UserRound, Wallet,
} from "lucide-react";
import {
  useBlocklist,
  isValidAddr,
  exportBlocklistJson,
  parseBlocklistImport,
  mergeBlocklistRows,
  BLOCKLIST_LIMIT,
  type BlocklistFilter,
  type UnifiedBlocklistRow,
} from "@/lib/blocklist";

const FILTERS: { key: BlocklistFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "dev", label: "Dev" },
  { key: "ca", label: "CA" },
];

function CountBadge({ n, active }: { n: number; active?: boolean }) {
  if (n <= 0) return null;
  return (
    <span
      className={`min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold grid place-items-center ${
        active
          ? "bg-primary text-primary-foreground"
          : "bg-amber-500/90 text-background"
      }`}
    >
      {n > 99 ? "99+" : n}
    </span>
  );
}

function KindLabel({ kind }: { kind: UnifiedBlocklistRow["kind"] }) {
  if (kind === "ca") {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-400">
        <Code2 className="size-3" />
        Contract address
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-cyan-400">
      <UserRound className="size-3" />
      Dev wallet
    </span>
  );
}

export function BlocklistManager({ me }: { me: string }) {
  const bl = useBlocklist(me);
  const [filter, setFilter] = useState<BlocklistFilter>("all");
  const [input, setInput] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const allRows = useMemo(() => mergeBlocklistRows(bl.snap), [bl.snap]);
  const devCount = bl.wallets.length;
  const caCount = bl.tokens.length;

  const visible = useMemo(() => {
    if (filter === "dev") return allRows.filter((r) => r.kind === "dev");
    if (filter === "ca") return allRows.filter((r) => r.kind === "ca");
    return allRows;
  }, [allRows, filter]);

  const atLimit = bl.totalCount >= BLOCKLIST_LIMIT;

  const add = async () => {
    setErr(null);
    const raw = input.trim();
    if (!isValidAddr(raw)) {
      setErr("Paste a valid Monad address (0x + 40 hex characters).");
      return;
    }
    if (atLimit) {
      setErr(`Limit reached (${BLOCKLIST_LIMIT} entries). Remove some or export a backup first.`);
      return;
    }
    setBusy(true);
    try {
      let kind: "dev" | "ca";
      if (filter === "dev") kind = "dev";
      else if (filter === "ca") kind = "ca";
      else kind = "ca";

      const ok = kind === "dev"
        ? await bl.blockWallet(raw)
        : await bl.blockToken(raw);
      if (ok) setInput("");
      else setErr("Could not add — check you're connected.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (row: UnifiedBlocklistRow) => {
    if (row.kind === "dev") await bl.unblockWallet(row.address);
    else await bl.unblockToken(row.address);
  };

  const deleteAll = async () => {
    if (!visible.length && filter === "all" && !bl.totalCount) return;
    const label = filter === "all"
      ? "Clear your entire blocklist?"
      : filter === "dev"
        ? "Remove all blocked dev wallets?"
        : "Remove all blocked contract addresses?";
    if (!confirm(label)) return;
    setBusy(true);
    try {
      if (filter === "all") {
        await bl.clearAll();
      } else if (filter === "dev") {
        for (const w of [...bl.wallets]) await bl.unblockWallet(w.address);
      } else {
        for (const t of [...bl.tokens]) await bl.unblockToken(t.address);
      }
    } finally {
      setBusy(false);
    }
  };

  const onExport = () => {
    const blob = new Blob([exportBlocklistJson(bl.snap)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `trench-blocklist-${me.slice(2, 8)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const onImportFile = async (file: File) => {
    setErr(null);
    const text = await file.text();
    const parsed = parseBlocklistImport(text);
    if (!parsed) {
      setErr("Invalid JSON — export a backup from here first.");
      return;
    }
    const merge = confirm("Merge with existing list? Cancel replaces everything.");
    setBusy(true);
    try {
      const ok = await bl.importSnapshot(parsed, merge ? "merge" : "replace");
      if (!ok) setErr(`Import would exceed ${BLOCKLIST_LIMIT} entries.`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-2xl border border-white/10 bg-surface overflow-hidden">
      {/* Header */}
      <div className="px-4 sm:px-5 py-4 border-b border-white/10 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="size-9 rounded-xl bg-primary/15 border border-primary/30 grid place-items-center">
            <Ban className="size-4 text-primary" />
          </div>
          <div>
            <h3 className="font-bold text-base">Blocklist</h3>
            <p className="text-[11px] text-muted-foreground">Private to your wallet only</p>
          </div>
        </div>
      </div>

      <div className="p-4 sm:p-5 space-y-4">
        {/* Add row */}
        <div className="flex gap-2">
          <div className="flex-1 relative">
            <input
              value={input}
              onChange={(e) => { setInput(e.target.value); setErr(null); }}
              onKeyDown={(e) => e.key === "Enter" && add()}
              placeholder="Dev wallet or contract address (0x…)"
              disabled={busy}
              className="w-full h-11 rounded-xl bg-black/40 border border-white/10 px-3 pr-10 text-sm font-mono placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50 disabled:opacity-50"
            />
            <Wallet className="absolute right-3 top-1/2 -translate-y-1/2 size-4 text-primary/60 pointer-events-none" />
          </div>
          <button
            type="button"
            onClick={add}
            disabled={busy || !input.trim() || atLimit}
            className="h-11 px-5 rounded-xl lit-purple text-sm font-bold shrink-0 disabled:opacity-40"
          >
            Blocklist
          </button>
        </div>

        {err && <p className="text-xs text-down -mt-2">{err}</p>}

        {/* Info strip */}
        <div className="flex items-start gap-2 rounded-xl bg-white/[0.03] border border-white/5 px-3 py-2.5">
          <Info className="size-4 text-primary shrink-0 mt-0.5" />
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            <span className="text-foreground font-medium">Dev</span> — flags every token that wallet launches.
            {" "}
            <span className="text-foreground font-medium">CA</span> — warns on that token&apos;s page.
            Nobody else sees your list.
          </p>
        </div>

        {/* Filter chips */}
        <div className="flex flex-wrap items-center gap-2">
          {FILTERS.map((f) => {
            const on = filter === f.key;
            const count =
              f.key === "all" ? bl.totalCount
              : f.key === "dev" ? devCount
              : caCount;
            return (
              <button
                key={f.key}
                type="button"
                onClick={() => setFilter(f.key)}
                className={`h-9 px-3.5 rounded-full text-xs font-semibold inline-flex items-center gap-2 border transition-colors ${
                  on
                    ? "bg-primary/15 border-primary/40 text-foreground"
                    : "bg-black/30 border-white/10 text-muted-foreground hover:text-foreground hover:border-white/20"
                }`}
              >
                {f.label}
                <CountBadge n={count} active={on && count > 0} />
              </button>
            );
          })}
        </div>

        {/* List */}
        <div className="rounded-xl border border-white/10 bg-black/25 min-h-[200px] max-h-[min(52vh,420px)] overflow-y-auto scrollbar-hide">
          {bl.loading ? (
            <p className="px-4 py-12 text-center text-sm text-muted-foreground">Loading your blocklist…</p>
          ) : visible.length === 0 ? (
            <p className="px-4 py-12 text-center text-sm text-muted-foreground">
              {filter === "all"
                ? "Nothing blocked yet. Paste an address above."
                : filter === "dev"
                  ? "No dev wallets blocked."
                  : "No contract addresses blocked."}
            </p>
          ) : (
            <ul>
              {visible.map((row) => (
                <li
                  key={row.id}
                  className="flex items-start gap-3 px-4 py-3 border-b border-white/5 last:border-0 hover:bg-white/[0.02]"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-mono text-foreground break-all leading-snug">
                      {row.address}
                    </p>
                    <div className="mt-1">
                      <KindLabel kind={row.kind} />
                    </div>
                    {row.note && (
                      <p className="text-[10px] text-muted-foreground mt-1 italic truncate" title={row.note}>
                        {row.note}
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => remove(row)}
                    disabled={busy}
                    className="size-9 rounded-lg hover:bg-down/15 text-muted-foreground hover:text-down grid place-items-center shrink-0 disabled:opacity-40"
                    title="Remove"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Footer */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
          <p className="text-xs text-muted-foreground tabular-nums">
            <span className="text-foreground font-semibold">{bl.totalCount}</span>
            {" / "}
            {BLOCKLIST_LIMIT} blocklist entries
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={deleteAll}
              disabled={busy || (filter === "all" ? bl.totalCount === 0 : visible.length === 0)}
              className="h-9 px-4 rounded-full bg-down/20 border border-down/30 text-down text-xs font-bold hover:bg-down/30 disabled:opacity-40"
            >
              Delete {filter === "all" ? "all" : filter === "dev" ? "devs" : "CAs"}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onImportFile(f);
                e.target.value = "";
              }}
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={busy}
              className="h-9 px-4 rounded-full bg-white/5 border border-white/10 text-xs font-semibold hover:bg-white/10 disabled:opacity-40 inline-flex items-center gap-1.5"
            >
              <Upload className="size-3.5" /> Import
            </button>
            <button
              type="button"
              onClick={onExport}
              disabled={busy || bl.totalCount === 0}
              className="h-9 px-4 rounded-full bg-white/5 border border-white/10 text-xs font-semibold hover:bg-white/10 disabled:opacity-40 inline-flex items-center gap-1.5"
            >
              <Download className="size-3.5" /> Export
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

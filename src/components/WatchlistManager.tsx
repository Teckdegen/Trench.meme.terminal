// Watchlist manager for the Settings page — view, add (paste a contract
// address) and remove watched tokens. Backed by the same per-device
// localStorage watchlist used by the star buttons across the app.

import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Star, Plus, Trash2 } from "lucide-react";
import { useWatchlist } from "@/lib/watchlist";
import { fetchTokenSnapshot } from "@/lib/token-index";

type Meta = { symbol: string; name: string; image: string | null };
const metaCache = new Map<string, Meta>();

function useWatchedMeta(addresses: string[]) {
  const [meta, setMeta] = useState<Record<string, Meta>>(() => {
    const seed: Record<string, Meta> = {};
    for (const a of addresses) { const m = metaCache.get(a); if (m) seed[a] = m; }
    return seed;
  });
  const key = addresses.join(",");

  useEffect(() => {
    if (!key) return;
    let cancel = false;
    (async () => {
      for (const a of key.split(",")) {
        if (metaCache.has(a)) continue;
        try {
          const snap = await fetchTokenSnapshot({ data: { token: a } });
          if (!snap) continue;
          const m: Meta = { symbol: snap.symbol ?? "—", name: snap.name ?? "", image: snap.image_uri ?? null };
          metaCache.set(a, m);
          if (!cancel) setMeta((prev) => ({ ...prev, [a]: m }));
        } catch { /* keep address-only fallback */ }
      }
    })();
    return () => { cancel = true; };
  }, [key]);

  return meta;
}

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export function WatchlistManager() {
  const { list, has, toggle } = useWatchlist();
  const meta = useWatchedMeta(list);
  const [input, setInput] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const add = () => {
    const addr = input.trim().toLowerCase();
    if (!/^0x[a-f0-9]{40}$/.test(addr)) { setErr("Enter a valid token contract address."); return; }
    if (has(addr)) { setErr("Already in your watchlist."); setInput(""); return; }
    toggle(addr);
    setInput("");
    setErr(null);
  };

  return (
    <section className="rounded-2xl bg-surface border border-white/5 p-4 space-y-4">
      <div className="flex items-center gap-3">
        <div className="size-9 rounded-xl bg-yellow-400/15 text-yellow-400 grid place-items-center">
          <Star className="size-4 fill-current" />
        </div>
        <div>
          <h2 className="font-semibold text-sm">Watchlist</h2>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {list.length === 0 ? "No tokens yet" : `${list.length} token${list.length === 1 ? "" : "s"}`} · saved on this device.
          </p>
        </div>
      </div>

      {/* Add by address */}
      <div>
        <div className="flex items-center gap-2">
          <input
            value={input}
            onChange={(e) => { setInput(e.target.value); setErr(null); }}
            onKeyDown={(e) => e.key === "Enter" && add()}
            placeholder="Paste a token contract address (0x…)"
            className="flex-1 h-10 rounded-xl bg-white/[0.04] border border-white/10 px-3 text-sm font-mono focus:outline-none focus:border-primary/40"
          />
          <button
            onClick={add}
            disabled={!input.trim()}
            className="h-10 px-4 rounded-xl lit-purple text-sm font-bold inline-flex items-center gap-1.5 disabled:opacity-40"
          >
            <Plus className="size-4" /> Add
          </button>
        </div>
        {err && <p className="text-xs text-down mt-1.5">{err}</p>}
      </div>

      {/* List */}
      {list.length === 0 ? (
        <p className="text-xs text-muted-foreground text-center py-6">
          Star any token (or paste its address above) to track it here.
        </p>
      ) : (
        <ul className="divide-y divide-white/5">
          {list.map((addr) => {
            const m = meta[addr];
            return (
              <li key={addr} className="flex items-center gap-3 py-2.5">
                <Link to="/token/$id" params={{ id: addr }} className="flex items-center gap-3 min-w-0 flex-1 hover:opacity-90">
                  {m?.image ? (
                    <img src={m.image} alt="" className="size-9 rounded-lg object-cover shrink-0" />
                  ) : (
                    <div className="size-9 rounded-lg bg-white/5 grid place-items-center text-[10px] font-bold shrink-0">
                      {(m?.symbol ?? addr.slice(2, 4)).slice(0, 2).toUpperCase()}
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="text-sm font-semibold truncate">{m?.symbol ?? short(addr)}</p>
                    <p className="text-[11px] text-muted-foreground font-mono truncate">{short(addr)}</p>
                  </div>
                </Link>
                <button
                  onClick={() => toggle(addr)}
                  title="Remove from watchlist"
                  className="size-9 grid place-items-center rounded-xl bg-white/5 hover:bg-down/15 text-muted-foreground hover:text-down shrink-0"
                >
                  <Trash2 className="size-4" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

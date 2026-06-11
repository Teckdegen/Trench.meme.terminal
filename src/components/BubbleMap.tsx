// Bubble map — built live from Nad.fun holder data (no Supabase dependency).
// Clusters holders by address prefix for a quick wallet-grouping visual.

import { useEffect, useMemo, useState } from "react";
import { fetchHolders } from "@/lib/nadfun/server";
import { TOKEN_TAB_REFRESH_MS } from "@/lib/token-index";

type Node = {
  account_address: string;
  balance: string;
  cluster_id: number;
  is_insider: boolean;
  is_dev: boolean;
};

const clusterPalette = [
  "#a855f7", "#06b6d4", "#f59e0b", "#10b981", "#ec4899", "#6366f1",
  "#f472b6", "#facc15", "#22c55e", "#fb923c", "#0ea5e9", "#a3e635",
];

function clusterFromAddress(addr: string): number {
  const hex = addr.replace(/^0x/i, "");
  if (!hex) return 0;
  return (parseInt(hex.slice(0, 4), 16) || 0) % clusterPalette.length;
}

export function BubbleMap({
  token,
  creatorAddress,
  height = "70vh",
}: {
  token?: string;
  creatorAddress?: string;
  height?: string;
}) {
  const [rows, setRows] = useState<Node[] | null>(null);

  useEffect(() => {
    if (!token) return;
    const addr = token.toLowerCase();
    const dev = creatorAddress?.toLowerCase();
    let cancel = false;

    const refresh = async () => {
      try {
        const res = await fetchHolders({ data: { token: addr, limit: 200 } });
        const mapped: Node[] = (res.holders ?? []).map((h) => {
          const account = h.account_info?.account_id?.toLowerCase() ?? "";
          return {
            account_address: account,
            balance: h.balance_info?.balance ?? "0",
            cluster_id: clusterFromAddress(account),
            is_insider: false,
            is_dev: !!dev && account === dev,
          };
        });
        if (!cancel) setRows(mapped);
      } catch {
        if (!cancel) setRows([]);
      }
    };

    refresh();
    const poll = setInterval(refresh, TOKEN_TAB_REFRESH_MS);

    return () => {
      cancel = true;
      clearInterval(poll);
    };
  }, [token, creatorAddress]);

  const nodes = useMemo(() => {
    if (rows && rows.length > 0) {
      const maxBal = Math.max(...rows.map((r) => Number(r.balance) || 0));
      const clusters = new Map<number, { cx: number; cy: number; count: number }>();
      rows.forEach((r) => {
        if (!clusters.has(r.cluster_id)) {
          const seed = r.cluster_id || 1;
          clusters.set(r.cluster_id, {
            cx: 15 + ((seed * 53) % 70),
            cy: 15 + ((seed * 37) % 70),
            count: 0,
          });
        }
        clusters.get(r.cluster_id)!.count++;
      });
      return rows.map((n, i) => {
        const c = clusters.get(n.cluster_id)!;
        const angle = (i * 137.5) % 360;
        const radius = 5 + Math.sqrt(c.count) * 1.5;
        const x = c.cx + Math.cos((angle * Math.PI) / 180) * radius;
        const y = c.cy + Math.sin((angle * Math.PI) / 180) * radius;
        const r = 5 + (Number(n.balance) / maxBal) * 28;
        const color = n.is_dev ? "#ef4444"
          : n.is_insider ? "#7e22ce"
          : clusterPalette[n.cluster_id % clusterPalette.length];
        return { x, y, r, color, key: n.account_address, label: n.account_address };
      });
    }
    return [];
  }, [rows]);

  const isLoading = rows === null;
  const isEmpty = rows !== null && nodes.length === 0;

  return (
    <div>
      <div className="relative w-full rounded-xl overflow-hidden bg-surface-2/40" style={{ height }}>
        <svg className="absolute inset-0 w-full h-full">
          {nodes.map((n, i) =>
            nodes.slice(i + 1, i + 4).map((m, j) => (
              <line
                key={`${n.key}-${j}`}
                x1={`${n.x}%`}
                y1={`${n.y}%`}
                x2={`${m.x}%`}
                y2={`${m.y}%`}
                stroke="var(--color-border)"
                strokeWidth="0.5"
              />
            )),
          )}
          {nodes.map((n) => (
            <circle
              key={n.key}
              cx={`${n.x}%`}
              cy={`${n.y}%`}
              r={n.r}
              fill={n.color}
              fillOpacity="0.35"
              stroke={n.color}
              strokeWidth="1"
            >
              {n.label && <title>{n.label}</title>}
            </circle>
          ))}
        </svg>

        {isLoading && (
          <div className="absolute inset-0 grid place-items-center text-sm text-muted-foreground">
            <div className="flex items-center gap-2">
              <span className="size-3 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
              Loading bubble map…
            </div>
          </div>
        )}

        {isEmpty && (
          <div className="absolute inset-0 grid place-items-center text-sm text-muted-foreground text-center px-6">
            No holder data available for this token.
          </div>
        )}
      </div>
      <div className="flex items-center gap-4 mt-3 text-xs text-muted-foreground flex-wrap">
        <span className="flex items-center gap-1.5">
          <span className="size-3 rounded-full" style={{ background: "#a855f7" }} /> Holder
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-3 rounded-full" style={{ background: "#7e22ce" }} /> Insider
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-3 rounded-full" style={{ background: "#ef4444" }} /> Dev
        </span>
      </div>
    </div>
  );
}

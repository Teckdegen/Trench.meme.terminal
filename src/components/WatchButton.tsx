// Star toggle for the token watchlist. Drop it on a token page header or any
// explore row/card. Filled star = watched.

import { Star } from "lucide-react";
import { useWatchlist } from "@/lib/watchlist";

export function WatchButton({
  address,
  size = 16,
  className = "",
}: {
  address: string;
  size?: number;
  className?: string;
}) {
  const { has, toggle } = useWatchlist();
  const on = has(address);
  return (
    <button
      type="button"
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggle(address); }}
      title={on ? "Remove from watchlist" : "Add to watchlist"}
      aria-label={on ? "Remove from watchlist" : "Add to watchlist"}
      className={`grid place-items-center rounded-lg transition-colors ${
        on ? "text-yellow-400" : "text-muted-foreground hover:text-foreground"
      } ${className}`}
    >
      <Star className={on ? "fill-current" : ""} style={{ width: size, height: size }} />
    </button>
  );
}

// Detect $TICKER and @handle in chat / DM bodies and render them as
// clickable Links. Used by both inbox DMs and token-page chat so the
// behaviour matches.
//
// Rules:
//   $WORD  →  /token/$WORD when WORD is a 0x address; otherwise we look
//             up the symbol via a tiny client-side cache (token-index)
//             and route to /token/<address> when known.
//   @WORD  →  /@WORD (the route auto-rewrites to /profile/$username).
//
// Falls back to plain text when nothing matches.

import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

// Captures $TICKER / $0xabc... and @handle / @0xabc...
// Word chars + dots/underscores for handles; alnum for tickers; hex for
// the 0x form.
const TOKEN_RE = /\$([a-zA-Z0-9_]{2,20}|0x[a-fA-F0-9]{40})/g;
const HANDLE_RE = /@([a-zA-Z0-9_.]{2,30}|0x[a-fA-F0-9]{40})/g;

type TickerLookup = (ticker: string) => string | null;

export function renderMentions(
  body: string,
  opts?: { tickerToAddress?: TickerLookup },
): ReactNode {
  if (!body) return body;
  const tickerToAddress = opts?.tickerToAddress;

  // Single pass: walk the string, emit text spans + clickable Links.
  // We merge both regexes by walking the union of matches in order.
  type Hit = { idx: number; end: number; kind: "token" | "handle"; raw: string };
  const hits: Hit[] = [];
  for (const m of body.matchAll(TOKEN_RE)) {
    hits.push({ idx: m.index!, end: m.index! + m[0].length, kind: "token", raw: m[1] });
  }
  for (const m of body.matchAll(HANDLE_RE)) {
    hits.push({ idx: m.index!, end: m.index! + m[0].length, kind: "handle", raw: m[1] });
  }
  hits.sort((a, b) => a.idx - b.idx);

  const out: ReactNode[] = [];
  let cursor = 0;
  let key = 0;
  for (const h of hits) {
    if (h.idx < cursor) continue; // overlap — keep the earlier one
    if (h.idx > cursor) out.push(body.slice(cursor, h.idx));
    cursor = h.end;
    if (h.kind === "token") {
      const isAddr = /^0x[a-fA-F0-9]{40}$/.test(h.raw);
      const resolved = isAddr ? h.raw.toLowerCase() : tickerToAddress?.(h.raw.toUpperCase()) ?? null;
      if (resolved) {
        out.push(
          <Link
            key={`t${key++}`}
            to="/token/$id"
            params={{ id: resolved }}
            className="text-primary hover:underline font-semibold"
            onClick={(e) => e.stopPropagation()}
          >
            ${h.raw}
          </Link>,
        );
      } else {
        // Unknown ticker — render as styled but non-link so it's still visible.
        out.push(
          <span key={`t${key++}`} className="text-primary font-semibold">${h.raw}</span>,
        );
      }
    } else {
      const handle = h.raw.replace(/^@/, "");
      const isAddr = /^0x[a-fA-F0-9]{40}$/.test(handle);
      out.push(
        <Link
          key={`h${key++}`}
          to={"/@{$handle}" as any}
          params={{ handle: handle.toLowerCase() } as any}
          className="text-primary hover:underline font-semibold"
          onClick={(e) => e.stopPropagation()}
        >
          @{handle}
        </Link>,
      );
    }
  }
  if (cursor < body.length) out.push(body.slice(cursor));
  return <>{out}</>;
}

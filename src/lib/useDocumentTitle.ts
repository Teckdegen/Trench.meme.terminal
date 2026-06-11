// Per-page browser-tab title.
//
// TanStack Start has its own `head` route config, but it's static — it
// can read route params but not React state. That's fine for /wallet,
// /settings, /alerts (whose titles never change), but DMs need the live
// partner name, token pages need the resolved symbol, etc.
//
// This hook just writes `document.title` on every change of the page
// label. The site name `trench.meme` is appended automatically so callers
// only ever write the page-specific part.
//
// Usage:
//   useDocumentTitle("Inbox");                       // → "Inbox · trench.meme"
//   useDocumentTitle(`@${partner.handle}`);          // → "@alice · trench.meme"
//   useDocumentTitle(symbol && `$${symbol}`);        // skipped if undefined

import { useEffect } from "react";

const SITE = "trench.meme";
const SEP = " · ";

export function useDocumentTitle(label: string | null | undefined) {
  useEffect(() => {
    if (typeof document === "undefined") return;
    const trimmed = (label ?? "").trim();
    const next = trimmed ? `${trimmed}${SEP}${SITE}` : SITE;
    if (document.title !== next) document.title = next;
  }, [label]);
}

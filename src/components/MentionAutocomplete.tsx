// @ + $ autocomplete dropdown for the post composer.
//
// Usage:
//   <MentionAutocomplete value={body} onChange={setBody}>
//     {(props) => <textarea {...props} />}
//   </MentionAutocomplete>
//
// Detects the active "@xxx" or "$xxx" token under the caret and shows a
// suggestion list. @ → Supabase accounts (by handle/display_name).
//                 $ → Dirol tokens (by symbol).

import { useEffect, useRef, useState, type ReactNode } from "react";
import { supabase } from "@/lib/supabase";
import { SUPABASE_ENABLED } from "@/lib/supabase-hooks";
import { searchTokens, type DirolToken } from "@/lib/dirol";

type Suggestion =
  | { kind: "user"; handle: string; display: string; address: string; image?: string }
  | { kind: "token"; symbol: string; name: string; address: string; image?: string };

type ChildArgs = {
  value: string;
  ref: React.RefObject<HTMLTextAreaElement | null>;
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
};

// Picks remembered across re-renders so the composer can pass them as
// quoted_token / mentioned addresses to createPost (avoids a second Dirol
// search and preserves the exact token the user chose).
export type PickedToken = { symbol: string; address: string };
export type PickedUser  = { handle: string; address: string };

export function MentionAutocomplete({
  value, onChange, onPickToken, onPickUser, children,
}: {
  value: string;
  onChange: (next: string) => void;
  onPickToken?: (t: PickedToken) => void;
  onPickUser?:  (u: PickedUser) => void;
  children: (a: ChildArgs) => ReactNode;
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const [query, setQuery] = useState<{ kind: "@" | "$"; q: string; start: number; end: number } | null>(null);
  const [items, setItems] = useState<Suggestion[]>([]);
  const [highlight, setHighlight] = useState(0);

  // Detect what's under the caret
  const recompute = () => {
    const el = ref.current;
    if (!el) return setQuery(null);
    const pos = el.selectionStart ?? 0;
    const upto = value.slice(0, pos);
    const m = /(^|\s)([@$])([A-Za-z0-9_.]*)$/.exec(upto);
    if (!m) return setQuery(null);
    const kind = m[2] as "@" | "$";
    const q = m[3];
    const start = pos - q.length - 1;     // position of the @ or $
    setQuery({ kind, q, start, end: pos });
  };

  // Fetch suggestions when the active query changes
  useEffect(() => {
    if (!query) { setItems([]); return; }
    const q = query.q.trim();
    let cancel = false;
    (async () => {
      try {
        if (query.kind === "$") {
          const hits = await searchTokens({ data: { search: q || "MON", limit: 8 } });
          if (cancel) return;
          setItems(hits.map((t: DirolToken) => ({
            kind: "token" as const, symbol: t.symbol, name: t.name, address: t.address, image: t.logoURI,
          })));
        } else {
          // @ user — query accounts by handle / display_name / address prefix
          if (!SUPABASE_ENABLED) { setItems([]); return; }
          const sb = supabase();
          const like = `%${q}%`;
          const { data } = await sb.from("accounts")
            .select("address, handle, display_name, image_uri")
            .or(`handle.ilike.${like},display_name.ilike.${like},address.ilike.${q.toLowerCase()}%`)
            .limit(8);
          if (cancel) return;
          setItems((data ?? [])
            .filter((a: any) => !!a.handle)
            .map((a: any) => ({
              kind: "user" as const,
              handle: a.handle as string,
              display: a.display_name || `@${a.handle}`,
              address: a.address,
              image: a.image_uri ?? undefined,
            })));
        }
        setHighlight(0);
      } catch { setItems([]); }
    })();
    return () => { cancel = true; };
  }, [query?.kind, query?.q]);

  const insert = (s: Suggestion) => {
    if (!query) return;
    const token = s.kind === "user" ? `@${s.handle}` : `$${s.symbol}`;
    const next = value.slice(0, query.start) + token + " " + value.slice(query.end);
    onChange(next);
    setQuery(null);
    // Remember the exact pick — composer will pass it to createPost.
    if (s.kind === "token" && onPickToken) onPickToken({ symbol: s.symbol, address: s.address });
    if (s.kind === "user"  && onPickUser)  onPickUser ({ handle: s.handle, address: s.address });
    // restore caret
    requestAnimationFrame(() => {
      const el = ref.current; if (!el) return;
      const pos = query.start + token.length + 1;
      el.setSelectionRange(pos, pos);
      el.focus();
    });
  };

  return (
    <div className="relative">
      {children({
        value,
        ref,
        onChange: (e) => { onChange(e.target.value); requestAnimationFrame(recompute); },
        onKeyDown: (e) => {
          if (query && items.length > 0) {
            if (e.key === "ArrowDown") { e.preventDefault(); setHighlight((h) => (h + 1) % items.length); return; }
            if (e.key === "ArrowUp")   { e.preventDefault(); setHighlight((h) => (h - 1 + items.length) % items.length); return; }
            if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); insert(items[highlight]); return; }
            if (e.key === "Escape") { setQuery(null); return; }
          }
        },
      })}

      {query && items.length > 0 && (
        <ul className="absolute z-30 left-0 right-0 mt-1 max-h-64 overflow-y-auto rounded-xl bg-background border border-white/10 shadow-[0_10px_30px_rgba(0,0,0,0.5)]">
          {items.map((s, i) => (
            <li
              key={s.kind === "user" ? s.handle : s.address}
              onMouseEnter={() => setHighlight(i)}
              onMouseDown={(e) => { e.preventDefault(); insert(s); }}
              className={`flex items-center gap-2 px-3 py-2 cursor-pointer ${i === highlight ? "bg-white/10" : ""}`}
            >
              {s.image
                ? <img src={s.image} className="size-7 rounded-full object-cover" alt="" />
                : <div className="size-7 rounded-full bg-white/10 grid place-items-center text-[10px] font-bold">
                    {(s.kind === "user" ? s.handle : s.symbol).slice(0, 2).toUpperCase()}
                  </div>}
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold truncate">
                  {s.kind === "user" ? `@${s.handle}` : `$${s.symbol}`}
                </div>
                <div className="text-[11px] text-muted-foreground truncate">
                  {s.kind === "user" ? s.display : s.name}
                </div>
              </div>
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                {s.kind === "user" ? "trader" : "token"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

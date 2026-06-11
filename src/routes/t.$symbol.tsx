// $CASHTAG resolver. /t/<SYMBOL_OR_ADDRESS> looks up the token then
// redirects to /token/<address>?tab=<tab>. Default tab=Chat so cashtags
// in social posts land in the token's chat room.
//
// Direct 0x addresses skip the lookup.

import { createFileRoute, redirect } from "@tanstack/react-router";
import { searchTokens } from "@/lib/dirol";
import { useDocumentTitle } from "@/lib/useDocumentTitle";

export const Route = createFileRoute("/t/$symbol")({
  validateSearch: (s: Record<string, unknown>) => ({
    tab: typeof s.tab === "string" ? s.tab : "Chat",
  }),
  beforeLoad: async ({ params, search }) => {
    const q = params.symbol.trim();
    const isAddress = /^0x[a-fA-F0-9]{40}$/.test(q);
    if (isAddress) {
      throw redirect({
        to: "/token/$id",
        params: { id: q },
        search: { tab: search.tab },
      });
    }
    // Resolve via the token search aggregator
    try {
      const hits = await searchTokens({ data: { search: q, limit: 5 } });
      const verified = hits.find((t) => t.isVerified) ?? hits[0];
      if (verified) {
        throw redirect({
          to: "/token/$id",
          params: { id: verified.address },
          search: { tab: search.tab },
        });
      }
    } catch (e) {
      // fall through to 404 component
    }
  },
  component: NotFound,
});

function NotFound() {
  useDocumentTitle("Token not found");
  return (
    <div className="py-20 text-center">
      <p className="text-lg font-bold">$ token not found</p>
      <p className="text-sm text-muted-foreground mt-2">
        Try pasting the contract address into the search bar instead.
      </p>
    </div>
  );
}

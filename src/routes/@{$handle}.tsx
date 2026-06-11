import { createFileRoute } from "@tanstack/react-router";
import { ProfilePageView } from "./profile.$username";

export const Route = createFileRoute("/@{$handle}")({
  component: HandleProfilePage,
  loader: ({ params }) => ({ username: params.handle }),
  validateSearch: (s: Record<string, unknown>) => {
    const edit = s.edit === true || s.edit === "true" || s.edit === "1";
    return edit ? ({ edit: true } as const) : {};
  },
  head: ({ params }) => {
    const u = params.handle.replace(/^@/, "");
    const title = `@${u} · trench.meme`;
    const desc = `Live PnL, trades and follows for @${u} on Monad. Open trench.meme to follow or copy-trade.`;
    const url = `https://trench.meme/@${u}`;
    return {
      meta: [
        { title },
        { name: "description", content: desc },
        { property: "og:type", content: "profile" },
        { property: "og:title", content: title },
        { property: "og:description", content: desc },
        { property: "og:url", content: url },
        { name: "twitter:card", content: "summary_large_image" },
        { name: "twitter:title", content: title },
        { name: "twitter:description", content: desc },
      ],
    };
  },
});

function HandleProfilePage() {
  const { username } = Route.useLoaderData();
  const { edit } = Route.useSearch();
  return <ProfilePageView username={username} openEdit={!!edit} />;
}

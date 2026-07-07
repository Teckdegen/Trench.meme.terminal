// The root path redirects straight into the terminal at /meme. There is no
// marketing landing page — "/" is just an instant hop to the app.

import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  beforeLoad: () => {
    throw redirect({ to: "/meme" });
  },
  component: () => null,
});

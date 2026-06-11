// Nitro outer error handler — prod default returns opaque JSON
// {"error":true,"status":500,"unhandled":true}. Return HTML instead so
// users at least get a reloadable page (and we log the real stack in Vercel).

import { renderErrorPage } from "./lib/error-page";

export default function errorHandler(error: unknown) {
  console.error("[nitro] unhandled:", error);
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

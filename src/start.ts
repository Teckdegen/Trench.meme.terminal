import { createStart, createMiddleware, createCsrfMiddleware } from "@tanstack/react-start";

import { renderErrorPage } from "./lib/error-page";

const csrfMiddleware = createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === "serverFn",
});

const errorMiddleware = createMiddleware().server(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    if (error != null && typeof error === "object" && "statusCode" in error) {
      throw error;
    }
    console.error(error);
    return new Response(renderErrorPage(), {
      status: 500,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
});

export const startInstance = createStart(() => ({
  // Client-only render: the prod SSR bundle was throwing before HTML could
  // stream (Nitro JSON 500 on every route). Shell + hydrate is enough for
  // this app — all data loads client-side via server fns anyway.
  defaultSsr: false,
  requestMiddleware: [csrfMiddleware, errorMiddleware],
}));

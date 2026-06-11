import { createServerFn } from "@tanstack/react-start";

export const getParaConfig = createServerFn({ method: "GET" })
  .handler(async () => {
    const apiKey = (process.env.PARA_API_KEY || process.env.VITE_PARA_API_KEY || "").trim();
    return { apiKey: apiKey || null };
  });

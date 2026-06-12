// Server-side image fetch → data URL. The PnL share card captures itself to
// PNG with html-to-image, which has to re-fetch every <img> — and the avatar
// / token images live on hosts (storage.nadapp.net, image2url, …) that don't
// send CORS headers, so the browser fetch fails and the whole export dies.
// Routing the bytes through a server fn sidesteps CORS entirely.

import { createServerFn } from "@tanstack/react-start";

const MAX_BYTES = 4_000_000;

export const proxyImageAsDataUrl = createServerFn({ method: "POST" })
  .inputValidator((d: { url: string }) => d)
  .handler(async ({ data }) => {
    const url = String(data.url ?? "");
    if (!/^https:\/\//i.test(url)) return { dataUrl: null };
    try {
      const res = await fetch(url, { redirect: "follow" });
      if (!res.ok) return { dataUrl: null };
      const type = res.headers.get("content-type") ?? "";
      if (!type.startsWith("image/")) return { dataUrl: null };
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.byteLength === 0 || buf.byteLength > MAX_BYTES) return { dataUrl: null };
      return { dataUrl: `data:${type};base64,${buf.toString("base64")}` };
    } catch {
      return { dataUrl: null };
    }
  });

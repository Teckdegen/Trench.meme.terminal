// Default visual assets. Used everywhere an avatar / banner is rendered so a
// brand-new user always has something to show.

export const DEFAULT_AVATAR =
  "https://www.image2url.com/r2/default/images/1779999303234-5b9fa706-14c0-4309-af0f-f5f17112bb1c.jpg";

export const DEFAULT_BANNER =
  "https://www.image2url.com/r2/default/images/1780779334706-e0dc3314-612b-4eda-98b5-127ba2bf601d.jpg";

// Richer, more cinematic default banner — deeper trench-purple base with a
// soft radial highlight and subtle noise gradient that doesn't look flat.
export const DEFAULT_BANNER_GRADIENT =
  "radial-gradient(circle at 20% 30%, rgba(168, 85, 247, 0.45), transparent 55%), " +
  "radial-gradient(circle at 80% 70%, rgba(236, 72, 153, 0.30), transparent 50%), " +
  "linear-gradient(135deg, #0a0410 0%, #1a0930 35%, #2d0b52 60%, #1a0930 100%)";

/** Preset banners token creators can pick. `css:` prefix stored in banner_uri. */
export const TOKEN_BANNER_PRESETS = [
  { id: "trench", label: "Trench", value: DEFAULT_BANNER },
  { id: "neon", label: "Neon pulse", value: "css:" + DEFAULT_BANNER_GRADIENT },
  {
    id: "monad",
    label: "Monad green",
    value: "css:linear-gradient(135deg, #0a0410 0%, #052e16 40%, #064e3b 70%, #0a0410 100%)",
  },
  {
    id: "sunset",
    label: "Sunset",
    value: "css:linear-gradient(135deg, #0a0410 0%, #431407 35%, #9a3412 65%, #0a0410 100%)",
  },
] as const;

export function resolveTokenBanner(bannerUri: string | null | undefined): { kind: "image"; src: string } | { kind: "css"; css: string } {
  if (!bannerUri) return { kind: "image", src: DEFAULT_BANNER };
  if (bannerUri.startsWith("css:")) return { kind: "css", css: bannerUri.slice(4) };
  return { kind: "image", src: bannerUri };
}

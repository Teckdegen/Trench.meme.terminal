// Single source of truth for app branding. Change here, ripples everywhere.
export const APP_NAME = "trench.meme";
export const APP_TAGLINE = "Trade onchain. Move smarter.";
export const APP_DESCRIPTION =
  "Onchain trading terminal for Monad — live tokens, copy trading, smart money.";
export const APP_LOGO =
  "https://www.image2url.com/r2/default/images/1780959238331-c0d5e5c5-0b4e-4f0b-82cc-53dc09e8e3f1.png";
// Trooper/mascot art used on PnL share cards. Drop the PNG at
// /public/trench-trooper.png — gets served from the same origin so
// html-to-image PNG export doesn't hit CORS.
export const APP_TROOPER = "/trench-trooper.png";

// Verification badge — shown next to display names when
// accounts.is_verified = true. Flip from the Supabase dashboard
// (no automated criteria, manual approval).
export const VERIFIED_BADGE =
  "https://www.image2url.com/r2/default/images/1780000819106-99318daa-c0fa-472e-a62c-8ddcff6ad278.png";

// Monad native-currency (MON) logo. Used as the currency icon everywhere
// MON shows up — deposit / withdraw / quick-buy amounts / balances / trade
// preview. Use <MonLogo /> from @/components/MonLogo to render.
export const MON_LOGO =
  "https://pbs.twimg.com/profile_images/1967693862559698944/XTfCXXGa_400x400.jpg";

// Official socials — shown in the landing page footer. Update to the real
// handles before launch.
export const APP_X_URL = "https://x.com/trenchmem";
export const APP_TELEGRAM_URL = "https://t.me/trenchmeme";

// Official announcement handle. Any post from this account is broadcast
// to every user's alerts inbox AND pinned at the top of the social feed
// until a newer one is posted. Match is case-insensitive.
export const ANNOUNCEMENT_HANDLE = "trenchmem";

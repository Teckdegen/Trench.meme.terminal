import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  createRootRouteWithContext,
  HeadContent,
  Scripts,
  Link,
  useRouter,
  useRouterState,
} from "@tanstack/react-router";

import appCss from "../styles.css?url";
import { AppLayout } from "@/components/layout/AppLayout";
import { RequireAuthModalHost } from "@/lib/require-auth";
import { AppErrorBoundary } from "@/components/AppErrorBoundary";
import { EncryptionConsentHost } from "@/components/EncryptionConsentHost";
import { FloatingBubbles } from "@/components/FloatingBubbles";
import { InstallPrompt } from "@/components/InstallPrompt";
import { ReferralCapture } from "@/components/ReferralCapture";
import { ReferralOnboarding } from "@/components/ReferralOnboarding";
import { ParaWalletProvider } from "@/components/ParaWalletProvider";
import { LoginGate } from "@/components/LoginGate";
import { PnLShareSink } from "@/components/PnLShareCard";
import { Toaster } from "sonner";
import { useEffect } from "react";

function NotFoundComponent() {
  const router = useRouter();
  // Intercept /@:handle URLs before showing 404. The Vercel rewrite maps
  // /@:handle → /profile/:handle server-side, but on client-side nav (or
  // when TanStack's file router fails to register the @ literal cleanly)
  // we end up here. Reroute to the canonical /profile/$username path so
  // the user actually sees their profile instead of a 404 page.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const path = window.location.pathname;
    const m = /^\/@([^/]+)/.exec(path);
    if (m) {
      const handle = m[1].toLowerCase();
      router.navigate({
        to: "/@{$handle}",
        params: { handle },
        replace: true,
      });
    }
  }, [router]);

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold">404</h1>
        <p className="mt-2 text-sm text-muted-foreground">This route doesn't exist.</p>
        <Link to="/meme" className="mt-6 inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">Go home</Link>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold">Something broke</h1>
        <p className="mt-2 text-sm text-muted-foreground">{error.message}</p>
        <button
          onClick={() => { router.invalidate(); reset(); }}
          className="mt-6 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
        >Try again</button>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "trench.meme" },
      { name: "description", content: "trench.meme — onchain trading terminal for Monad. Discover trending tokens, follow smart money, and copy top traders." },
      { name: "theme-color", content: "#a855f7" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-status-bar-style", content: "black-translucent" },
      { name: "apple-mobile-web-app-title", content: "trench.meme" },
      { property: "og:title", content: "trench.meme" },
      { property: "og:description", content: "Live tokens, copy-trading, smart money — all on Monad." },
      { property: "og:image", content: "https://www.image2url.com/r2/default/images/1780959238331-c0d5e5c5-0b4e-4f0b-82cc-53dc09e8e3f1.png" },
      { property: "og:site_name", content: "trench.meme" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "trench.meme" },
      { name: "twitter:image", content: "https://www.image2url.com/r2/default/images/1780959238331-c0d5e5c5-0b4e-4f0b-82cc-53dc09e8e3f1.png" },
    ],
    scripts: [
      // Plausible — privacy-friendly, no cookies, no consent banner needed.
      // Set VITE_PLAUSIBLE_DOMAIN at build time to enable (e.g. "trench.meme").
      ...(import.meta.env.VITE_PLAUSIBLE_DOMAIN ? [{
        src: "https://plausible.io/js/script.js",
        defer: true,
        "data-domain": import.meta.env.VITE_PLAUSIBLE_DOMAIN as string,
      }] : []),
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "manifest", href: "/manifest.webmanifest" },
      { rel: "icon", href: "https://www.image2url.com/r2/default/images/1780959238331-c0d5e5c5-0b4e-4f0b-82cc-53dc09e8e3f1.png" },
      { rel: "apple-touch-icon", href: "https://www.image2url.com/r2/default/images/1780959238331-c0d5e5c5-0b4e-4f0b-82cc-53dc09e8e3f1.png" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head><HeadContent /></head>
      <body suppressHydrationWarning>{children}<Scripts /></body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  useEffect(() => {
    if (typeof window === "undefined") return;
    const isWasmCompileFailure = (reason: unknown) => {
      const message = reason instanceof Error ? reason.message : String(reason ?? "");
      return reason instanceof WebAssembly.CompileError || message.includes("WebAssembly.Module()");
    };
    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      if (!isWasmCompileFailure(event.reason)) return;
      event.preventDefault();
      console.warn("[wasm] optional crypto wasm failed to initialize; continuing with JS/WebCrypto fallbacks.");
    };
    window.addEventListener("unhandledrejection", onUnhandledRejection);
    return () => window.removeEventListener("unhandledrejection", onUnhandledRejection);
  }, []);

  // Prime the Web Audio context on first user interaction so trade sounds
  // can play without a "user gesture required" error later.
  useEffect(() => {
    import("@/lib/trade-fx").then((m) => m.primeAudioOnFirstClick());
  }, []);
  // The marketing landing page ("/") is fully auth-agnostic: no login gate,
  // no Para modal hosts, no signed-in overlays (bubbles, referral prompts,
  // encryption consent). Whether the visitor has a session or not, the page
  // renders identically — auth only matters once they enter /meme.
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isLanding = pathname === "/";

  return (
    <QueryClientProvider client={queryClient}>
      <ParaWalletProvider>
        <AppLayout><AppErrorBoundary><Outlet /></AppErrorBoundary></AppLayout>
        <ReferralCapture />
        {!isLanding && (
          <>
            <ReferralOnboarding />
            <InstallPrompt />
            <LoginGate />
            <RequireAuthModalHost />
            <EncryptionConsentHost />
            <FloatingBubbles />
          </>
        )}
        <PnLShareSink />
        <Toaster
          position="top-center"
          theme="dark"
          richColors
          closeButton
          toastOptions={{
            style: { background: "#0a0410", border: "1px solid rgba(255,255,255,0.1)" },
          }}
        />
      </ParaWalletProvider>
    </QueryClientProvider>
  );
}

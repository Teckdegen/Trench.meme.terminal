import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { defineConfig } from "vite";
import { fileURLToPath, URL } from "node:url";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import tsconfigPaths from "vite-tsconfig-paths";
import wasm from "vite-plugin-wasm";

const paraAaStub = fileURLToPath(new URL("./src/lib/para-aa-stub.ts", import.meta.url));
const paraExternalWalletStub = fileURLToPath(new URL("./src/lib/para-external-wallet-stub.ts", import.meta.url));
const browserEvents = fileURLToPath(new URL("./src/lib/browser-events.ts", import.meta.url));

export default defineConfig(({ isSsrBuild }) => ({
  plugins: [
    // WASM plugin must run before everything else so secp256k1 .wasm
    // imports resolve to real WASM (not base64-inlined into JS chunks,
    // which is what was triggering the CompileError in production).
    wasm(),
    tailwindcss(),
    tsconfigPaths(),
    tanstackStart({
      server: { entry: "server" },
    }),
    nitro({
      preset: "vercel",
      errorHandler: "./src/nitro-error.ts",
    }),
    viteReact(),
  ],
  build: {
    // esnext enables native top-level await (all modern browsers + Node 18+
    // support it). This is what lets vite-plugin-wasm work without needing
    // vite-plugin-top-level-await, which was breaking the build by trying
    // to transform destructuring down to ES2020-era targets.
    target: "esnext",
    // Don't inline WASM into JS as base64 — let the wasm plugin emit .wasm
    // files served with Vercel's application/wasm header.
    assetsInlineLimit: 0,
    rollupOptions: {
      // Privy ships a few /*#__PURE__*/ annotations in invalid positions
      // that Rollup whines about. Harmless cosmetic warnings — silence them
      // so build logs stay readable.
      onwarn(warning, warn) {
        if (
          warning.code === "INVALID_ANNOTATION" &&
          warning.message?.includes("/*#__PURE__*/")
        ) return;
        warn(warning);
      },
    },
  },
  resolve: {
    alias: {
      "@getpara/aa-alchemy": paraAaStub,
      "@getpara/aa-biconomy": paraAaStub,
      "@getpara/aa-cdp": paraAaStub,
      "@getpara/aa-gelato": paraAaStub,
      "@getpara/aa-pimlico": paraAaStub,
      "@getpara/aa-porto": paraAaStub,
      "@getpara/aa-rhinestone": paraAaStub,
      "@getpara/aa-safe": paraAaStub,
      "@getpara/aa-thirdweb": paraAaStub,
      "@getpara/aa-zerodev": paraAaStub,
      "@getpara/cosmos-wallet-connectors": paraExternalWalletStub,
      "@getpara/evm-wallet-connectors": paraExternalWalletStub,
      "@getpara/solana-wallet-connectors": paraExternalWalletStub,
      ...(!isSsrBuild ? { events: browserEvents } : {}),
    },
  },
}));

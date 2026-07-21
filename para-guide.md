# Para integration guide (trench.meme)

How we use [Para](https://getpara.com) to log a user in with **socials** (Google /
X / Apple) and then trade from a **server-signed wallet** — with **no browser
transaction popups**.

The whole thing hinges on one idea:

> Para actually gives us **two** wallets. We use the browser one only to prove
> "this human is authenticated", then hand off to a **pregen API wallet** that
> our server signs for over Para's REST API. That server wallet is the one the
> user actually holds funds in and trades from.

---

## 1. The two wallets

| | Wallet **A** — embedded / MPC | Wallet **B** — pregen / API |
|---|---|---|
| Created by | the Para **modal** in the browser, on social login | our **server** via Para REST (`POST /v1/wallets`) |
| Signs where | browser (MPC) | our backend, using `PARA_API_SECRET` |
| We use it for | **auth only** (waking the bridge) | **everything** — balances, buys, sells, withdrawals |
| Is it `me`? | briefly, as a bootstrap | **yes, permanently** — `me` = B once the bridge resolves it |

`me` is our app-wide "who is signed in" value (`src/lib/useMe.ts`, persisted to
localStorage). The trick is that `me` starts as **A** for a split second, then
the bridge swaps it to **B**. From then on, `me === B` and every server call is
keyed to B.

---

## 2. End-to-end flow

```
┌────────────── browser ──────────────┐        ┌────────────── server ──────────────┐
│                                      │        │                                     │
│ 1. <ParaProvider> mounts             │        │                                     │
│ 2. user clicks "Continue with Google"│        │                                     │
│    → Para modal → social OAuth       │        │                                     │
│ 3. Para makes embedded wallet A      │        │                                     │
│ 4. ParaSync: setMe(A)  ── bootstrap ─┼──┐     │                                     │
│    + stash the para client on window │  │     │                                     │
│ 5. ParaWalletBridge (needs me)       │  │     │                                     │
│    exports the Para session ─────────┼──┼────►│ registerParaWallet()                │
│                                      │  │     │  • ensureParaApiWallet() via REST   │
│                                      │  │     │    GET/POST /v1/wallets (CUSTOM_ID) │
│                                      │  │     │  • upsert para_wallets{owner:B, id} │
│ 6. bridge: setMe(B)  ◄───────────────┼──┼─────┤  return { owner: B, walletId }      │
│    me is now the SERVER wallet       │  │     │                                     │
│                                      │  │     │                                     │
│ 7. user hits Buy →                   │  │     │                                     │
│    executeServerSwap({ owner:B, … }) ┼──┼────►│ para-server-execute.ts              │
│    (no wallet popup)                 │  │     │  • look up walletId from B          │
│                                      │  │     │  • POST /v1/wallets/{id}/            │
│                                      │  │     │        sign-transaction (broadcast  │
│                                      │  │     │        false) with X-API-Key        │
│ 8. tx hash ◄─────────────────────────┼──┼─────┤  • sendRawTransaction via viem      │
└──────────────────────────────────────┘  │     └─────────────────────────────────────┘
                                           └── me lives in localStorage; the ONLY thing
                                               that clears it is an explicit sign-out.
```

---

## 3. Environment

**Modal API key** — read *server-side* by `getParaConfig()`
(`src/lib/para-config.ts`) and handed to the client so the modal can boot:

```bash
PARA_API_KEY=...               # (or VITE_PARA_API_KEY) — the modal's public key
VITE_MONAD_RPC_URL=https://rpc.monad.xyz
```

**Server (secret) — the wallet that can sign:**

```bash
PARA_API_SECRET=...            # X-API-Key for all REST calls (sign, create wallet)
PARA_API_BASE=https://api.getpara.com   # optional override
MONAD_RPC_URL=https://rpc.monad.xyz
```

> `PARA_API_SECRET` is the only credential that can move funds. It never touches
> the browser — every signing call runs behind a `createServerFn`.

---

## 4. Client — the modal + social auth

`src/components/ParaWalletProvider.tsx`. We lazy-load `@getpara/react-sdk-lite`
and configure the modal so it **only** does social auth and never pops its own
wallet/funds screens.

```tsx
<ParaProvider
  paraClientConfig={{ env: Environment.PROD, apiKey }}
  config={{ appName: APP_NAME }}
  configOverrides={{
    authConfig: {
      oAuthMethods: ["GOOGLE", "TWITTER", "APPLE"], // socials only
      disableEmailLogin: true,
      disablePhoneLogin: true,
      isGuestModeEnabled: false,
    },
    modalConfig: {
      disableAddFundsPrompt: true,   // Para must never open funds UI on its own
      authLayout: ["AUTH:FULL"],
      hideWallets: false,
    },
  }}
>
  {children}
  <ParaSync hooks={Mod} />          {/* bootstraps me + exposes the client */}
  <ParaWalletBridge hooks={Mod} />  {/* hands off to the server wallet */}
</ParaProvider>
```

Opening the modal to sign in is just:

```tsx
const { openModal } = Mod.useModal();
<button onClick={() => openModal()}>Log in</button>
```

That's the entire "auth" surface. After the user picks Google/X/Apple and Para
finishes OAuth, `useAccount().isConnected` flips to `true` and Para has minted
embedded wallet **A**.

---

## 5. `ParaSync` — bootstrap `me` and expose the client

Same file. Two jobs, both deliberately minimal:

```tsx
function ParaSync({ hooks }) {
  const me = useMe();
  const account = hooks.useAccount();
  const client  = hooks.useClient();

  // (a) BOOTSTRAP ONLY: set me to the embedded address, and only when empty.
  //     This wakes the bridge (which requires a truthy me to mount). We must
  //     NEVER override it afterwards, or trades break with
  //     "No Para REST wallet for 0x…" once the bridge has set me = B.
  useEffect(() => {
    if (isSigningOut()) { if (me) setMe(undefined); return; }
    const addr = account?.isConnected ? address?.toLowerCase() : undefined;
    if (addr && !me) setMe(addr);          // ← the only write here
  }, [account?.isConnected, address, me]);

  // (b) Expose the Para client for optional browser-side viem signing.
  useEffect(() => {
    if (client) (window as any).__trenchParaClient = client;
    return () => { delete (window as any).__trenchParaClient; };
  }, [client]);
}
```

Two rules that cost us real bugs:

- **Bootstrap-only write** (`if (addr && !me)`). If you also write on later
  account refreshes, you clobber `me = B` back to `me = A`.
- **Never clear `me` on a disconnect.** Para reports `isConnected = false` during
  hydration and SPA navigations even with a live session. `me` in localStorage is
  the source of truth; only an explicit sign-out clears it.

---

## 6. `ParaWalletBridge` — hand off to the server wallet

`src/components/ParaWalletBridge.tsx`. This is the actual A → B handover. It only
mounts once `me` is truthy, exports the Para session, and registers the API
wallet server-side.

```tsx
function BridgeInner({ hooks, me }) {
  const account = hooks.useAccount();
  const client  = hooks.useClient();

  useEffect(() => {
    if (!account?.isConnected || !client || !walletId || !me) return;

    (async () => {
      // Export the Para session so the server can (re)build REST creds.
      const session = await (client.waitAndExportSession ?? client.exportSession)
        ?.call(client, { excludeSigners: false });
      const sessionCookie = client.retrieveSessionCookie?.() ?? null;

      const registered = await registerParaWallet({
        data: { owner: authOwner, paraUserId, walletId, session, sessionCookie },
      });

      // registered.owner is the PREGEN / API wallet B — make it the canonical me.
      const apiOwner = registered?.owner?.toLowerCase();
      if (apiOwner && /^0x[a-f0-9]{40}$/.test(apiOwner)) setMe(apiOwner);
    })();
  }, [account?.isConnected, client, me, paraUserId, uiOwner, walletId]);
}
```

After this runs, `me` is wallet **B** and the app is fully "logged in" to the
wallet it will actually trade from.

---

## 7. Server — create/resolve the API wallet (`registerParaWallet`)

`src/lib/para-session.ts`. The server ensures a **pregen EVM wallet** keyed to a
stable Para user id (so the same human always maps to the same B), then persists
the mapping we sign against later.

```ts
function apiWalletIdentifier({ owner, paraUserId }) {
  // Prefer the stable Para user id; fall back to the auth address.
  return paraUserId?.trim() ? `para:${paraUserId.trim()}` : owner.toLowerCase();
}

async function ensureParaApiWallet(data) {
  const userIdentifier = apiWalletIdentifier(data);

  // 1) already have one?  GET /v1/wallets?type=EVM&userIdentifierType=CUSTOM_ID
  const list = await paraRest(`/v1/wallets?type=EVM&status=ready` +
    `&userIdentifier=${userIdentifier}&userIdentifierType=CUSTOM_ID`);
  const existing = list.data?.find((w) => w.id && w.address);
  if (existing?.address) return existing;

  // 2) otherwise create one.  POST /v1/wallets
  return await paraRest("/v1/wallets", {
    method: "POST",
    headers: { "Idempotency-Key": crypto.randomUUID() },
    body: JSON.stringify({
      type: "EVM",
      userIdentifier,
      userIdentifierType: "CUSTOM_ID",
      scheme: "DKLS",
    }),
  });
}

export const registerParaWallet = createServerFn({ method: "POST" })
  .inputValidator((d) => d)
  .handler(async ({ data }) => {
    const wallet = await ensureParaApiWallet(data);
    const addr = wallet.address.toLowerCase();

    // The row para-server-execute.ts reads to find the walletId to sign with.
    await supabaseAdmin().from("para_wallets").upsert({
      owner_address: addr,          // ← wallet B, our canonical `me`
      para_user_id: data.paraUserId ?? null,
      wallet_id:    wallet.id,      // ← what we POST sign-transaction to
      session:        data.session ?? null,
      session_cookie: data.sessionCookie ?? null,
      expires_at: new Date(Date.now() + 7 * 86_400_000).toISOString(),
    }, { onConflict: "owner_address" });

    return { ok: true, owner: addr, walletId: wallet.id };
  });
```

`paraRest` is a thin `fetch` wrapper that sets `X-API-Key: PARA_API_SECRET`.

---

## 8. Server — signing a transaction over REST

`src/lib/para-server-execute.ts`. Signing is **server-only** (guarded by
`assertServerRuntime()`), so there is never a browser wallet popup. We look up the
`wallet_id` for `me`, ask Para to sign (but not broadcast), then broadcast with
viem.

```ts
async function paraWalletFor(owner) {
  const { data } = await admin().from("para_wallets")
    .select("wallet_id, expires_at")
    .eq("owner_address", owner.toLowerCase())
    .maybeSingle();
  if (data?.expires_at && Date.now() > +new Date(data.expires_at))
    throw new Error("Para session expired - sign in again.");
  if (!data?.wallet_id)
    throw new Error(`No Para REST wallet for ${owner}. Sign out and back in.`);
  return { walletId: data.wallet_id };
}

async function paraRestSignTransaction(owner, tx) {
  const { apiKey, baseUrl } = paraCreds();          // PARA_API_SECRET
  const { walletId } = await paraWalletFor(owner);

  const res = await fetch(`${baseUrl}/v1/wallets/${walletId}/sign-transaction`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "X-API-Key": apiKey,
      "Idempotency-Key": crypto.randomUUID(),
    },
    body: JSON.stringify({
      broadcast: false,               // we broadcast ourselves
      transaction: {
        to: tx.to, chainId: 143, type: 0,
        value: (tx.value ?? 0n).toString(),
        data: tx.data ?? "0x",
        nonce: tx.nonce,
        gasLimit: tx.gasLimit.toString(),
        gasPrice: tx.gasPrice.toString(),
      },
    }),
  });

  const json = await res.json();
  // Para returns the raw signed tx; push it to Monad via viem.
  const pub = createPublicClient({ chain: monadChain, transport: monadTransport });
  return await pub.sendRawTransaction({ serializedTransaction: json.signedTransaction });
}
```

`sendViaPara(owner, { to, data, value })` wraps this with gas estimation + a
`pub.call(...)` preflight (so a would-be revert surfaces as a clean error before
we ever sign), and everything user-facing goes through server functions:

```ts
// The UI submits intent; the server signs + broadcasts. No popup.
export const executeServerSwap = createServerFn({ method: "POST" })
  .inputValidator((d) => d)
  .handler(async ({ data }) => {
    const { fireWithPara } = await import("./para-server-execute");
    return fireWithPara({ owner: data.owner.toLowerCase(), /* … */ });
  });

export const withdrawMon = createServerFn({ method: "POST" })
  .handler(async ({ data }) => sendViaPara(data.owner, { to: data.to, value: … }));
```

---

## 9. Calling it from the UI

The client never signs — it calls the server function with `me` (= wallet B) and
waits for a hash:

```ts
import { executeServerSwap } from "@/lib/para-session";

const me = useMe();                 // wallet B
const hash = await executeServerSwap({
  data: {
    owner: me,
    venue: "auto",
    side: "BUY",
    tokenAddress,
    amountIn: rawAmountWei.toString(),
    slippageBps: 50,
    source: "market",
  },
});
// hash is on-chain — show it, link to the explorer. No wallet modal ever opened.
```

---

## 10. Gotchas we already hit (don't relearn them)

- **Bootstrap `me` only when empty.** `ParaSync` must use `if (addr && !me)`.
  Overriding on later refreshes resets `me` to the unused embedded wallet A and
  every trade dies with *"No Para REST wallet for 0x…"*.
- **Only sign out clears `me`.** Never clear on `isConnected === false` — that's
  just hydration/nav flicker and it flashes the login gate.
- **Signing is server-only.** `assertServerRuntime()` throws if any signing code
  runs in the browser. Funds move exclusively through `createServerFn`s using
  `PARA_API_SECRET`.
- **Session expiry is lazy.** We don't force a logout when the Para session
  lapses; `paraWalletFor()` throws *"Para session expired - sign in again"* at
  trade time, which is the right moment to prompt.
- **Pregen wallets can't be exported.** Wallet B is an API/pregen wallet — there
  is no seed phrase to hand the user. Withdrawals go through `withdrawMon`
  (server-signed), not a client export.
- **Idempotency keys** on every mutating REST call (`create`, `sign`) so retries
  don't double-create wallets or double-sign.

---

## File map

| File | Role |
|---|---|
| `src/components/ParaWalletProvider.tsx` | Loads the SDK, configures the social-auth modal, mounts `ParaSync` + `ParaWalletBridge` |
| `src/components/ParaWalletBridge.tsx` | A → B handover: export session, `registerParaWallet`, `setMe(B)` |
| `src/lib/para-session.ts` | `registerParaWallet` (ensure/persist API wallet) + `executeServerSwap` / `withdrawMon` / `unwrapWmon` server fns |
| `src/lib/para-server-execute.ts` | Server-only signing: `paraRestSignTransaction`, `sendViaPara`, `fireWithPara` |
| `src/lib/para-config.ts` | Surfaces the public API key to the client (`getParaConfig`) |
| `src/lib/para.ts` | Optional browser viem client (`getParaWalletClient`) + Monad chain def |
| `src/lib/useMe.ts` | App-wide `me` (localStorage-backed source of truth) |

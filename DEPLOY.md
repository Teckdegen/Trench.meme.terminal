# Deploy

Two apps: the **web** (TanStack Start frontend + server functions) and the **workers** (8 background processes). Both ship as Docker images; the easiest target is Fly.io but anything that runs containers works.

## 0. Prereqs

- Supabase project — paid plan if you expect concurrent realtime > 200 sockets
- Monad mainnet RPC + WS — Alchemy, QuickNode, Chainstack or self-host
- Agora.io project (App ID + App Certificate from https://console.agora.io)
- Dirol — public API, get a key from them if you blow past the open rate limit
- (optional) Telegram bot token for push alerts
- (optional) Resend / Postmark for email push

## 1. Database

```bash
# In Supabase SQL editor — paste and run the entire file once:
supabase/schema.sql
```

Open **Database → Replication** and add to `supabase_realtime`:
`notifications, posts, post_likes, follows, alerts, limit_orders, copy_configs, sniper_configs, token_markets, trades, referrals, referral_earnings, points_ledger, redemptions`.

Grab from **Settings → API**:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (server-only)
- `SUPABASE_JWT_SECRET` (server-only, used by SIWE → JWT minting)

## 2. Frontend (web)

### Fly.io
```bash
fly launch --copy-config --name monad-terminal-web --no-deploy
fly secrets set \
  NADFUN_API_KEY=... \
  SUPABASE_JWT_SECRET=... \
  VITE_SUPABASE_URL=... \
  VITE_SUPABASE_ANON_KEY=... \
  SUPABASE_SERVICE_ROLE_KEY=... \
  VITE_MONAD_RPC_URL=https://rpc.monad.xyz \
  VITE_AGORA_APP_ID=... \
  AGORA_APP_ID=... AGORA_APP_CERTIFICATE=...
fly deploy --config fly.web.toml --dockerfile Dockerfile.web
```

### Vercel / Cloudflare Pages
Push to git, import the repo, add the same env vars in the project settings, build command `npm run build`, output `.output`. TanStack Start works on both.

## 3. Workers

### Fly.io (one container, 8 pm2 processes)
```bash
fly launch --copy-config --name monad-terminal-workers --no-deploy
fly secrets set \
  VITE_SUPABASE_URL=... \
  SUPABASE_SERVICE_ROLE_KEY=... \
  MONAD_RPC_URL=... \
  MONAD_WS_URL=... \
  NADFUN_API_BASE=https://api.nad.fun \
  NADFUN_API_KEY=... \
  SESSION_KEY_ENVELOPE=$(node -e "console.log(crypto.randomBytes(32).toString('hex'))") \
  SNIPER_OBSERVER_KEY=0x... \
  AGORA_APP_ID=... AGORA_APP_CERTIFICATE=... \
  TELEGRAM_BOT_TOKEN=... \
  RESEND_API_KEY=...
fly deploy --config fly.workers.toml --dockerfile Dockerfile.workers
```

### Railway / Hetzner / any VPS
```bash
git pull && npm ci
cp .env.example .env   # fill it
npm i -g pm2
pm2 start ecosystem.config.cjs
pm2 save && pm2 startup     # auto-start on boot
pm2 logs                    # tail all 8
```

## 4. Hosting cost ballpark (≈ 2k DAU)

| Item | Provider | Cost |
|---|---|---|
| Frontend | Fly / Vercel | $0–$10 |
| Workers (1 container, 8 procs) | Fly 512MB–1GB | $5–$15 |
| Monad RPC + WS | Alchemy / QuickNode "Build" | ~$50 |
| Supabase | Pro plan | $25 |
| Agora.io | Pay-as-you-go (~$0.99 / 1k voice minutes) | ~$30 at 2k DAU |
| Telegram bot | self | $0 |
| Email push (Resend) | free tier covers ~3k/mo | $0–$20 |
| **Total** | | **~$130–$170 / mo** |

## 5. Smoke test

1. Open the deployed web URL → connect wallet → see your address in the top bar
2. Run `npm run indexer` locally pointed at the same Supabase → confirm `tokens` table starts filling
3. Hit `/token/0x<a-real-monad-token>` → see live name, price, candles, metrics
4. Place a $1 buy → tx in MonadScan, row in `trades`
5. Create an alert → fire a matching trade → notification appears in `/alerts` Inbox
6. Open a Room → voice connects via Agora

If those six pass, you're shipped.

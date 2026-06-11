#!/usr/bin/env bash
# trench.meme — one-shot local setup.
#
# Generates fresh secrets where appropriate and writes .env templates for
# both the frontend and the bot. Safe to re-run — won't overwrite existing
# .env files.
#
# Usage:
#   ./scripts/setup.sh

set -euo pipefail

CYAN="\033[36m"; GREEN="\033[32m"; YELLOW="\033[33m"; RED="\033[31m"; RESET="\033[0m"

say()  { echo -e "${CYAN}❯${RESET} $*"; }
ok()   { echo -e "${GREEN}✓${RESET} $*"; }
warn() { echo -e "${YELLOW}!${RESET} $*"; }
fail() { echo -e "${RED}✗${RESET} $*"; exit 1; }

# ─────────── prerequisites ───────────────────────────────────────────
command -v node >/dev/null 2>&1 || fail "node not installed"
command -v npm  >/dev/null 2>&1 || fail "npm not installed"

NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]")
if [ "$NODE_MAJOR" -lt 20 ]; then
  fail "Node 20+ required (you have $(node -v))"
fi

ok "node $(node -v) detected"

# ─────────── helpers ─────────────────────────────────────────────────
rand_hex() {
  # $1 = byte length
  node -e "console.log(require('crypto').randomBytes($1).toString('hex'))"
}
rand_pk() {
  echo "0x$(rand_hex 32)"
}

# ─────────── frontend .env.local ─────────────────────────────────────
ROOT_ENV=".env.local"
if [ -f "$ROOT_ENV" ]; then
  warn "$ROOT_ENV already exists — skipping. Delete it first if you want to regenerate."
else
  say "Writing $ROOT_ENV (frontend)…"
  cat > "$ROOT_ENV" <<EOF
# ─── Supabase (browser-safe) ─────────────────────────────────────────
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=

# ─── Supabase (SERVER-FNS ONLY — never expose to browser) ────────────
SUPABASE_SERVICE_ROLE_KEY=

# ─── Para ───────────────────────────────────────────────────────────
VITE_PARA_API_KEY=
PARA_API_KEY=
PARA_API_SECRET=

# ─── Monad ───────────────────────────────────────────────────────────
# Browser uses this for read-only RPC calls. Use a paid endpoint in prod.
VITE_MONAD_RPC_URL=https://rpc.monad.xyz

# ─── Gun.js relay (frontend points at the bot's deployed gun-relayer) ─
# Local: ws://localhost:8765/gun     Prod: https://<bot-domain>/gun
VITE_GUN_PEERS=ws://localhost:8765/gun

# ─── Agora (voice rooms) — optional ──────────────────────────────────
VITE_AGORA_APP_ID=
AGORA_APP_CERTIFICATE=

# ─── Analytics — optional ────────────────────────────────────────────
VITE_PLAUSIBLE_DOMAIN=
EOF
  ok "wrote $ROOT_ENV"
fi

# ─────────── bot .env ────────────────────────────────────────────────
BOT_ENV="bot/.env"
if [ -f "$BOT_ENV" ]; then
  warn "$BOT_ENV already exists — skipping."
else
  say "Generating bot secrets + writing $BOT_ENV…"
  SNIPER_KEY=$(rand_pk)
  cat > "$BOT_ENV" <<EOF
# ─── Supabase ────────────────────────────────────────────────────────
VITE_SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=

# ─── Monad chain ─────────────────────────────────────────────────────
MONAD_RPC_URL=https://rpc.monad.xyz
MONAD_WS_URL=wss://your-paid-ws-endpoint

# ─── Nad.fun ─────────────────────────────────────────────────────────
# Run scripts/register-nadfun-key.js to mint one.
NADFUN_API_BASE=https://api.nad.fun
NADFUN_API_KEY=

# ─── Sniper observer (auto-generated read-only burner key) ───────────
SNIPER_OBSERVER_KEY=$SNIPER_KEY

# ─── Para server SDK ────────────────────────────────────────────────
PARA_API_KEY=
PARA_API_SECRET=

# ─── Gun.js relayer ──────────────────────────────────────────────────
GUN_PORT=8765
GUN_HOST=0.0.0.0
GUN_DATA_DIR=./gun-data
GUN_ALLOW_ORIGIN=*
PUBLIC_GUN_URL=
GUN_MAX_MESSAGE_AGE_DAYS=90

# ─── Platform fees (silent) ──────────────────────────────────────────
FEE_WALLET_ADDRESS=
FEE_WALLET_PRIVATE_KEY=
WMON_ADDRESS=0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A
FEE_BPS_MARKET=85
FEE_BPS_LIMIT=250
FEE_BPS_COPY=350
FEE_BPS_SNIPER=250

# ─── Optional notification fan-out ───────────────────────────────────
TELEGRAM_BOT_TOKEN=
RESEND_API_KEY=
EOF
  ok "wrote $BOT_ENV"
  ok "generated SNIPER_OBSERVER_KEY (read-only, no funds needed)"
fi

# ─────────── deps ────────────────────────────────────────────────────
if [ ! -d "node_modules" ]; then
  say "Installing frontend deps…"
  npm install --silent
  ok "frontend deps installed"
else
  ok "frontend node_modules already present"
fi

if [ ! -d "bot/node_modules" ]; then
  say "Installing bot deps…"
  (cd bot && npm install --silent)
  ok "bot deps installed"
else
  ok "bot node_modules already present"
fi

# ─────────── public assets ───────────────────────────────────────────
mkdir -p public
if [ ! -f "public/mon-logo.png" ]; then
  warn "public/mon-logo.png missing — see LAUNCH.md §10 about self-hosting the Monad logo."
fi

# ─────────── final instructions ──────────────────────────────────────
echo ""
say "─────────────────────────────────────────────"
ok "Setup complete. Next steps:"
echo ""
echo "  1. Fill in real values in .env.local and bot/.env"
echo "     (Supabase URL+keys, Para API key+secret, fee wallet, etc.)"
echo ""
echo "  2. Run the schema: paste supabase/schema.sql into your Supabase SQL editor."
echo ""
echo "  3. Mint a Nad.fun API key:"
echo "       node scripts/register-nadfun-key.js --private-key 0x... --name 'trench bot'"
echo ""
echo "  4. Start it:"
echo "       Terminal 1:  npm run dev               (frontend → :3000)"
echo "       Terminal 2:  cd bot && npm run all     (bot workers via pm2)"
echo ""
echo "  Full guide: LAUNCH.md"
say "─────────────────────────────────────────────"


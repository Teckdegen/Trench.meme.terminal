-- Monad Terminal — complete Supabase schema (single file)
-- Run once in the Supabase SQL editor. Safe to re-run (IF NOT EXISTS / DROP IF EXISTS).
--
-- Includes: tables, indexes, triggers, feed ranking, rewards RPC, blocklist,
-- para sessions, referrals, RLS policies, legacy chat-table cleanup.
--
-- Conventions:
--   * EVM addresses stored as text, lower-cased on insert.
--   * Token amounts stored as numeric(78,0) (uint256 max).
--   * JWT `sub` = wallet address (SIWE) — RLS uses auth_addr().
--   * Workers use service-role key and bypass RLS.

------------------------------------------------------------
-- Extensions
------------------------------------------------------------
create extension if not exists "pgcrypto";

------------------------------------------------------------
-- Helpers
------------------------------------------------------------
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

create or replace function auth_addr() returns text language sql stable as $$
  select lower(coalesce(auth.jwt() ->> 'sub', ''));
$$;

------------------------------------------------------------
-- accounts
------------------------------------------------------------
create table if not exists accounts (
  address             text primary key,
  handle              text unique,
  display_name        text,
  bio                 text,
  image_uri           text default 'https://www.image2url.com/r2/default/images/1779999303234-5b9fa706-14c0-4309-af0f-f5f17112bb1c.jpg',
  banner_uri          text,
  twitter_url         text,
  telegram_url        text,
  website_url         text,
  is_verified         boolean default false,
  pref_slippage_bps   integer default 50,
  pref_gas_priority   text default 'med' check (pref_gas_priority in ('low','med','high')),
  pref_quick_amounts  integer[] default '{50,500,2000,5000}',
  pref_default_venue  text default 'auto' check (pref_default_venue in ('auto','nadfun','dirol')),
  pref_dark_mode      boolean default true,
  telegram_chat_id    text,
  email               text,
  onboarded_at        timestamptz,
  points_balance      bigint default 0,
  created_at          timestamptz default now(),
  updated_at          timestamptz default now()
);
create trigger accounts_updated before update on accounts
  for each row execute function set_updated_at();
create index if not exists accounts_handle_idx on accounts (handle);
create unique index if not exists accounts_handle_lower_unique
  on accounts (lower(handle)) where handle is not null;

update accounts
  set image_uri = 'https://www.image2url.com/r2/default/images/1779999303234-5b9fa706-14c0-4309-af0f-f5f17112bb1c.jpg'
  where image_uri is null;

------------------------------------------------------------
-- tokens
------------------------------------------------------------
create table if not exists tokens (
  address          text primary key,
  symbol           text not null,
  name             text not null,
  decimals         smallint default 18,
  image_uri        text,
  banner_uri       text,
  description      text,
  twitter_url      text,
  telegram_url     text,
  website_url      text,
  -- creator_address has NO FK: token creators may not be registered users.
  -- Indexer upserts a stub account row whenever it sees a new creator.
  creator_address  text,
  pool_address     text,
  quote_address    text,
  version          text default 'V2' check (version in ('V1','V2')),
  is_graduated     boolean default false,
  is_nsfw          boolean default false,
  is_cto           boolean default false,
  total_supply     numeric(78,0),
  created_at_chain timestamptz,
  created_at       timestamptz default now(),
  updated_at       timestamptz default now()
);
create trigger tokens_updated before update on tokens
  for each row execute function set_updated_at();
create index if not exists tokens_symbol_idx on tokens (symbol);
create index if not exists tokens_graduated_idx on tokens (is_graduated);
create index if not exists tokens_created_chain_idx on tokens (created_at_chain desc);

-- Existing dev DBs may still have the old FK from before — drop it.
alter table tokens drop constraint if exists tokens_creator_address_fkey;

------------------------------------------------------------
-- token_markets
------------------------------------------------------------
create table if not exists token_markets (
  token_address   text primary key references tokens(address) on delete cascade,
  market_type     text,
  market_id       text,
  reserve_native  numeric,
  reserve_quote   numeric,
  reserve_token   numeric,
  price_usd       numeric,
  price_native    numeric,
  quote_price_usd numeric,
  ath_price_usd   numeric,
  volume_usd      numeric,
  liquidity_usd   numeric,
  pct_change_1h   numeric,
  pct_change_24h  numeric,
  holder_count    integer,
  progress_bps    integer,
  updated_at      timestamptz default now()
);

-- Existing DBs: add market metric columns if missing
alter table token_markets add column if not exists liquidity_usd numeric;
alter table token_markets add column if not exists pct_change_1h numeric;
alter table token_markets add column if not exists pct_change_24h numeric;
alter table tokens add column if not exists banner_uri text;

-- DexScreener-style landing page needs more timeframes + transaction
-- aggregates. Stored on token_markets so a single row read serves the
-- whole row in the landing table. Bot updates these on every tick.
alter table token_markets add column if not exists pct_change_5m   numeric;
alter table token_markets add column if not exists pct_change_6h   numeric;
alter table token_markets add column if not exists txns_24h        integer;
alter table token_markets add column if not exists traders_24h     integer;
alter table token_markets add column if not exists buys_24h        integer;
alter table token_markets add column if not exists sells_24h       integer;

-- Indexes for the landing-page filter tabs (rank by 24h %, by volume,
-- by created_at). Partial index on rows with prices keeps it tight.
create index if not exists token_markets_24h_idx
  on token_markets (pct_change_24h desc) where pct_change_24h is not null;
create index if not exists token_markets_volume_idx
  on token_markets (volume_usd desc nulls last) where volume_usd is not null;
create index if not exists tokens_created_idx
  on tokens (created_at_chain desc nulls last);

------------------------------------------------------------
-- token_ohlc — indexed candles (worker upserts from Nad.fun / Gecko)
------------------------------------------------------------
create table if not exists token_ohlc (
  token_address text not null references tokens(address) on delete cascade,
  resolution    text not null,
  bucket_ts     timestamptz not null,
  open          numeric not null,
  high          numeric not null,
  low           numeric not null,
  close         numeric not null,
  volume        numeric default 0,
  primary key (token_address, resolution, bucket_ts)
);
create index if not exists token_ohlc_lookup_idx
  on token_ohlc (token_address, resolution, bucket_ts desc);

------------------------------------------------------------
-- token_chat_messages — indexed per-token chat (replaces slow Gun reads)
------------------------------------------------------------
create table if not exists token_chat_messages (
  id              uuid primary key default gen_random_uuid(),
  token_address   text not null references tokens(address) on delete cascade,
  sender_address  text not null,
  -- 3 MB upper bound — covers base64 data URLs for images (max 2 MB raw
  -- file × ~1.33 base64 inflation = ~2.7 MB). Plain text still well
  -- under this so messages are never rejected for length.
  body            text not null check (char_length(body) > 0 and char_length(body) <= 3000000),
  created_at      timestamptz default now()
);
create index if not exists token_chat_time_idx
  on token_chat_messages (token_address, created_at desc);

------------------------------------------------------------
-- trades
------------------------------------------------------------
create table if not exists trades (
  tx_hash          text primary key,
  token_address    text not null references tokens(address) on delete cascade,
  account_address  text not null,
  side             text not null check (side in ('BUY','SELL')),
  token_amount     numeric(78,0) not null,
  quote_amount     numeric(78,0) not null,
  native_amount    numeric(78,0),
  price_usd        numeric,
  value_usd        numeric,
  block_number     bigint,
  log_index        integer,
  created_at_chain timestamptz not null,
  created_at       timestamptz default now()
);
create index if not exists trades_token_time_idx on trades (token_address, created_at_chain desc);
create index if not exists trades_account_time_idx on trades (account_address, created_at_chain desc);

------------------------------------------------------------
-- token_holders
------------------------------------------------------------
create table if not exists token_holders (
  token_address   text not null references tokens(address) on delete cascade,
  account_address text not null,
  balance         numeric(78,0) not null default 0,
  updated_at      timestamptz default now(),
  primary key (token_address, account_address)
);
create index if not exists holders_token_balance_idx
  on token_holders (token_address, balance desc);

------------------------------------------------------------
-- token_page_pins — UI marks tokens being viewed; bot syncs these first
------------------------------------------------------------
create table if not exists token_page_pins (
  token_address text primary key references tokens(address) on delete cascade,
  last_seen_at  timestamptz not null default now()
);
create index if not exists token_page_pins_seen_idx
  on token_page_pins (last_seen_at desc);

------------------------------------------------------------
-- follows
------------------------------------------------------------
create table if not exists follows (
  follower_address text not null references accounts(address) on delete cascade,
  followee_address text not null references accounts(address) on delete cascade,
  notify_trades    boolean default false,
  created_at       timestamptz default now(),
  primary key (follower_address, followee_address)
);
create index if not exists follows_followee_idx on follows (followee_address);

------------------------------------------------------------
-- posts
------------------------------------------------------------
create table if not exists posts (
  id             uuid primary key default gen_random_uuid(),
  author_address text not null references accounts(address) on delete cascade,
  -- X-style 200-char limit. Enforced both here and on the client composer.
  body           text not null check (char_length(body) > 0 and char_length(body) <= 200),
  parent_id      uuid references posts(id) on delete cascade,
  quoted_token   text references tokens(address),
  trade_tx_hash  text references trades(tx_hash),
  likes          integer default 0,
  reposts        integer default 0,
  views          integer default 0,
  rank_score     numeric default 0,
  created_at     timestamptz default now()
);
alter table posts add column if not exists rank_score numeric default 0;
create index if not exists posts_author_time_idx on posts (author_address, created_at desc);
create index if not exists posts_parent_idx on posts (parent_id);
create index if not exists posts_time_idx on posts (created_at desc);

------------------------------------------------------------
-- post_likes
------------------------------------------------------------
create table if not exists post_likes (
  post_id         uuid not null references posts(id) on delete cascade,
  account_address text not null references accounts(address) on delete cascade,
  created_at      timestamptz default now(),
  primary key (post_id, account_address)
);

------------------------------------------------------------
-- reposts (social feed)
------------------------------------------------------------
create table if not exists reposts (
  post_id          uuid not null references posts(id) on delete cascade,
  reposter_address text not null references accounts(address) on delete cascade,
  body             text,
  created_at       timestamptz default now(),
  primary key (post_id, reposter_address)
);
create index if not exists reposts_post_idx on reposts (post_id);
create index if not exists reposts_user_time_idx on reposts (reposter_address, created_at desc);

------------------------------------------------------------
-- alerts
------------------------------------------------------------
create table if not exists alerts (
  id             uuid primary key default gen_random_uuid(),
  owner_address  text not null references accounts(address) on delete cascade,
  kind           text not null check (kind in ('price','progress','launch','wallet','volume','holder')),
  token_address  text references tokens(address) on delete cascade,
  wallet_address text,
  comparator     text check (comparator in ('>','<','>=','<=','==','any')),
  threshold      numeric,
  enabled        boolean default true,
  push_inapp     boolean default true,
  push_telegram  boolean default false,
  push_email     boolean default false,
  note           text,
  last_fired_at  timestamptz,
  created_at     timestamptz default now()
);
create index if not exists alerts_owner_idx on alerts (owner_address);
create index if not exists alerts_token_idx on alerts (token_address);

------------------------------------------------------------
-- copy_configs / sniper_configs / limit_orders
------------------------------------------------------------
create table if not exists copy_configs (
  id             uuid primary key default gen_random_uuid(),
  owner_address  text not null references accounts(address) on delete cascade,
  target_address text not null,
  buy_pct        numeric not null default 100,
  max_per_trade  numeric not null,
  mirror_buys    boolean default true,
  mirror_sells   boolean default true,
  status         text not null default 'active' check (status in ('active','paused')),
  copied_count   integer default 0,
  pnl_usd        numeric default 0,
  created_at     timestamptz default now()
);
create index if not exists copy_owner_idx on copy_configs (owner_address);

create table if not exists sniper_configs (
  id           uuid primary key default gen_random_uuid(),
  owner_address text not null references accounts(address) on delete cascade,
  mode         text not null check (mode in ('dev','symbol')),
  target       text not null,
  -- Default OFF: exact symbol match only. When ON, "PEPE" also matches
  -- "PEPECOIN", "OFFICIALPEPE", etc. (substring match).
  match_partial boolean default false,
  amount_mon   numeric not null,
  slippage_pct numeric not null default 5,
  priority     text not null default 'med' check (priority in ('low','med','high')),
  auto_sell_2x boolean default true,
  status       text not null default 'armed' check (status in ('armed','paused')),
  hits         integer default 0,
  pnl_usd      numeric default 0,
  created_at   timestamptz default now()
);
-- Idempotent for re-runs on existing DBs that pre-date match_partial
alter table sniper_configs add column if not exists match_partial boolean default false;
-- Nad.fun anti-snipe: user-configurable ceiling on the launch-block
-- penalty they're willing to eat. Default 2000bps (20%) means we skip the
-- two most expensive blocks (80% at block 0, 40% at block 1) and only
-- snipe from block 2 onward. Set to 8000 to ignore the penalty entirely,
-- or 0 to only buy at block 7+.
alter table sniper_configs add column if not exists max_penalty_bps integer default 2000;
create index if not exists sniper_owner_idx on sniper_configs (owner_address);
-- Hot path: sniper-worker fetches all armed configs on every Create event.
-- Partial index keeps it fast regardless of total config count.
create index if not exists sniper_armed_mode_idx
  on sniper_configs (mode) where status = 'armed';

create table if not exists limit_orders (
  id              uuid primary key default gen_random_uuid(),
  owner_address   text not null references accounts(address) on delete cascade,
  token_address   text not null references tokens(address) on delete cascade,
  side            text not null check (side in ('BUY','SELL')),
  amount_in       numeric(78,0) not null,
  limit_price_usd numeric not null,
  slippage_pct    numeric not null default 1,
  expires_at      timestamptz,
  status          text not null default 'open'
    check (status in ('open','firing','filled','cancelled','expired','failed')),
  tx_hash         text,
  created_at      timestamptz default now(),
  filled_at       timestamptz
);
create index if not exists limit_owner_status_idx on limit_orders (owner_address, status);
create index if not exists limit_token_status_idx on limit_orders (token_address, status);

------------------------------------------------------------
-- pnl_snapshots / position_snapshots
------------------------------------------------------------
create table if not exists pnl_snapshots (
  account_address text not null references accounts(address) on delete cascade,
  -- "time_window" because `window` is a Postgres reserved keyword.
  -- Values: 24H / 7D / 30D / 90D / 180D / 1Y / ALL
  time_window     text not null check (time_window in ('24H','7D','30D','90D','180D','1Y','ALL')),
  realized_usd    numeric default 0,
  unrealized_usd  numeric default 0,
  volume_usd      numeric default 0,
  trades_count    integer default 0,
  win_rate_pct    numeric,
  best_trade_usd  numeric,
  best_token      text references tokens(address),
  worst_trade_usd numeric,
  worst_token     text references tokens(address),
  updated_at      timestamptz default now(),
  primary key (account_address, time_window)
);

create table if not exists position_snapshots (
  account_address text not null references accounts(address) on delete cascade,
  token_address   text not null references tokens(address) on delete cascade,
  balance         numeric(78,0) not null default 0,
  avg_cost_usd    numeric,
  realized_usd    numeric default 0,
  unrealized_usd  numeric default 0,
  updated_at      timestamptz default now(),
  primary key (account_address, token_address)
);

------------------------------------------------------------
-- account_labels
------------------------------------------------------------
create table if not exists account_labels (
  account_address text not null references accounts(address) on delete cascade,
  label           text not null,
  score           numeric default 0,
  reason          text,
  computed_at     timestamptz default now(),
  primary key (account_address, label)
);
create index if not exists account_labels_label_score_idx
  on account_labels (label, score desc);

------------------------------------------------------------
-- bubble_map
------------------------------------------------------------
create table if not exists bubble_map_nodes (
  token_address   text not null references tokens(address) on delete cascade,
  account_address text not null,
  balance         numeric(78,0) not null default 0,
  cluster_id      integer not null default 0,
  is_sniper       boolean default false,
  is_insider      boolean default false,
  is_dev          boolean default false,
  computed_at     timestamptz default now(),
  primary key (token_address, account_address)
);
create index if not exists bubble_nodes_cluster_idx
  on bubble_map_nodes (token_address, cluster_id);

create table if not exists bubble_map_edges (
  token_address text not null references tokens(address) on delete cascade,
  src_address   text not null,
  dst_address   text not null,
  weight        numeric not null default 1,
  computed_at   timestamptz default now(),
  primary key (token_address, src_address, dst_address)
);
create index if not exists bubble_edges_src_idx
  on bubble_map_edges (token_address, src_address);

------------------------------------------------------------
-- notifications / session_keys / execution_queue / siwe
------------------------------------------------------------
create table if not exists notifications (
  id            uuid primary key default gen_random_uuid(),
  owner_address text not null references accounts(address) on delete cascade,
  kind          text not null,
  title         text not null,
  body          text,
  link          text,
  meta          jsonb,
  read          boolean default false,
  created_at    timestamptz default now()
);
create index if not exists notifications_owner_time_idx
  on notifications (owner_address, created_at desc);

create table if not exists session_keys (
  id              uuid primary key default gen_random_uuid(),
  owner_address   text not null references accounts(address) on delete cascade,
  key_address     text not null,
  encrypted_key   text not null,
  allowed_actions text[] not null default '{}',
  spend_cap_usd   numeric,
  expires_at      timestamptz,
  created_at      timestamptz default now(),
  revoked_at      timestamptz
);
create index if not exists session_keys_owner_idx on session_keys (owner_address);
create unique index if not exists session_keys_key_idx on session_keys (key_address);

create table if not exists execution_queue (
  id            uuid primary key default gen_random_uuid(),
  owner_address text not null references accounts(address) on delete cascade,
  source        text not null check (source in ('sniper','copy','limit','manual')),
  source_id     uuid,
  token_address text not null references tokens(address) on delete cascade,
  side          text not null check (side in ('BUY','SELL')),
  amount_in     numeric(78,0) not null,
  slippage_bps  integer not null default 50,
  venue         text not null default 'auto' check (venue in ('auto','nadfun','dirol')),
  status        text not null default 'pending'
    check (status in ('pending','firing','filled','failed','cancelled')),
  tx_hash       text,
  error         text,
  created_at    timestamptz default now(),
  fired_at      timestamptz
);
create index if not exists exec_queue_status_idx on execution_queue (status, created_at);
create index if not exists exec_queue_owner_idx on execution_queue (owner_address, created_at desc);
alter table execution_queue add column if not exists trigger_tx_hash text;
-- Pre-signed raw tx (sniper-worker fills this so executor can sendRaw and
-- skip the Para import + sign in the hot path).
alter table execution_queue add column if not exists pre_signed_tx text;
-- Nad.fun anti-snipe: block at which the token was created. The executor
-- re-derives the current penalty (currentBlock - creation_block) at fire
-- time and refuses to broadcast if it now exceeds the user's ceiling.
alter table execution_queue add column if not exists creation_block numeric(78,0);
-- Hot tick partition: fast path queries source IN ('sniper','copy').
create index if not exists exec_queue_fast_idx
  on execution_queue (status, created_at) where source in ('sniper','copy');
create unique index if not exists exec_queue_trigger_unique
  on execution_queue (source, source_id, trigger_tx_hash)
  where trigger_tx_hash is not null;

create table if not exists siwe_nonces (
  nonce       text primary key,
  address     text not null,
  issued_at   timestamptz default now(),
  consumed_at timestamptz
);

------------------------------------------------------------
-- referrals
------------------------------------------------------------
create table if not exists referral_codes (
  code          text primary key,
  owner_address text not null references accounts(address) on delete cascade,
  created_at    timestamptz default now()
);
create index if not exists ref_codes_owner_idx on referral_codes (owner_address);
-- One code per wallet — the auto-mint trigger relies on this uniqueness.
create unique index if not exists ref_codes_owner_unique on referral_codes (owner_address);

-- ───── Auto-mint trench### codes for every new account ─────────────────
-- Every accounts row gets a referral code minted the moment it's inserted.
-- Format: `trench` + zero-padded sequence number (e.g. trench001, trench042,
-- trench1234). Sequence is shared globally so codes are unique and
-- monotonically increasing, never reused.
create sequence if not exists referral_code_seq start with 1;

create or replace function assign_referral_code()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  n bigint;
begin
  -- Skip if this wallet already has one (idempotent for re-runs).
  if exists (select 1 from referral_codes where owner_address = new.address) then
    return new;
  end if;
  n := nextval('referral_code_seq');
  insert into referral_codes (code, owner_address)
  values ('trench' || lpad(n::text, 3, '0'), new.address)
  on conflict (owner_address) do nothing;
  return new;
end;
$$;

drop trigger if exists accounts_assign_ref_code on accounts;
create trigger accounts_assign_ref_code
  after insert on accounts
  for each row execute function assign_referral_code();

-- Backfill: mint codes for any accounts created before this migration.
insert into referral_codes (code, owner_address)
select 'trench' || lpad(nextval('referral_code_seq')::text, 3, '0'), a.address
  from accounts a
  left join referral_codes rc on rc.owner_address = a.address
  where rc.code is null
order by a.created_at;

create table if not exists referrals (
  referee_address  text primary key references accounts(address) on delete cascade,
  referrer_address text not null references accounts(address) on delete cascade,
  code             text not null references referral_codes(code) on update cascade on delete cascade,
  bonded_at        timestamptz default now()
);
create index if not exists referrals_referrer_idx on referrals (referrer_address);

create table if not exists referral_earnings (
  id               uuid primary key default gen_random_uuid(),
  referrer_address text not null references accounts(address) on delete cascade,
  referee_address  text not null references accounts(address) on delete cascade,
  source_tx_hash   text,
  amount_usd       numeric not null,
  created_at       timestamptz default now()
);
create index if not exists ref_earn_referrer_idx on referral_earnings (referrer_address, created_at desc);

------------------------------------------------------------
-- user blocklist (private per wallet)
------------------------------------------------------------
create table if not exists user_blocklist_wallets (
  owner_address  text not null references accounts(address) on delete cascade,
  wallet_address text not null,
  note           text,
  created_at     timestamptz not null default now(),
  primary key (owner_address, wallet_address),
  constraint user_blocklist_wallets_addr_chk check (wallet_address ~ '^0x[a-f0-9]{40}$')
);

create table if not exists user_blocklist_tokens (
  owner_address text not null references accounts(address) on delete cascade,
  token_address text not null,
  note          text,
  created_at    timestamptz not null default now(),
  primary key (owner_address, token_address),
  constraint user_blocklist_tokens_addr_chk check (token_address ~ '^0x[a-f0-9]{40}$')
);

create index if not exists user_blocklist_wallets_owner_idx
  on user_blocklist_wallets (owner_address, created_at desc);
create index if not exists user_blocklist_tokens_owner_idx
  on user_blocklist_tokens (owner_address, created_at desc);

------------------------------------------------------------
-- para_wallets — maps each account.address to the Para user/session data
-- used by server-side swap execution.
------------------------------------------------------------
create table if not exists para_wallets (
  owner_address  text primary key references accounts(address) on delete cascade,
  para_user_id   text,
  wallet_id      text not null,
  session        text,
  session_cookie text,
  expires_at     timestamptz,
  chain_type     text not null default 'ethereum',
  created_at     timestamptz default now(),
  updated_at     timestamptz default now()
);
create index if not exists para_wallets_user_idx on para_wallets (para_user_id);
drop trigger if exists para_wallets_updated on para_wallets;
create trigger para_wallets_updated before update on para_wallets
  for each row execute function set_updated_at();

-- Drop every legacy Privy artifact. Safe no-op on a fresh database.
drop table if exists privy_wallets cascade;
drop table if exists privy_sessions cascade;
drop table if exists privy_users cascade;
drop table if exists privy_roles cascade;
drop table if exists para_sessions cascade;

do $$
declare
  role_name text;
begin
  foreach role_name in array array['privy_authenticated', 'privy_user', 'privy_service']
  loop
    if exists (select 1 from pg_roles where rolname = role_name) then
      execute format('drop owned by %I', role_name);
      execute format('revoke all privileges on database %I from %I', current_database(), role_name);
      execute format('drop role %I', role_name);
    end if;
  end loop;
end $$;

------------------------------------------------------------
-- rewards / points
------------------------------------------------------------
create table if not exists points_ledger (
  id             uuid primary key default gen_random_uuid(),
  owner_address  text not null references accounts(address) on delete cascade,
  points         bigint not null,
  reason         text not null check (reason in (
    'cashback', 'referral', 'redemption', 'bonus', 'adjustment'
  )),
  source_user    text,
  source_tx_hash text,
  amount_usd     numeric,
  meta           jsonb,
  created_at     timestamptz default now()
);
create index if not exists points_ledger_owner_time
  on points_ledger (owner_address, created_at desc);
-- One unique index serves both dedup + lookup; covered by source_tx_hash prefix.
create unique index if not exists points_ledger_once
  on points_ledger (source_tx_hash, owner_address, reason)
  where source_tx_hash is not null;
drop index if exists points_ledger_dedup;

create table if not exists redemptions (
  id            uuid primary key default gen_random_uuid(),
  owner_address text not null references accounts(address) on delete cascade,
  points_spent  bigint not null check (points_spent > 0),
  mon_amount    numeric(78,0) not null,
  mon_price_usd numeric not null,
  status        text not null default 'pending'
    check (status in ('pending', 'firing', 'paid', 'failed', 'cancelled')),
  tx_hash       text,
  error_msg     text,
  created_at    timestamptz default now(),
  paid_at       timestamptz
);
create index if not exists redemptions_owner_idx on redemptions (owner_address, created_at desc);
create index if not exists redemptions_status_idx on redemptions (status, created_at);

------------------------------------------------------------
-- Cabal E2EE infrastructure
--
-- Cabal metadata + membership + rooms + watchlist all live on Gun.js (so
-- there's no cabals/cabal_members/cabal_rooms/cabal_watchlist table here).
-- Supabase only stores the cryptographic identity needed for end-to-end
-- encryption of cabal chat bodies:
--
--   1. user_encryption_keys — each user's ECDH P-256 PUBLIC key. Admins
--      need it to wrap fresh cabal keys for new members. Private key never
--      leaves the device (localStorage).
--
--   2. cabal_key_grants — the cabal's symmetric AES-256 key, encrypted
--      ("wrapped") to a specific member's pubkey via ECDH→AES-GCM. Only the
--      holder of that private key can unwrap and decrypt the cabal's chat.
--      Wrapping is rotated when membership changes.
--
-- Trade events pushed by the indexer (via gun-write.ts) are intentionally
-- plaintext — they're public onchain anyway and the indexer is not a member.
------------------------------------------------------------
create table if not exists user_encryption_keys (
  account     text primary key references accounts(address) on delete cascade,
  pubkey      text not null,                  -- JSON-encoded JWK
  algorithm   text not null default 'ecdh-p256',
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);
create trigger user_enc_keys_updated before update on user_encryption_keys
  for each row execute function set_updated_at();

create table if not exists cabal_key_grants (
  cabal_id    uuid not null,                  -- Gun-side cabal id (not FK)
  account     text not null references accounts(address) on delete cascade,
  role        text not null default 'member' check (role in ('owner','admin','member')),
  wrapped_key text not null,                  -- JSON { ephem, iv, ct }
  pubkey      text not null,                  -- snapshot of grantee's pubkey at wrap time
  granted_by  text not null references accounts(address),
  created_at  timestamptz default now(),
  primary key (cabal_id, account)
);
create index if not exists cabal_key_grants_account_idx on cabal_key_grants (account);
create index if not exists cabal_key_grants_cabal_idx on cabal_key_grants (cabal_id);

------------------------------------------------------------
-- Triggers: posts counters, points balance
------------------------------------------------------------
create or replace function bump_post_reposts() returns trigger language plpgsql as $$
begin
  if (TG_OP = 'INSERT') then
    update posts set reposts = reposts + 1 where id = NEW.post_id;
  elsif (TG_OP = 'DELETE') then
    update posts set reposts = greatest(reposts - 1, 0) where id = OLD.post_id;
  end if;
  return null;
end $$;

drop trigger if exists trg_reposts_count on reposts;
create trigger trg_reposts_count
  after insert or delete on reposts
  for each row execute function bump_post_reposts();

create or replace function bump_post_likes() returns trigger language plpgsql as $$
begin
  if (TG_OP = 'INSERT') then
    update posts set likes = likes + 1 where id = NEW.post_id;
  elsif (TG_OP = 'DELETE') then
    update posts set likes = greatest(likes - 1, 0) where id = OLD.post_id;
  end if;
  return null;
end $$;

drop trigger if exists trg_likes_count on post_likes;
create trigger trg_likes_count
  after insert or delete on post_likes
  for each row execute function bump_post_likes();

create or replace function bump_points_balance() returns trigger language plpgsql as $$
begin
  if (TG_OP = 'INSERT') then
    update accounts set points_balance = points_balance + NEW.points
      where address = NEW.owner_address;
  elsif (TG_OP = 'DELETE') then
    update accounts set points_balance = points_balance - OLD.points
      where address = OLD.owner_address;
  end if;
  return null;
end $$;

drop trigger if exists trg_points_balance on points_ledger;
create trigger trg_points_balance
  after insert or delete on points_ledger
  for each row execute function bump_points_balance();

------------------------------------------------------------
-- Feed ranking (materialized view)
-- final = recency×1 + velocity×0.5 + author_signal×0.1 (+ token_boost at query time)
------------------------------------------------------------
drop materialized view if exists post_scores;
create materialized view post_scores as
with stats as (
  select
    p.id,
    p.created_at,
    p.author_address,
    p.quoted_token,
    (select count(*) from posts r where r.parent_id = p.id) as comment_count,
    p.reposts,
    p.likes,
    extract(epoch from now() - p.created_at) / 3600.0 as hours_old
  from posts p
  where p.parent_id is null
    and p.created_at > now() - interval '7 days'
)
select
  s.id,
  s.created_at,
  s.author_address,
  s.quoted_token,
  s.comment_count,
  s.reposts,
  s.likes,
  s.hours_old,
  exp(-s.hours_old / 12.0) as recency,
  (s.comment_count * 5 + s.reposts * 3 + s.likes * 1)::numeric /
    greatest(s.hours_old, 0.5) as velocity,
  coalesce(
    (select max(l.score) from account_labels l where l.account_address = s.author_address),
    0
  ) as author_signal,
  (
    exp(-s.hours_old / 12.0) * 1.0
    + (((s.comment_count * 5 + s.reposts * 3 + s.likes * 1)::numeric /
        greatest(s.hours_old, 0.5)) * 0.5)
    + (coalesce(
        (select max(l.score) from account_labels l where l.account_address = s.author_address),
        0
      ) * 0.1)
  ) as score
from stats s;

create unique index if not exists post_scores_pk    on post_scores (id);
create index        if not exists post_scores_score on post_scores (score desc);
create index        if not exists post_scores_token on post_scores (quoted_token, score desc);

create or replace function refresh_post_scores() returns void language plpgsql as $$
begin
  refresh materialized view concurrently post_scores;
exception when feature_not_supported then
  refresh materialized view post_scores;
end $$;

------------------------------------------------------------
-- Rewards: record_trade_fee RPC (service role only)
------------------------------------------------------------
create or replace function tier_multiplier(p_points_earned bigint)
returns numeric language sql immutable as $$
  select case
    when p_points_earned >= 100000 then 2.0
    when p_points_earned >= 25000  then 1.7
    when p_points_earned >= 5000   then 1.4
    else 1.0
  end
$$;

create or replace function points_earned_total(p_owner text)
returns bigint language sql stable as $$
  select coalesce(sum(points), 0)::bigint
  from points_ledger
  where owner_address = lower(p_owner) and points > 0 and reason in ('cashback','referral','bonus')
$$;

create or replace function record_trade_fee(
  p_trader    text,
  p_fee_usd   numeric,
  p_source_tx text default null,
  p_source    text default 'trade'
) returns void language plpgsql as $$
declare
  cashback_pts  bigint;
  referrer_pts  bigint;
  referrer      text;
  trader_mult   numeric;
  referrer_mult numeric;
begin
  if p_fee_usd is null or p_fee_usd <= 0 then return; end if;

  trader_mult := tier_multiplier(points_earned_total(p_trader));
  cashback_pts := floor(p_fee_usd * 0.05 * trader_mult / 0.10);
  if cashback_pts > 0 then
    insert into points_ledger (owner_address, points, reason, source_user, source_tx_hash, amount_usd, meta)
    values (lower(p_trader), cashback_pts, 'cashback', lower(p_trader), p_source_tx, p_fee_usd,
            jsonb_build_object('source', p_source, 'tier_mult', trader_mult))
    on conflict do nothing;
  end if;

  select referrer_address into referrer
    from referrals where referee_address = lower(p_trader) limit 1;
  if referrer is not null then
    referrer_mult := tier_multiplier(points_earned_total(referrer));
    referrer_pts := floor(p_fee_usd * 0.10 * referrer_mult / 0.10);
    if referrer_pts > 0 then
      insert into points_ledger (owner_address, points, reason, source_user, source_tx_hash, amount_usd, meta)
      values (referrer, referrer_pts, 'referral', lower(p_trader), p_source_tx, p_fee_usd,
              jsonb_build_object('source', p_source, 'tier_mult', referrer_mult))
      on conflict do nothing;
    end if;
  end if;
end $$;

------------------------------------------------------------
-- Bot worker RPCs (fresh DB)
------------------------------------------------------------
create or replace function compute_pnl_snapshots(p_window text)
returns void language plpgsql security definer as $$
declare
  v_window text := upper(coalesce(p_window, '30D'));
  v_since timestamptz;
begin
  v_since := case v_window
    when '24H' then now() - interval '24 hours'
    when '7D' then now() - interval '7 days'
    when '30D' then now() - interval '30 days'
    when '90D' then now() - interval '90 days'
    when '180D' then now() - interval '180 days'
    when '1Y' then now() - interval '1 year'
    else null
  end;

  with scoped as (
    select *
    from trades
    where v_since is null or created_at_chain >= v_since
  ),
  token_pnl as (
    select
      account_address,
      token_address,
      coalesce(sum(case when side = 'SELL' then value_usd else -value_usd end), 0) as pnl_usd,
      coalesce(sum(case when side = 'SELL' then value_usd else 0 end), 0) as proceeds_usd
    from scoped
    group by account_address, token_address
  ),
  accounts_pnl as (
    select
      account_address,
      coalesce(sum(case when side = 'SELL' then value_usd else -value_usd end), 0) as realized_usd,
      coalesce(sum(value_usd), 0) as volume_usd,
      count(*)::integer as trades_count
    from scoped
    group by account_address
  ),
  wins as (
    select
      account_address,
      case
        when count(*) filter (where proceeds_usd > 0) = 0 then null
        else round(
          100.0 * count(*) filter (where proceeds_usd > 0 and pnl_usd > 0)
          / count(*) filter (where proceeds_usd > 0),
          2
        )
      end as win_rate_pct
    from token_pnl
    group by account_address
  ),
  best as (
    select distinct on (account_address)
      account_address,
      token_address as best_token,
      pnl_usd as best_trade_usd
    from token_pnl
    order by account_address, pnl_usd desc
  ),
  worst as (
    select distinct on (account_address)
      account_address,
      token_address as worst_token,
      pnl_usd as worst_trade_usd
    from token_pnl
    order by account_address, pnl_usd asc
  )
  insert into pnl_snapshots (
    account_address, time_window, realized_usd, unrealized_usd, volume_usd,
    trades_count, win_rate_pct, best_trade_usd, best_token,
    worst_trade_usd, worst_token, updated_at
  )
  select
    a.account_address,
    v_window,
    a.realized_usd,
    0,
    a.volume_usd,
    a.trades_count,
    w.win_rate_pct,
    b.best_trade_usd,
    b.best_token,
    x.worst_trade_usd,
    x.worst_token,
    now()
  from accounts_pnl a
  left join wins w using (account_address)
  left join best b using (account_address)
  left join worst x using (account_address)
  on conflict (account_address, time_window) do update set
    realized_usd = excluded.realized_usd,
    unrealized_usd = excluded.unrealized_usd,
    volume_usd = excluded.volume_usd,
    trades_count = excluded.trades_count,
    win_rate_pct = excluded.win_rate_pct,
    best_trade_usd = excluded.best_trade_usd,
    best_token = excluded.best_token,
    worst_trade_usd = excluded.worst_trade_usd,
    worst_token = excluded.worst_token,
    updated_at = now();
end $$;

create or replace function recompute_feed_rank()
returns void language plpgsql security definer as $$
begin
  with comments as (
    select parent_id, count(*)::integer as comment_count
    from posts
    where parent_id is not null
    group by parent_id
  ),
  labels as (
    select account_address, max(score) as author_signal
    from account_labels
    group by account_address
  ),
  scored as (
    select
      p.id,
      exp(-(extract(epoch from (now() - p.created_at)) / 3600.0) / 12.0)
      + (((coalesce(p.likes, 0) + coalesce(p.reposts, 0) * 3 + coalesce(c.comment_count, 0) * 5)::numeric)
         / greatest(extract(epoch from (now() - p.created_at)) / 3600.0, 0.5))
      + coalesce(l.author_signal, 0) * 0.1 as score
    from posts p
    left join comments c on c.parent_id = p.id
    left join labels l on l.account_address = p.author_address
  )
  update posts p
  set rank_score = scored.score
  from scored
  where scored.id = p.id;

  perform refresh_post_scores();
end $$;

create or replace function recompute_bubble_map()
returns void language plpgsql security definer as $$
begin
  delete from bubble_map_nodes;

  insert into bubble_map_nodes (
    token_address, account_address, balance, cluster_id,
    is_sniper, is_insider, is_dev, computed_at
  )
  select
    h.token_address,
    h.account_address,
    h.balance,
    (dense_rank() over (partition by h.token_address order by h.balance desc) - 1) / 20,
    exists (
      select 1 from trades tr
      where tr.token_address = h.token_address
        and tr.account_address = h.account_address
        and tr.created_at_chain <= coalesce(t.created_at_chain, now()) + interval '5 minutes'
    ),
    exists (
      select 1 from account_labels l
      where l.account_address = h.account_address
        and l.label in ('insider', 'insider_watch', 'smart_money')
    ),
    exists (
      select 1 from account_labels l
      where l.account_address = h.account_address
        and l.label = 'dev'
    ),
    now()
  from token_holders h
  left join tokens t on t.address = h.token_address
  where h.balance > 0
  on conflict (token_address, account_address) do update set
    balance = excluded.balance,
    cluster_id = excluded.cluster_id,
    is_sniper = excluded.is_sniper,
    is_insider = excluded.is_insider,
    is_dev = excluded.is_dev,
    computed_at = now();
end $$;

grant execute on function compute_pnl_snapshots(text) to service_role;
grant execute on function recompute_feed_rank() to service_role;
grant execute on function recompute_bubble_map() to service_role;

------------------------------------------------------------
-- Row Level Security
------------------------------------------------------------
alter table accounts               enable row level security;
alter table tokens                 enable row level security;
alter table token_markets          enable row level security;
alter table trades                 enable row level security;
alter table token_holders          enable row level security;
alter table follows                enable row level security;
alter table posts                  enable row level security;
alter table post_likes             enable row level security;
alter table reposts                enable row level security;
alter table alerts                 enable row level security;
alter table copy_configs           enable row level security;
alter table sniper_configs         enable row level security;
alter table limit_orders           enable row level security;
alter table notifications          enable row level security;
alter table session_keys           enable row level security;
alter table execution_queue        enable row level security;
alter table account_labels         enable row level security;
alter table bubble_map_nodes       enable row level security;
alter table bubble_map_edges       enable row level security;
alter table pnl_snapshots          enable row level security;
alter table position_snapshots     enable row level security;
alter table referral_codes         enable row level security;
alter table referrals              enable row level security;
alter table referral_earnings      enable row level security;
alter table user_blocklist_wallets enable row level security;
alter table user_blocklist_tokens  enable row level security;
alter table para_wallets           enable row level security;
alter table points_ledger          enable row level security;
alter table redemptions            enable row level security;
alter table siwe_nonces            enable row level security;
alter table user_encryption_keys   enable row level security;
alter table cabal_key_grants       enable row level security;
-- siwe_nonces: no policies → anon locked out, service role bypasses

-- accounts
drop policy if exists "public read accounts" on accounts;
create policy "public read accounts" on accounts for select using (true);
drop policy if exists "self insert account" on accounts;
create policy "self insert account" on accounts for insert with check (address = auth_addr());
drop policy if exists "self update account" on accounts;
create policy "self update account" on accounts for update using (address = auth_addr());

-- follows
drop policy if exists "public read follows" on follows;
create policy "public read follows" on follows for select using (true);
drop policy if exists "self follow" on follows;
create policy "self follow" on follows for insert with check (follower_address = auth_addr());
drop policy if exists "self unfollow" on follows;
create policy "self unfollow" on follows for delete using (follower_address = auth_addr());

-- posts + likes + reposts
drop policy if exists "public read posts" on posts;
create policy "public read posts" on posts for select using (true);
drop policy if exists "self post" on posts;
create policy "self post" on posts for insert with check (author_address = auth_addr());
drop policy if exists "self edit post" on posts;
create policy "self edit post" on posts for update using (author_address = auth_addr());
drop policy if exists "self delete post" on posts;
create policy "self delete post" on posts for delete using (author_address = auth_addr());

drop policy if exists "public read likes" on post_likes;
create policy "public read likes" on post_likes for select using (true);
drop policy if exists "self like" on post_likes;
create policy "self like" on post_likes for insert with check (account_address = auth_addr());
drop policy if exists "self unlike" on post_likes;
create policy "self unlike" on post_likes for delete using (account_address = auth_addr());

drop policy if exists "public read reposts" on reposts;
create policy "public read reposts" on reposts for select using (true);
drop policy if exists "self repost" on reposts;
create policy "self repost" on reposts for insert with check (reposter_address = auth_addr());
drop policy if exists "self unrepost" on reposts;
create policy "self unrepost" on reposts for delete using (reposter_address = auth_addr());

-- alerts
drop policy if exists "read my alerts" on alerts;
create policy "read my alerts" on alerts for select using (owner_address = auth_addr());
drop policy if exists "create my alert" on alerts;
create policy "create my alert" on alerts for insert with check (owner_address = auth_addr());
drop policy if exists "update my alert" on alerts;
create policy "update my alert" on alerts for update using (owner_address = auth_addr());
drop policy if exists "delete my alert" on alerts;
create policy "delete my alert" on alerts for delete using (owner_address = auth_addr());

-- sniper / copy / limit
drop policy if exists "owner rw sniper" on sniper_configs;
create policy "owner rw sniper" on sniper_configs for all
  using (owner_address = auth_addr()) with check (owner_address = auth_addr());
drop policy if exists "owner rw copy" on copy_configs;
create policy "owner rw copy" on copy_configs for all
  using (owner_address = auth_addr()) with check (owner_address = auth_addr());
drop policy if exists "owner rw limit" on limit_orders;
create policy "owner rw limit" on limit_orders for all
  using (owner_address = auth_addr()) with check (owner_address = auth_addr());

-- session keys + execution queue
drop policy if exists "owner read session" on session_keys;
create policy "owner read session" on session_keys for select using (owner_address = auth_addr());
drop policy if exists "owner create session" on session_keys;
create policy "owner create session" on session_keys for insert with check (owner_address = auth_addr());
drop policy if exists "owner revoke session" on session_keys;
create policy "owner revoke session" on session_keys for update using (owner_address = auth_addr());

drop policy if exists "owner read queue" on execution_queue;
create policy "owner read queue" on execution_queue for select using (owner_address = auth_addr());

-- notifications
drop policy if exists "owner read notif" on notifications;
create policy "owner read notif" on notifications for select using (owner_address = auth_addr());
drop policy if exists "owner mark notif" on notifications;
create policy "owner mark notif" on notifications for update using (owner_address = auth_addr());

-- public read (workers write via service role)
drop policy if exists "public read tokens" on tokens;
create policy "public read tokens" on tokens for select using (true);
drop policy if exists "creator update token banner" on tokens;
create policy "creator update token banner" on tokens
  for update using (creator_address = auth_addr())
  with check (creator_address = auth_addr());
drop policy if exists "public read markets" on token_markets;
create policy "public read markets" on token_markets for select using (true);
drop policy if exists "public read trades" on trades;
create policy "public read trades" on trades for select using (true);
drop policy if exists "public read holders" on token_holders;
create policy "public read holders" on token_holders for select using (true);
drop policy if exists "public read token pins" on token_page_pins;
create policy "public read token pins" on token_page_pins for select using (true);
alter table token_page_pins enable row level security;
drop policy if exists "public read ohlc" on token_ohlc;
create policy "public read ohlc" on token_ohlc for select using (true);
alter table token_ohlc enable row level security;
drop policy if exists "public read token chat" on token_chat_messages;
create policy "public read token chat" on token_chat_messages for select using (true);
drop policy if exists "auth post token chat" on token_chat_messages;
create policy "auth post token chat" on token_chat_messages
  for insert with check (sender_address = auth_addr());
alter table token_chat_messages enable row level security;
drop policy if exists "public read account_labels" on account_labels;
create policy "public read account_labels" on account_labels for select using (true);
drop policy if exists "public read bubble_nodes" on bubble_map_nodes;
create policy "public read bubble_nodes" on bubble_map_nodes for select using (true);
drop policy if exists "public read bubble_edges" on bubble_map_edges;
create policy "public read bubble_edges" on bubble_map_edges for select using (true);
drop policy if exists "public read pnl" on pnl_snapshots;
create policy "public read pnl" on pnl_snapshots for select using (true);
drop policy if exists "public read positions" on position_snapshots;
create policy "public read positions" on position_snapshots for select using (true);

-- referrals
drop policy if exists "owner read ref codes" on referral_codes;
create policy "owner read ref codes" on referral_codes for select using (owner_address = auth_addr());
drop policy if exists "owner create code" on referral_codes;
create policy "owner create code" on referral_codes for insert with check (owner_address = auth_addr());
drop policy if exists "public read ref codes" on referral_codes;
create policy "public read ref codes" on referral_codes for select using (true);
drop policy if exists "referee bond" on referrals;
create policy "referee bond" on referrals for insert with check (referee_address = auth_addr());
drop policy if exists "self read ref" on referrals;
create policy "self read ref" on referrals for select using (
  referee_address = auth_addr() or referrer_address = auth_addr()
);
drop policy if exists "referrer read earnings" on referral_earnings;
create policy "referrer read earnings" on referral_earnings for select using (referrer_address = auth_addr());

-- blocklist
drop policy if exists "owner read blocklist wallets" on user_blocklist_wallets;
create policy "owner read blocklist wallets" on user_blocklist_wallets
  for select using (owner_address = auth_addr());
drop policy if exists "owner insert blocklist wallets" on user_blocklist_wallets;
create policy "owner insert blocklist wallets" on user_blocklist_wallets
  for insert with check (owner_address = auth_addr());
drop policy if exists "owner delete blocklist wallets" on user_blocklist_wallets;
create policy "owner delete blocklist wallets" on user_blocklist_wallets
  for delete using (owner_address = auth_addr());
drop policy if exists "owner read blocklist tokens" on user_blocklist_tokens;
create policy "owner read blocklist tokens" on user_blocklist_tokens
  for select using (owner_address = auth_addr());
drop policy if exists "owner insert blocklist tokens" on user_blocklist_tokens;
create policy "owner insert blocklist tokens" on user_blocklist_tokens
  for insert with check (owner_address = auth_addr());
drop policy if exists "owner delete blocklist tokens" on user_blocklist_tokens;
create policy "owner delete blocklist tokens" on user_blocklist_tokens
  for delete using (owner_address = auth_addr());

-- para wallets
drop policy if exists "owner read para wallet" on para_wallets;
create policy "owner read para wallet" on para_wallets for select
  using (owner_address = auth_addr());
drop policy if exists "owner upsert para wallet" on para_wallets;
create policy "owner upsert para wallet" on para_wallets for insert
  with check (owner_address = auth_addr());
drop policy if exists "owner update para wallet" on para_wallets;
create policy "owner update para wallet" on para_wallets for update
  using (owner_address = auth_addr());
drop policy if exists "owner delete para wallet" on para_wallets;
create policy "owner delete para wallet" on para_wallets for delete
  using (owner_address = auth_addr());

-- rewards
drop policy if exists "owner read ledger" on points_ledger;
create policy "owner read ledger" on points_ledger for select using (owner_address = auth_addr());
drop policy if exists "owner read redemptions" on redemptions;
create policy "owner read redemptions" on redemptions for select using (owner_address = auth_addr());
drop policy if exists "owner request redemption" on redemptions;
create policy "owner request redemption" on redemptions
  for insert with check (owner_address = auth_addr() and status = 'pending');

-- user_encryption_keys — pubkeys are PUBLIC (admins must read them to wrap
-- cabal keys for new members). Only the owner can publish/rotate their own.
drop policy if exists "public read enc keys" on user_encryption_keys;
create policy "public read enc keys" on user_encryption_keys for select using (true);
drop policy if exists "self publish enc key" on user_encryption_keys;
create policy "self publish enc key" on user_encryption_keys for insert with check (account = auth_addr());
drop policy if exists "self rotate enc key" on user_encryption_keys;
create policy "self rotate enc key" on user_encryption_keys for update using (account = auth_addr());

-- cabal_key_grants — a member can read ONLY their own grant (the wrapped
-- key meant for them). They cannot enumerate other members' wrapped keys
-- (though those are useless without the matching private key anyway).
-- Inserts: existing members of a cabal can grant access to new members
-- (this is the invite flow). Self-insert is allowed only when no grants
-- exist yet for that cabal (the bootstrap / first-owner case).
drop policy if exists "read my grant" on cabal_key_grants;
create policy "read my grant" on cabal_key_grants for select
  using (account = auth_addr());

drop policy if exists "bootstrap or invite grant" on cabal_key_grants;
create policy "bootstrap or invite grant" on cabal_key_grants for insert
  with check (
    granted_by = auth_addr()
    and (
      -- bootstrap: no grants for this cabal yet AND I am granting to myself as owner
      (not exists (select 1 from cabal_key_grants g where g.cabal_id = cabal_key_grants.cabal_id)
        and account = auth_addr()
        and role = 'owner')
      -- invite: I am an existing owner/admin of this cabal
      or exists (
        select 1 from cabal_key_grants g
        where g.cabal_id = cabal_key_grants.cabal_id
          and g.account = auth_addr()
          and g.role in ('owner','admin')
      )
    )
  );

drop policy if exists "admin rotate grant" on cabal_key_grants;
create policy "admin rotate grant" on cabal_key_grants for update
  using (
    exists (
      select 1 from cabal_key_grants g
      where g.cabal_id = cabal_key_grants.cabal_id
        and g.account = auth_addr()
        and g.role in ('owner','admin')
    )
  );

drop policy if exists "self leave or admin kick" on cabal_key_grants;
create policy "self leave or admin kick" on cabal_key_grants for delete
  using (
    account = auth_addr()
    or exists (
      select 1 from cabal_key_grants g
      where g.cabal_id = cabal_key_grants.cabal_id
        and g.account = auth_addr()
        and g.role in ('owner','admin')
    )
  );

------------------------------------------------------------
-- Reports (user-submitted moderation flags)
------------------------------------------------------------
create table if not exists reports (
  id              uuid primary key default gen_random_uuid(),
  reporter        text not null references accounts(address) on delete cascade,
  target_kind     text not null check (target_kind in ('post','account','cabal','token','dm')),
  target_id       text not null,
  reason          text not null check (reason in (
    'spam','scam','harassment','impersonation','nsfw','illegal','other'
  )),
  note            text check (char_length(coalesce(note,'')) <= 500),
  status          text not null default 'open' check (status in ('open','reviewing','resolved','dismissed')),
  resolved_by     text references accounts(address),
  resolved_at     timestamptz,
  created_at      timestamptz default now()
);
create index if not exists reports_status_idx on reports (status, created_at desc);
create index if not exists reports_target_idx on reports (target_kind, target_id);
create unique index if not exists reports_one_per_user
  on reports (reporter, target_kind, target_id) where status = 'open';

------------------------------------------------------------
-- Cabal moderation log (audit trail of kicks + key rotations)
------------------------------------------------------------
create table if not exists cabal_mod_log (
  id          uuid primary key default gen_random_uuid(),
  cabal_id    uuid not null,
  actor       text not null references accounts(address) on delete cascade,
  action      text not null check (action in ('kick','rotate_key','invite','grant','revoke')),
  target      text,
  note        text,
  created_at  timestamptz default now()
);
create index if not exists cabal_mod_log_cabal_idx on cabal_mod_log (cabal_id, created_at desc);

------------------------------------------------------------
-- User key backup (recovery of cabal-chat identity across devices)
------------------------------------------------------------
create table if not exists user_key_backup (
  account     text primary key references accounts(address) on delete cascade,
  ciphertext  text not null,
  challenge   text not null,
  updated_at  timestamptz default now()
);
create trigger user_key_backup_updated before update on user_key_backup
  for each row execute function set_updated_at();

------------------------------------------------------------
-- Pending cabal invites (queue for invitees who haven't published a pubkey yet)
------------------------------------------------------------
create table if not exists pending_cabal_invites (
  cabal_id    uuid not null,
  invitee     text not null,
  granted_by  text not null references accounts(address) on delete cascade,
  created_at  timestamptz default now(),
  primary key (cabal_id, invitee)
);
create index if not exists pending_cabal_invites_invitee_idx on pending_cabal_invites (invitee);

------------------------------------------------------------
-- Rate limits — tunable via config table, enforced via per-table triggers.
-- Service role (workers) bypasses via rl_skip_for_service().
------------------------------------------------------------
create table if not exists rate_limits (
  bucket    text primary key,
  per_min   integer not null,
  per_hour  integer not null
);
insert into rate_limits (bucket, per_min, per_hour) values
  ('posts',       5,   60),
  ('post_likes',  60,  600),
  ('reposts',     10,  120),
  ('follows',     30,  300),
  ('reports',     5,   30),
  ('alerts',      10,  60)
on conflict (bucket) do nothing;

-- Lock the config table. Only the SECURITY DEFINER `enforce_rate_limit`
-- function and the service role can see/modify it — never end users.
alter table rate_limits enable row level security;

create or replace function rl_skip_for_service() returns boolean language sql stable as $$
  select coalesce(current_setting('request.jwt.claim.role', true), '') = 'service_role'
$$;

create or replace function enforce_rate_limit(p_bucket text, p_owner text)
returns void language plpgsql security definer as $$
declare
  cfg      rate_limits%rowtype;
  c_min    integer := 0;
  c_hour   integer := 0;
begin
  select * into cfg from rate_limits where bucket = p_bucket;
  if not found then return; end if;
  if p_bucket = 'posts' then
    select count(*) into c_min  from posts where author_address = p_owner and created_at > now() - interval '1 minute';
    select count(*) into c_hour from posts where author_address = p_owner and created_at > now() - interval '1 hour';
  elsif p_bucket = 'post_likes' then
    select count(*) into c_min  from post_likes where account_address = p_owner and created_at > now() - interval '1 minute';
    select count(*) into c_hour from post_likes where account_address = p_owner and created_at > now() - interval '1 hour';
  elsif p_bucket = 'reposts' then
    select count(*) into c_min  from reposts where reposter_address = p_owner and created_at > now() - interval '1 minute';
    select count(*) into c_hour from reposts where reposter_address = p_owner and created_at > now() - interval '1 hour';
  elsif p_bucket = 'follows' then
    select count(*) into c_min  from follows where follower_address = p_owner and created_at > now() - interval '1 minute';
    select count(*) into c_hour from follows where follower_address = p_owner and created_at > now() - interval '1 hour';
  elsif p_bucket = 'reports' then
    select count(*) into c_min  from reports where reporter = p_owner and created_at > now() - interval '1 minute';
    select count(*) into c_hour from reports where reporter = p_owner and created_at > now() - interval '1 hour';
  elsif p_bucket = 'alerts' then
    select count(*) into c_min  from alerts where owner_address = p_owner and created_at > now() - interval '1 minute';
    select count(*) into c_hour from alerts where owner_address = p_owner and created_at > now() - interval '1 hour';
  end if;
  if c_min  >= cfg.per_min  then raise exception 'rate limit: too many % per minute (max %)', p_bucket, cfg.per_min; end if;
  if c_hour >= cfg.per_hour then raise exception 'rate limit: too many % per hour (max %)',  p_bucket, cfg.per_hour; end if;
end $$;

create or replace function trg_rl_posts() returns trigger language plpgsql as $$
begin if not rl_skip_for_service() then perform enforce_rate_limit('posts', NEW.author_address); end if; return NEW; end $$;
drop trigger if exists rl_posts on posts;
create trigger rl_posts before insert on posts for each row execute function trg_rl_posts();

create or replace function trg_rl_post_likes() returns trigger language plpgsql as $$
begin if not rl_skip_for_service() then perform enforce_rate_limit('post_likes', NEW.account_address); end if; return NEW; end $$;
drop trigger if exists rl_post_likes on post_likes;
create trigger rl_post_likes before insert on post_likes for each row execute function trg_rl_post_likes();

create or replace function trg_rl_reposts() returns trigger language plpgsql as $$
begin if not rl_skip_for_service() then perform enforce_rate_limit('reposts', NEW.reposter_address); end if; return NEW; end $$;
drop trigger if exists rl_reposts on reposts;
create trigger rl_reposts before insert on reposts for each row execute function trg_rl_reposts();

create or replace function trg_rl_follows() returns trigger language plpgsql as $$
begin if not rl_skip_for_service() then perform enforce_rate_limit('follows', NEW.follower_address); end if; return NEW; end $$;
drop trigger if exists rl_follows on follows;
create trigger rl_follows before insert on follows for each row execute function trg_rl_follows();

create or replace function trg_rl_reports() returns trigger language plpgsql as $$
begin if not rl_skip_for_service() then perform enforce_rate_limit('reports', NEW.reporter); end if; return NEW; end $$;
drop trigger if exists rl_reports on reports;
create trigger rl_reports before insert on reports for each row execute function trg_rl_reports();

create or replace function trg_rl_alerts() returns trigger language plpgsql as $$
begin if not rl_skip_for_service() then perform enforce_rate_limit('alerts', NEW.owner_address); end if; return NEW; end $$;
drop trigger if exists rl_alerts on alerts;
create trigger rl_alerts before insert on alerts for each row execute function trg_rl_alerts();

------------------------------------------------------------
-- Delete-my-account RPC (GDPR right-to-be-forgotten)
------------------------------------------------------------
create or replace function delete_my_account()
returns void language plpgsql security definer as $$
declare me text;
begin
  me := auth_addr();
  if me is null or me = '' then raise exception 'not authenticated'; end if;
  delete from accounts where address = me;
end $$;
revoke all on function delete_my_account() from public;
grant execute on function delete_my_account() to authenticated;

------------------------------------------------------------
-- RLS for the tables added in this block
------------------------------------------------------------
alter table reports               enable row level security;
alter table cabal_mod_log         enable row level security;
alter table user_key_backup       enable row level security;
alter table pending_cabal_invites enable row level security;

drop policy if exists "self read reports" on reports;
create policy "self read reports" on reports for select using (reporter = auth_addr());
drop policy if exists "self file report" on reports;
create policy "self file report" on reports for insert with check (reporter = auth_addr());

drop policy if exists "members read mod log" on cabal_mod_log;
create policy "members read mod log" on cabal_mod_log for select using (
  exists (select 1 from cabal_key_grants g where g.cabal_id = cabal_mod_log.cabal_id and g.account = auth_addr())
);
drop policy if exists "self write mod log" on cabal_mod_log;
create policy "self write mod log" on cabal_mod_log for insert with check (actor = auth_addr());

drop policy if exists "self read key backup" on user_key_backup;
create policy "self read key backup" on user_key_backup for select using (account = auth_addr());
drop policy if exists "self upsert key backup" on user_key_backup;
create policy "self upsert key backup" on user_key_backup for insert with check (account = auth_addr());
drop policy if exists "self update key backup" on user_key_backup;
create policy "self update key backup" on user_key_backup for update using (account = auth_addr());

drop policy if exists "read pending invites" on pending_cabal_invites;
create policy "read pending invites" on pending_cabal_invites for select
  using (granted_by = auth_addr() or invitee = auth_addr());
drop policy if exists "create pending invite" on pending_cabal_invites;
create policy "create pending invite" on pending_cabal_invites for insert
  with check (granted_by = auth_addr());
drop policy if exists "delete pending invite" on pending_cabal_invites;
create policy "delete pending invite" on pending_cabal_invites for delete
  using (granted_by = auth_addr() or invitee = auth_addr());

------------------------------------------------------------
-- Realtime — idempotent: add each table to supabase_realtime once
------------------------------------------------------------
do $$
declare t text;
begin
  for t in select unnest(array[
    'notifications','posts','post_likes','follows','alerts','limit_orders',
    'copy_configs','sniper_configs','token_markets','trades','token_holders',
    'token_chat_messages','bubble_map_nodes','referrals',
    'referral_earnings','points_ledger','redemptions',
    'user_encryption_keys','cabal_key_grants','user_key_backup','pending_cabal_invites',
    'reports','cabal_mod_log'
  ])
  loop
    begin
      execute format('alter publication supabase_realtime add table %I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;

------------------------------------------------------------
-- Extra perf indexes
------------------------------------------------------------
create index if not exists posts_quoted_token_idx
  on posts (quoted_token, created_at desc);
create index if not exists notifications_owner_unread_idx
  on notifications (owner_address, read, created_at desc);
create index if not exists exec_queue_source_idx
  on execution_queue (source, source_id);

------------------------------------------------------------
-- Legacy cleanup (existing projects only — safe no-op on fresh DB)
-- ALL cabal data (metadata, membership, rooms, watchlist) + DMs + chat
-- messages live on Gun.js now. The ONLY cabal-related tables that remain
-- in Postgres are the encryption-infra tables created above:
-- user_encryption_keys and cabal_key_grants.
------------------------------------------------------------
drop table if exists room_messages cascade;
drop table if exists room_invites cascade;
drop table if exists room_members cascade;
drop table if exists messages cascade;
drop table if exists threads cascade;
drop table if exists rooms cascade;
drop table if exists dm_messages cascade;
drop table if exists dm_threads cascade;
drop table if exists cabal_watchlist cascade;
drop table if exists cabal_rooms cascade;
drop table if exists cabal_members cascade;
drop table if exists cabals cascade;

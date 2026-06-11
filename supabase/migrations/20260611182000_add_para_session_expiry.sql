alter table public.para_wallets
  add column if not exists expires_at timestamptz;

update public.para_wallets
set expires_at = coalesce(expires_at, updated_at + interval '7 days')
where expires_at is null;

create index if not exists para_wallets_expires_idx
  on public.para_wallets (expires_at);

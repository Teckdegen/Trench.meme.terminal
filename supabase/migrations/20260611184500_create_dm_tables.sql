create table if not exists public.dm_threads (
  owner_address   text not null references public.accounts(address) on delete cascade,
  channel_id      text not null,
  partner_address text not null references public.accounts(address) on delete cascade,
  last_body       text default '',
  last_ts         timestamptz default now(),
  last_sender     text,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now(),
  primary key (owner_address, channel_id)
);

create index if not exists dm_threads_owner_ts_idx
  on public.dm_threads (owner_address, last_ts desc);

drop trigger if exists dm_threads_updated on public.dm_threads;
create trigger dm_threads_updated before update on public.dm_threads
  for each row execute function public.set_updated_at();

create table if not exists public.dm_messages (
  id             uuid primary key default gen_random_uuid(),
  channel_id     text not null,
  sender_address text not null references public.accounts(address) on delete cascade,
  body           text not null default '',
  kind           text not null default 'text' check (kind in ('text','image')),
  created_at     timestamptz default now(),
  edited_at      timestamptz,
  deleted        boolean not null default false,
  deleted_by     text,
  deleted_at     timestamptz
);

create index if not exists dm_messages_channel_ts_idx
  on public.dm_messages (channel_id, created_at);

alter table public.dm_threads enable row level security;
alter table public.dm_messages enable row level security;

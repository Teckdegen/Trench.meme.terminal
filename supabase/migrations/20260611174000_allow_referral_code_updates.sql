do $$
declare
  constraint_name text;
begin
  select tc.constraint_name
    into constraint_name
  from information_schema.table_constraints tc
  join information_schema.key_column_usage kcu
    on tc.constraint_name = kcu.constraint_name
   and tc.table_schema = kcu.table_schema
   and tc.table_name = kcu.table_name
  where tc.constraint_type = 'FOREIGN KEY'
    and tc.table_schema = 'public'
    and tc.table_name = 'referrals'
    and kcu.column_name = 'code'
  limit 1;

  if constraint_name is not null then
    execute format('alter table public.referrals drop constraint %I', constraint_name);
  end if;
end $$;

alter table public.referrals
  add constraint referrals_code_fkey
  foreign key (code)
  references public.referral_codes(code)
  on update cascade
  on delete cascade;

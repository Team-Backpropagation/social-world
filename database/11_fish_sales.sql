-- Apply after 08_economy.sql and 10_achievements.sql. Safe to re-run.
-- Existing bank/clothing/trade RPC stays intact; fish buying uses its own RPC.
begin;
create table if not exists public.sw_fish_prices (
 item_id text primary key references public.sw_item_catalog(id),
 base_price bigint not null check(base_price between 0 and 100000),
 per_cm bigint not null check(per_cm between 1 and 10000),
 enabled boolean not null default true
);
insert into public.sw_fish_prices(item_id,base_price,per_cm) values
 ('paleChub',30,3),('catfish',100,10),('bitterling',25,5),('loach',40,4),
 ('crucian',70,7),('carp',120,10),('doctorFish',35,5)
on conflict(item_id) do nothing;
create table if not exists public.sw_fish_sales (
 id bigint generated always as identity primary key,
 user_id uuid not null references auth.users(id) on delete cascade,
 transaction_id uuid not null,
 instance_id uuid not null unique,
 item_id text not null references public.sw_item_catalog(id),
 size_cm numeric not null, water_id text, acquired_at timestamptz not null,
 source text not null, price bigint not null check(price>0), sold_at timestamptz not null default now()
);
create index if not exists sw_fish_sales_user_idx on public.sw_fish_sales(user_id,sold_at desc,id desc);
alter table public.sw_fish_prices enable row level security;
alter table public.sw_fish_sales enable row level security;
revoke all on public.sw_fish_prices,public.sw_fish_sales from public,anon,authenticated;
grant select on public.sw_fish_prices,public.sw_fish_sales to authenticated;
drop policy if exists sw_fish_prices_read on public.sw_fish_prices;
create policy sw_fish_prices_read on public.sw_fish_prices for select to authenticated using(true);
drop policy if exists sw_fish_sales_read on public.sw_fish_sales;
create policy sw_fish_sales_read on public.sw_fish_sales for select to authenticated using((select auth.uid())=user_id);

-- Keep completed trade offers when an item is sold/recycled, instead of the old
-- ON DELETE CASCADE. The original item is archived before removing its live row.
alter table public.sw_trade_offers add column if not exists item_snapshot jsonb;
update public.sw_trade_offers o set item_snapshot=jsonb_build_object(
 'id',i.id,'itemId',i.item_id,'sizeCm',i.size_cm,'waterId',i.water_id,
 'caughtAt',i.acquired_at,'source',i.source)
from public.sw_items i where i.id=o.item_id and o.item_snapshot is null;
alter table public.sw_trade_offers alter column item_id drop not null;
do $$ declare c record; begin
 for c in select conname from pg_constraint where conrelid='public.sw_trade_offers'::regclass
  and contype='f' and conkey=array[(select attnum from pg_attribute where attrelid='public.sw_trade_offers'::regclass and attname='item_id')]::smallint[]
 loop execute format('alter table public.sw_trade_offers drop constraint %I',c.conname); end loop;
end $$;
alter table public.sw_trade_offers add constraint sw_trade_offers_item_id_fkey foreign key(item_id) references public.sw_items(id) on delete set null;

create or replace function public.sw_archive_trade_item() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 -- A current owner cannot destroy an item promised in a live trade.
 if exists(select 1 from auth.users where id=old.owner_id) and exists(select 1 from sw_trade_offers where item_id=old.id and status='pending' and expires_at>now()) then raise exception 'item_in_trade'; end if;
 update sw_trade_offers set item_snapshot=jsonb_build_object(
  'id',old.id,'itemId',old.item_id,'sizeCm',old.size_cm,'waterId',old.water_id,
  'caughtAt',old.acquired_at,'source',old.source),
  status=case when status='pending' then 'expired' else status end where item_id=old.id;
 return old;
end $$;
revoke all on function public.sw_archive_trade_item() from public,anon,authenticated;
drop trigger if exists sw_archive_trade_item on public.sw_items;
create trigger sw_archive_trade_item before delete on public.sw_items for each row execute function public.sw_archive_trade_item();

create or replace function public.sw_fish_shop(p_action text default 'quote',p_args jsonb default '{}'::jsonb,p_request_id uuid default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
 u uuid:=auth.uid(); w sw_wallets%rowtype; req sw_economy_requests%rowtype;
 ids uuid[]; it record; tx uuid:=gen_random_uuid(); total bigint:=0; n integer:=0;
 receipt jsonb:='[]'::jsonb; v_result jsonb;
begin
 if u is null then raise exception 'login_required'; end if;
 if p_action is null or p_action not in('quote','sell') then raise exception 'unknown_action'; end if;
 if p_args is null or jsonb_typeof(p_args)<>'object' then raise exception 'invalid_arguments'; end if;
 -- Exactly the same account lock as sw_economy and sw_achievements.
 perform pg_advisory_xact_lock(hashtextextended(u::text,71606));
 perform sw_economy('state');
 select * into w from sw_wallets where user_id=u for update;
 if p_action='quote' then
  select jsonb_build_object('maxSelection',100,'items',coalesce(jsonb_agg(jsonb_build_object(
   'id',i.id,'itemId',i.item_id,'name',c.name,'color',c.color,'sizeCm',i.size_cm,'waterId',i.water_id,
   'price',case when p.enabled and i.size_cm between c.min_size and c.max_size then p.base_price+floor(i.size_cm*p.per_cm)::bigint else 0 end,
   'reason',case when i.source='legacy' then 'legacy_item_not_sellable'
    when exists(select 1 from sw_trade_offers o where o.item_id=i.id and o.status='pending' and o.expires_at>now()) then 'item_in_trade'
    when p.enabled is not true then 'fish_not_accepted'
    when i.size_cm is null or i.size_cm not between c.min_size and c.max_size then 'invalid_fish_size' end
  ) order by i.acquired_at,i.id),'[]'::jsonb)) into v_result
  from sw_items i join sw_item_catalog c on c.id=i.item_id left join sw_fish_prices p on p.item_id=i.item_id
  where i.owner_id=u and c.kind='fish';
  v_result:=v_result||jsonb_build_object('history',(select coalesce(jsonb_agg(to_jsonb(s)),'[]'::jsonb) from (
   select s.id,s.transaction_id,s.item_id,c.name,s.size_cm,s.price,s.sold_at from sw_fish_sales s
   join sw_item_catalog c on c.id=s.item_id where s.user_id=u order by s.id desc limit 20
  )s));
  return jsonb_build_object('state',sw_economy_snapshot(u),'result',v_result);
 end if;
 if p_request_id is null then raise exception 'request_id_required'; end if;
 select * into req from sw_economy_requests where user_id=u and request_id=p_request_id;
 if found then
  if req.action<>'sell_fish' or req.args<>p_args then raise exception 'request_mismatch'; end if;
  return jsonb_build_object('state',sw_economy_snapshot(u),'result',req.result);
 end if;
 if jsonb_typeof(p_args->'instanceIds') is distinct from 'array' then raise exception 'invalid_sale_selection'; end if;
 if jsonb_array_length(p_args->'instanceIds') not between 1 and 100 then raise exception 'invalid_sale_selection'; end if;
 select array_agg(value::uuid order by value::uuid) into ids from jsonb_array_elements_text(p_args->'instanceIds');
 if cardinality(ids)<>(select count(distinct id) from unnest(ids)id) then raise exception 'invalid_sale_selection'; end if;
 if coalesce(p_args->>'expectedTotal','') !~ '^[1-9][0-9]{0,12}$' then raise exception 'invalid_sale_selection'; end if;
 -- Lock price/catalog rows too: admin price edits cannot race this sale.
 for it in select i.*,c.kind,c.min_size,c.max_size,c.name,p.enabled,p.base_price,p.per_cm
  from sw_items i join sw_item_catalog c on c.id=i.item_id join sw_fish_prices p on p.item_id=i.item_id
  where i.id=any(ids) and i.owner_id=u order by i.id for update of i for share of c,p
 loop
  n:=n+1;
  if it.kind<>'fish' or not it.enabled then raise exception 'fish_not_accepted'; end if;
  if it.source='legacy' then raise exception 'legacy_item_not_sellable'; end if;
  if it.size_cm is null or it.size_cm not between it.min_size and it.max_size then raise exception 'invalid_fish_size'; end if;
  if exists(select 1 from sw_trade_offers where item_id=it.id and status='pending' and expires_at>now()) then raise exception 'item_in_trade'; end if;
  total:=total+it.base_price+floor(it.size_cm*it.per_cm)::bigint;
  receipt:=receipt||jsonb_build_array(jsonb_build_object('id',it.id,'itemId',it.item_id,'name',it.name,'sizeCm',it.size_cm,'price',it.base_price+floor(it.size_cm*it.per_cm)::bigint));
 end loop;
 if n<>cardinality(ids) then raise exception 'item_not_owned'; end if;
 if total<>(p_args->>'expectedTotal')::bigint then raise exception 'fish_price_changed'; end if;
 if w.cash+total>9000000000000 then raise exception 'wallet_limit'; end if;
 insert into sw_economy_requests(user_id,request_id,action,args) values(u,p_request_id,'sell_fish',p_args);
 insert into sw_fish_sales(user_id,transaction_id,instance_id,item_id,size_cm,water_id,acquired_at,source,price)
 select u,tx,i.id,i.item_id,i.size_cm,i.water_id,i.acquired_at,i.source,p.base_price+floor(i.size_cm*p.per_cm)::bigint
 from sw_items i join sw_fish_prices p on p.item_id=i.item_id where i.id=any(ids) and i.owner_id=u;
 delete from sw_items where id=any(ids) and owner_id=u;
 update sw_wallets set cash=cash+total,revision=revision+1,updated_at=now() where user_id=u;
 insert into sw_ledger(user_id,transaction_id,action,cash_delta,bank_delta) values(u,tx,'fish_sale',total,0);
 v_result:=jsonb_build_object('transactionId',tx,'soldCount',n,'cashGained',total,'items',receipt);
 update sw_economy_requests set result=v_result where user_id=u and request_id=p_request_id;
 return jsonb_build_object('state',sw_economy_snapshot(u),'result',v_result);
end $$;
revoke all on function public.sw_fish_shop(text,jsonb,uuid) from public,anon;
grant execute on function public.sw_fish_shop(text,jsonb,uuid) to authenticated;
notify pgrst,'reload schema';
commit;

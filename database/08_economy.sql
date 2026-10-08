-- 게임 화폐·온라인 인벤토리·고정 가격 옷 구매·유저 거래 기반.
-- 기존 Supabase Auth를 사용한다. 01~05 테이블을 변경하지 않는다.
-- 테스트 지원금: 새 계정당 10,000원 1회. 운영 전 sw_economy_settings를 조정한다.
begin;
create table if not exists public.sw_economy_settings (
  id boolean primary key default true check (id),
  welcome_amount bigint not null default 10000 check (welcome_amount between 0 and 1000000)
);
insert into public.sw_economy_settings(id) values(true) on conflict do nothing;
create table if not exists public.sw_item_catalog (
  id text primary key, name text not null,
  kind text not null check(kind in ('fish','trash','collectible','clothing')),
  color text not null, price bigint not null default 0 check(price between 0 and 1000000),
  min_size numeric, max_size numeric, recycle_category text
);
insert into public.sw_item_catalog values
 ('paleChub','피라미','fish','#7eacc4',0,8,20,null),
 ('catfish','메기','fish','#7c8991',0,25,80,null),
 ('bitterling','각시붕어','fish','#dba376',0,3,9,null),
 ('loach','미꾸라지','fish','#9c8662',0,8,25,null),
 ('crucian','붕어','fish','#c9b46c',0,12,40,null),
 ('carp','잉어','fish','#c58d64',0,25,90,null),
 ('doctorFish','닥터피쉬','fish','#8da891',0,3,12,null),
 ('coin','작은 동전','collectible','#dbba60',0,null,null,null),
 ('bottle','빈 페트병','trash','#83b7b6',0,null,null,'plastic'),
 ('can','빈 음료 캔','trash','#a6b5ba',0,null,null,'metal'),
 ('paper','종이상자','trash','#bf9b70',0,null,null,'paper'),
 ('glassBottle','유리병','trash','#749a7f',0,null,null,'glass'),
 ('wetPaper','젖은 쪽지','trash','#bbbaa5',0,null,null,'general'),
 ('cap','플라스틱 병뚜껑','trash','#b9b2cf',0,null,null,'plastic'),
 ('sage-shirt','세이지 셔츠','clothing','#8FAA9B',1000,null,null,null),
 ('apricot-shirt','살구 셔츠','clothing','#D9917F',1000,null,null,null),
 ('cream-knit','크림 니트','clothing','#E2CF9C',1200,null,null,null),
 ('sky-shirt','하늘 셔츠','clothing','#96B4CC',1000,null,null,null),
 ('lavender-knit','라벤더 니트','clothing','#B5A4C1',1200,null,null,null),
 ('brown-shirt','소프트 브라운','clothing','#B9987C',1000,null,null,null)
on conflict(id) do nothing;
create table if not exists public.sw_wallets (
 user_id uuid primary key references auth.users(id) on delete cascade,
 cash bigint not null default 0 check(cash between 0 and 9000000000000),
 bank bigint not null default 0 check(bank between 0 and 9000000000000),
 equipped_rod boolean not null default false, equipped_clothing uuid,
 legacy_imported boolean not null default false,
 legacy_recycled_count integer not null default 0 check(legacy_recycled_count between 0 and 2000),
 revision bigint not null default 1, updated_at timestamptz not null default now()
);
create table if not exists public.sw_items (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references auth.users(id) on delete cascade,
 item_id text not null references public.sw_item_catalog(id),
 size_cm numeric, water_id text check(water_id in ('river','park','lake','fountain')),
 acquired_at timestamptz not null default now(),
 source text not null check(source in ('fishing','shop','legacy')),
 legacy_key text, unique(owner_id,legacy_key)
);
create index if not exists sw_items_owner_idx on public.sw_items(owner_id, acquired_at, id);
create table if not exists public.sw_recycling (
 id bigint generated always as identity primary key,
 user_id uuid not null references auth.users(id) on delete cascade,
 item_id text not null, category text not null, recycled_at timestamptz not null default now()
);
create index if not exists sw_recycling_user_idx on public.sw_recycling(user_id);
create table if not exists public.sw_ledger (
 id bigint generated always as identity primary key,
 user_id uuid not null references auth.users(id) on delete cascade,
 transaction_id uuid not null, action text not null,
 cash_delta bigint not null, bank_delta bigint not null, created_at timestamptz not null default now()
);
create index if not exists sw_ledger_user_idx on public.sw_ledger(user_id,created_at desc);
create table if not exists public.sw_economy_requests (
 user_id uuid not null references auth.users(id) on delete cascade,
 request_id uuid not null, action text not null, args jsonb not null, result jsonb,
 created_at timestamptz not null default now(), primary key(user_id,request_id)
);
create table if not exists public.sw_fishing_casts (
 user_id uuid primary key references auth.users(id) on delete cascade,
 id uuid not null, water_id text not null,
 started_at timestamptz not null, bite_at timestamptz not null, expires_at timestamptz not null,
 used boolean not null default false
);
create table if not exists public.sw_trade_offers (
 id uuid primary key default gen_random_uuid(),
 seller_id uuid not null references auth.users(id) on delete cascade,
 buyer_id uuid not null references auth.users(id) on delete cascade,
 item_id uuid not null references public.sw_items(id) on delete cascade,
 price bigint not null check(price between 1 and 1000000),
 status text not null default 'pending' check(status in ('pending','accepted','cancelled','declined','expired')),
 created_at timestamptz not null default now(), expires_at timestamptz not null default(now()+interval '10 minutes'),
 check(seller_id<>buyer_id)
);
create unique index if not exists sw_trade_pending_item_idx on public.sw_trade_offers(item_id) where status='pending';
create index if not exists sw_trade_buyer_idx on public.sw_trade_offers(buyer_id);
create index if not exists sw_trade_seller_idx on public.sw_trade_offers(seller_id);

-- SQL로 만든 표에도 권한과 사용자별 접근 정책을 명시한다.
do $$ declare t text; begin
 foreach t in array array['sw_economy_settings','sw_item_catalog','sw_wallets','sw_items','sw_recycling','sw_ledger','sw_economy_requests','sw_fishing_casts','sw_trade_offers'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on table public.%I from anon, authenticated',t);
 end loop;
end $$;
grant select on public.sw_item_catalog,public.sw_wallets,public.sw_items,public.sw_recycling,public.sw_ledger,public.sw_trade_offers to authenticated;
drop policy if exists sw_catalog_read on public.sw_item_catalog;
create policy sw_catalog_read on public.sw_item_catalog for select to authenticated using(true);
drop policy if exists sw_wallet_read on public.sw_wallets;
create policy sw_wallet_read on public.sw_wallets for select to authenticated using((select auth.uid())=user_id);
drop policy if exists sw_items_read on public.sw_items;
create policy sw_items_read on public.sw_items for select to authenticated using((select auth.uid())=owner_id);
drop policy if exists sw_recycling_read on public.sw_recycling;
create policy sw_recycling_read on public.sw_recycling for select to authenticated using((select auth.uid())=user_id);
drop policy if exists sw_ledger_read on public.sw_ledger;
create policy sw_ledger_read on public.sw_ledger for select to authenticated using((select auth.uid())=user_id);
drop policy if exists sw_trade_read on public.sw_trade_offers;
create policy sw_trade_read on public.sw_trade_offers for select to authenticated using((select auth.uid()) in(seller_id,buyer_id));

-- Internal helper. Never callable from a browser with an arbitrary user ID.
create or replace function public.sw_economy_snapshot(p_user uuid) returns jsonb
language sql security definer set search_path=public,pg_temp as $$
 select jsonb_build_object(
  'userId',w.user_id,'revision',w.revision,'cash',w.cash,'bank',w.bank,'legacyImported',w.legacy_imported,
  'equippedClothing',w.equipped_clothing,
  'catalog',(select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'name',c.name,'kind',c.kind,'color',c.color,'price',c.price) order by c.id),'[]') from sw_item_catalog c where c.kind='clothing'),
  'inventory',jsonb_build_object('version',2,'equipped',case when w.equipped_rod then 'rod' end,
   'instances',jsonb_build_array(jsonb_build_object('id','starter-rod','itemId','rod','tradable',false)) ||
    (select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id',i.id,'itemId',i.item_id,'sizeCm',i.size_cm,'waterId',i.water_id,'caughtAt',i.acquired_at,'source',i.source,'tradable',i.source<>'legacy','listed',exists(select 1 from sw_trade_offers o where o.item_id=i.id and o.status='pending' and o.expires_at>now()))) order by i.acquired_at,i.id),'[]') from sw_items i where i.owner_id=p_user),
   'recycled',(select coalesce(jsonb_agg(jsonb_build_object('itemId',r.item_id,'category',r.category,'recycledAt',r.recycled_at)),'[]') from sw_recycling r where r.user_id=p_user),
   'legacyRecycledCount',w.legacy_recycled_count),
  'offers',(select coalesce(jsonb_agg(to_jsonb(o) order by o.created_at desc),'[]') from (select * from sw_trade_offers where p_user in(seller_id,buyer_id) and status='pending' and expires_at>now() limit 100) o)
 ) from sw_wallets w where w.user_id=p_user
$$;
revoke all on function public.sw_economy_snapshot(uuid) from public,anon,authenticated;

-- All changes are one DB transaction. Account locks are ordered for two-user trades.
create or replace function public.sw_economy(p_action text default 'state',p_args jsonb default '{}'::jsonb,p_request_id uuid default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
 u uuid:=auth.uid(); peer uuid; lock_user uuid; w sw_wallets%rowtype; cat sw_item_catalog%rowtype;
 it sw_items%rowtype; offer sw_trade_offers%rowtype; castrow sw_fishing_casts%rowtype;
 req sw_economy_requests%rowtype; v_result jsonb:='{}'; e jsonb; n integer; amount bigint;
 tx uuid:=gen_random_uuid(); item_uuid uuid; cast_uuid uuid; roll numeric; selected text;
 water text; min_ready timestamptz; size numeric; grant_amount bigint; changed boolean:=false;
begin
 if u is null then raise exception 'login_required'; end if;
 if p_args is null or jsonb_typeof(p_args)<>'object' then raise exception 'invalid_arguments'; end if;
 if p_action is null or p_action not in('state','deposit','withdraw','buy','equip_rod','equip_clothing','recycle','import_legacy','begin_fishing','finish_fishing','cancel_fishing','offer','accept_offer','cancel_offer','decline_offer') then raise exception 'unknown_action'; end if;
 if p_action<>'state' and p_request_id is null then raise exception 'request_id_required'; end if;
 if p_action in('accept_offer','cancel_offer','decline_offer') then
  select case when seller_id=u then buyer_id else seller_id end into peer from sw_trade_offers where id=(p_args->>'offerId')::uuid and u in(seller_id,buyer_id);
  if peer is null then raise exception 'offer_not_found'; end if;
 elsif p_action='offer' then
  peer:=(p_args->>'buyerId')::uuid;
  if peer is null or peer=u or not exists(select 1 from sw_wallets where user_id=peer) then raise exception 'invalid_recipient'; end if;
 end if;
 for lock_user in select distinct x from unnest(array[u,peer]) x where x is not null order by x loop
  perform pg_advisory_xact_lock(hashtextextended(lock_user::text,71606));
 end loop;
 if not exists(select 1 from sw_wallets where user_id=u) then
  select welcome_amount into grant_amount from sw_economy_settings where id;
  insert into sw_wallets(user_id,cash) values(u,coalesce(grant_amount,0));
  insert into sw_ledger(user_id,transaction_id,action,cash_delta,bank_delta) values(u,tx,'welcome',coalesce(grant_amount,0),0);
 end if;
 select * into w from sw_wallets where user_id=u for update;
 if p_action='state' then return jsonb_build_object('state',sw_economy_snapshot(u),'result',v_result); end if;
 select * into req from sw_economy_requests where user_id=u and request_id=p_request_id;
 if found then
  if req.action<>p_action or req.args<>p_args then raise exception 'request_mismatch'; end if;
  return jsonb_build_object('state',sw_economy_snapshot(u),'result',req.result);
 end if;
 insert into sw_economy_requests(user_id,request_id,action,args) values(u,p_request_id,p_action,p_args);

 if p_action in('deposit','withdraw') then
  if coalesce(p_args->>'amount','') !~ '^[1-9][0-9]{0,12}$' then raise exception 'invalid_amount'; end if;
  amount:=(p_args->>'amount')::bigint;
  if p_action='deposit' then
   if w.cash<amount then raise exception 'insufficient_cash'; end if;
   update sw_wallets set cash=cash-amount,bank=bank+amount where user_id=u;
  else
   if w.bank<amount then raise exception 'insufficient_bank'; end if;
   update sw_wallets set cash=cash+amount,bank=bank-amount where user_id=u;
  end if;
  insert into sw_ledger(user_id,transaction_id,action,cash_delta,bank_delta) values(u,tx,p_action,case when p_action='deposit' then -amount else amount end,case when p_action='deposit' then amount else -amount end);
  changed:=true;
 elsif p_action='buy' then
  select * into cat from sw_item_catalog where id=p_args->>'itemId' and kind='clothing';
  if not found then raise exception 'item_not_for_sale'; end if;
  if exists(select 1 from sw_items where owner_id=u and item_id=cat.id) then raise exception 'already_owned'; end if;
  if w.cash<cat.price then raise exception 'insufficient_cash'; end if;
  update sw_wallets set cash=cash-cat.price where user_id=u;
  insert into sw_items(owner_id,item_id,source) values(u,cat.id,'shop') returning id into item_uuid;
  insert into sw_ledger(user_id,transaction_id,action,cash_delta,bank_delta) values(u,tx,'buy',-cat.price,0);
  v_result:=jsonb_build_object('itemId',item_uuid); changed:=true;
 elsif p_action='equip_rod' then
  if jsonb_typeof(p_args->'equipped') is distinct from 'boolean' then raise exception 'invalid_arguments'; end if;
  update sw_wallets set equipped_rod=(p_args->>'equipped')::boolean where user_id=u; changed:=true;
 elsif p_action='equip_clothing' and p_args->>'instanceId' is null then
  update sw_wallets set equipped_clothing=null where user_id=u; changed:=true;
 elsif p_action in('equip_clothing','recycle') then
  select i.* into it from sw_items i where i.id=(p_args->>'instanceId')::uuid and owner_id=u for update;
  if not found then raise exception 'item_not_owned'; end if;
  if exists(select 1 from sw_trade_offers where item_id=it.id and status='pending' and expires_at>now()) then raise exception 'item_in_trade'; end if;
  select * into cat from sw_item_catalog where id=it.item_id;
  if p_action='equip_clothing' then
   if cat.kind<>'clothing' then raise exception 'invalid_item'; end if;
   update sw_wallets set equipped_clothing=it.id where user_id=u;
  else
   if cat.kind<>'trash' or cat.recycle_category is distinct from p_args->>'category' then raise exception 'wrong_recycle_bin'; end if;
   insert into sw_recycling(user_id,item_id,category) values(u,it.item_id,cat.recycle_category);
   delete from sw_items where id=it.id;
  end if;
  changed:=true;
 elsif p_action='import_legacy' then
  if not w.legacy_imported then
   if jsonb_typeof(p_args->'entries') is distinct from 'array' or jsonb_array_length(p_args->'entries')>2000 then raise exception 'invalid_import'; end if;
   for e in select value from jsonb_array_elements(p_args->'entries') loop
    if length(coalesce(e->>'id','')) not between 1 and 160 then raise exception 'invalid_import'; end if;
    select * into cat from sw_item_catalog where id=e->>'itemId' and kind<>'clothing';
    if not found then raise exception 'invalid_import'; end if;
    size:=null;
    if cat.kind='fish' then
     size:=(e->>'sizeCm')::numeric;
     if size is null or size not between cat.min_size and cat.max_size then raise exception 'invalid_import'; end if;
    end if;
    insert into sw_items(owner_id,item_id,size_cm,water_id,acquired_at,source,legacy_key)
    values(u,cat.id,size,e->>'waterId',coalesce((e->>'caughtAt')::timestamptz,now()),'legacy',e->>'id') on conflict(owner_id,legacy_key) do nothing;
   end loop;
   n:=coalesce((p_args->>'recycledCount')::integer,0);
   if n not between 0 and 2000 then raise exception 'invalid_import'; end if;
   update sw_wallets set legacy_imported=true,legacy_recycled_count=n,equipped_rod=coalesce((p_args->>'equipped')::boolean,false) where user_id=u; changed:=true;
  end if;
 elsif p_action='begin_fishing' then
  if not w.equipped_rod then raise exception 'rod_not_equipped'; end if;
  water:=p_args->>'waterId';
  if water is null or water not in('river','park','lake','fountain') then raise exception 'unknown_water'; end if;
  select * into castrow from sw_fishing_casts where user_id=u;
  if found and clock_timestamp()<castrow.started_at+interval '700 milliseconds' then raise exception 'fishing_cooldown'; end if;
  cast_uuid:=gen_random_uuid(); min_ready:=clock_timestamp()+(3150+floor(random()*3001))*interval '1 millisecond';
  insert into sw_fishing_casts(user_id,id,water_id,started_at,bite_at,expires_at)
  values(u,cast_uuid,water,clock_timestamp(),min_ready,min_ready+interval '2200 milliseconds')
  on conflict(user_id) do update set id=excluded.id,water_id=excluded.water_id,started_at=excluded.started_at,bite_at=excluded.bite_at,expires_at=excluded.expires_at,used=false;
  v_result:=jsonb_build_object('castId',cast_uuid,'biteAt',min_ready,'expiresAt',min_ready+interval '2200 milliseconds','serverNow',clock_timestamp());
 elsif p_action='finish_fishing' then
  select * into castrow from sw_fishing_casts where user_id=u and id=(p_args->>'castId')::uuid for update;
  if not found or castrow.used then raise exception 'cast_not_active'; end if;
  if not w.equipped_rod then raise exception 'rod_not_equipped'; end if;
  if clock_timestamp()<castrow.bite_at then raise exception 'too_early'; end if;
  if clock_timestamp()>castrow.expires_at then raise exception 'bite_missed'; end if;
  roll:=random()*100; water:=castrow.water_id;
  selected:=case water
   when 'river' then case when roll<70 then 'paleChub' when roll<90 then 'catfish' when roll<95 then 'bottle' else 'paper' end
   when 'park' then case when roll<70 then 'bitterling' when roll<90 then 'loach' when roll<95 then 'glassBottle' else 'paper' end
   when 'lake' then case when roll<70 then 'crucian' when roll<90 then 'carp' when roll<95 then 'can' else 'bottle' end
   else case when roll<55 then 'doctorFish' when roll<85 then 'coin' when roll<92.5 then 'cap' else 'wetPaper' end end;
  select * into cat from sw_item_catalog where id=selected;
  size:=case when cat.kind='fish' then round(cat.min_size+random()::numeric*(cat.max_size-cat.min_size),1) end;
  insert into sw_items(owner_id,item_id,size_cm,water_id,source) values(u,selected,size,water,'fishing') returning id into item_uuid;
  update sw_fishing_casts set used=true where user_id=u;
  v_result:=jsonb_build_object('itemId',item_uuid); changed:=true;
 elsif p_action='cancel_fishing' then
  update sw_fishing_casts set used=true where user_id=u and id=(p_args->>'castId')::uuid;
 elsif p_action='offer' then
  peer:=(p_args->>'buyerId')::uuid;
  if peer is null or peer=u or not exists(select 1 from sw_wallets where user_id=peer) then raise exception 'invalid_recipient'; end if;
  if coalesce(p_args->>'price','') !~ '^[1-9][0-9]{0,6}$' then raise exception 'invalid_amount'; end if;
  amount:=(p_args->>'price')::bigint;
  if amount>1000000 then raise exception 'invalid_amount'; end if;
  select * into it from sw_items where id=(p_args->>'instanceId')::uuid and owner_id=u for update;
  if not found then raise exception 'item_not_owned'; end if;
  if it.source='legacy' then raise exception 'legacy_item_not_tradable'; end if;
  if w.equipped_clothing=it.id then raise exception 'unequip_before_trade'; end if;
  update sw_trade_offers set status='expired' where item_id=it.id and status='pending' and expires_at<=now();
  if exists(select 1 from sw_trade_offers where item_id=it.id and status='pending') then raise exception 'item_in_trade'; end if;
  insert into sw_trade_offers(seller_id,buyer_id,item_id,price) values(u,peer,it.id,amount) returning id into item_uuid;
  v_result:=jsonb_build_object('offerId',item_uuid); changed:=true;
 elsif p_action in('accept_offer','cancel_offer','decline_offer') then
  select * into offer from sw_trade_offers where id=(p_args->>'offerId')::uuid and u in(seller_id,buyer_id) for update;
  if not found then raise exception 'offer_not_found'; end if;
  if offer.status<>'pending' then raise exception 'offer_closed'; end if;
  if p_action='cancel_offer' then
   if u<>offer.seller_id then raise exception 'offer_forbidden'; end if;
   update sw_trade_offers set status='cancelled' where id=offer.id;
  elsif p_action='decline_offer' then
   if u<>offer.buyer_id then raise exception 'offer_forbidden'; end if;
   update sw_trade_offers set status='declined' where id=offer.id;
  else
   if u<>offer.buyer_id then raise exception 'offer_forbidden'; end if;
   if offer.expires_at<=clock_timestamp() then raise exception 'offer_expired'; end if;
   select * into it from sw_items where id=offer.item_id and owner_id=offer.seller_id for update;
   if not found or it.source='legacy' then raise exception 'item_not_owned'; end if;
   if w.cash<offer.price then raise exception 'insufficient_cash'; end if;
   if exists(select 1 from sw_items i join sw_item_catalog c on c.id=i.item_id where i.owner_id=u and i.item_id=it.item_id and c.kind='clothing') then raise exception 'already_owned'; end if;
   update sw_wallets set cash=cash-offer.price where user_id=u;
   update sw_wallets set cash=cash+offer.price,equipped_clothing=case when equipped_clothing=it.id then null else equipped_clothing end,revision=revision+1,updated_at=now() where user_id=offer.seller_id;
   update sw_items set owner_id=u where id=it.id;
   update sw_trade_offers set status='accepted' where id=offer.id;
   insert into sw_ledger(user_id,transaction_id,action,cash_delta,bank_delta) values(u,tx,'trade_buy',-offer.price,0),(offer.seller_id,tx,'trade_sell',offer.price,0);
  end if;
  changed:=true;
 end if;
 if changed then update sw_wallets set revision=revision+1,updated_at=now() where user_id=u; end if;
 if changed and p_action in('offer','cancel_offer','decline_offer') then update sw_wallets set revision=revision+1,updated_at=now() where user_id=peer; end if;
 update sw_economy_requests set result=v_result || jsonb_build_object('transactionId',tx) where user_id=u and request_id=p_request_id;
 return jsonb_build_object('state',sw_economy_snapshot(u),'result',v_result || jsonb_build_object('transactionId',tx));
end $$;
revoke all on function public.sw_economy(text,jsonb,uuid) from public,anon;
grant execute on function public.sw_economy(text,jsonb,uuid) to authenticated;
notify pgrst,'reload schema';
commit;

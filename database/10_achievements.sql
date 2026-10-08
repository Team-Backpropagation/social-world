-- Personal achievements and equipped titles. Requires 08_economy.sql.
-- Fish count for the original catcher; imported browser history is excluded.
begin;
create table if not exists public.sw_achievement_catalog (
 id text primary key, title text not null, description text not null,
 metric text not null check(metric in('fish_size','recycling')), target numeric not null check(target>0), ordinal int not null
);
insert into sw_achievement_catalog values
 ('big-catch','큼직한 손맛','60cm 이상 물고기를 직접 낚기','fish_size',60,1),
 ('master-angler','대물 낚시꾼','80cm 이상 물고기를 직접 낚기','fish_size',80,2),
 ('recycling-starter','분리수거 입문자','올바른 분리수거 10회','recycling',10,3),
 ('village-guardian','마을 환경 지킴이','올바른 분리수거 50회','recycling',50,4)
on conflict(id) do nothing;
create table if not exists public.sw_achievement_progress (
 user_id uuid primary key references auth.users(id) on delete cascade,
 best_fish_cm numeric not null default 0, recycled_count bigint not null default 0
);
create table if not exists public.sw_user_achievements (
 user_id uuid not null references auth.users(id) on delete cascade,
 achievement_id text not null references sw_achievement_catalog(id), unlocked_at timestamptz not null default now(),
 primary key(user_id,achievement_id)
);
alter table public.sw_wallets add column if not exists equipped_title text references public.sw_achievement_catalog(id);
alter table public.sw_achievement_catalog enable row level security;
alter table public.sw_achievement_progress enable row level security;
alter table public.sw_user_achievements enable row level security;
drop policy if exists sw_achievement_catalog_read on sw_achievement_catalog;
create policy sw_achievement_catalog_read on sw_achievement_catalog for select to authenticated using(true);
drop policy if exists sw_achievement_progress_read on sw_achievement_progress;
create policy sw_achievement_progress_read on sw_achievement_progress for select to authenticated using((select auth.uid())=user_id);
drop policy if exists sw_user_achievements_read on sw_user_achievements;
create policy sw_user_achievements_read on sw_user_achievements for select to authenticated using((select auth.uid())=user_id);
revoke all on sw_achievement_catalog,sw_achievement_progress,sw_user_achievements from public,anon,authenticated;
grant select on sw_achievement_catalog,sw_achievement_progress,sw_user_achievements to authenticated;
create or replace function public.sw_check_achievements(p_user uuid) returns void
language sql security definer set search_path=public as $$
 insert into sw_user_achievements(user_id,achievement_id)
 select p.user_id,c.id from sw_achievement_progress p cross join sw_achievement_catalog c
 where p.user_id=p_user and case c.metric when 'fish_size' then p.best_fish_cm else p.recycled_count end>=c.target
 on conflict(user_id,achievement_id) do nothing;
$$;
revoke all on function sw_check_achievements(uuid) from public,anon,authenticated;
create or replace function public.sw_achievement_event() returns trigger
language plpgsql security definer set search_path=public as $$
begin
 if tg_table_name='sw_items' then
  if new.source<>'fishing' or new.size_cm is null or not exists(select 1 from sw_item_catalog where id=new.item_id and kind='fish') then return new; end if;
  insert into sw_achievement_progress(user_id,best_fish_cm) values(new.owner_id,new.size_cm)
  on conflict(user_id) do update set best_fish_cm=greatest(sw_achievement_progress.best_fish_cm,excluded.best_fish_cm);
  perform sw_check_achievements(new.owner_id);
 else
  insert into sw_achievement_progress(user_id,recycled_count) values(new.user_id,1)
  on conflict(user_id) do update set recycled_count=sw_achievement_progress.recycled_count+1;
  perform sw_check_achievements(new.user_id);
 end if;
 return new;
end $$;
revoke all on function sw_achievement_event() from public,anon,authenticated;
drop trigger if exists sw_fishing_achievement on sw_items;
create trigger sw_fishing_achievement after insert on sw_items for each row execute function sw_achievement_event();
drop trigger if exists sw_recycling_achievement on sw_recycling;
create trigger sw_recycling_achievement after insert on sw_recycling for each row execute function sw_achievement_event();
-- Existing online fish: first accepted seller is the original catcher after a trade.
insert into sw_achievement_progress(user_id,best_fish_cm)
select caught_by,max(size_cm) from (
 select coalesce((select o.seller_id from sw_trade_offers o where o.item_id=i.id and o.status='accepted' order by o.created_at,o.id limit 1),i.owner_id) caught_by,i.size_cm
 from sw_items i join sw_item_catalog c on c.id=i.item_id where i.source='fishing' and c.kind='fish'
) catches group by caught_by
on conflict(user_id) do update set best_fish_cm=greatest(sw_achievement_progress.best_fish_cm,excluded.best_fish_cm);
insert into sw_achievement_progress(user_id,recycled_count)
select user_id,count(*) from sw_recycling group by user_id
on conflict(user_id) do update set recycled_count=greatest(sw_achievement_progress.recycled_count,excluded.recycled_count);
insert into sw_user_achievements(user_id,achievement_id)
select p.user_id,c.id from sw_achievement_progress p cross join sw_achievement_catalog c
where case c.metric when 'fish_size' then p.best_fish_cm else p.recycled_count end>=c.target
on conflict(user_id,achievement_id) do nothing;
create or replace function public.sw_achievements(p_action text default 'state',p_title_id text default null) returns jsonb
language plpgsql security definer set search_path=public as $$
declare u uuid:=auth.uid(); result jsonb;
begin
 if u is null then raise exception 'login_required'; end if;
 if p_action not in('state','equip') or p_action is null then raise exception 'unknown_action'; end if;
 if p_action='equip' then
  perform pg_advisory_xact_lock(hashtextextended(u::text,71606));
  if p_title_id is not null and not exists(select 1 from sw_user_achievements where user_id=u and achievement_id=p_title_id) then raise exception 'title_locked'; end if;
  update sw_wallets set equipped_title=p_title_id,revision=revision+1,updated_at=now() where user_id=u;
  if not found then raise exception 'wallet_not_ready'; end if;
 end if;
 select jsonb_build_object('userId',u,'equippedTitle',(select equipped_title from sw_wallets where user_id=u),
  'progress',jsonb_build_object('bestFishCm',coalesce((select best_fish_cm from sw_achievement_progress where user_id=u),0),'recycledCount',coalesce((select recycled_count from sw_achievement_progress where user_id=u),0)),
  'catalog',(select jsonb_agg(to_jsonb(c) order by ordinal) from sw_achievement_catalog c),
  'earned',(select coalesce(jsonb_agg(jsonb_build_object('id',achievement_id,'unlockedAt',unlocked_at)),'[]') from sw_user_achievements where user_id=u)) into result;
 return result;
end $$;
revoke all on function sw_achievements(text,text) from public,anon;
grant execute on function sw_achievements(text,text) to authenticated;
notify pgrst,'reload schema';
commit;

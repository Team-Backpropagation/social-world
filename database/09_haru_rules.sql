-- ============================================================
-- 09. 하루 정책 고르기 규칙 보정 (2026-10-08 실제 데이터 검수 결과)
--     06_haru.sql 다음에 실행. 여러 번 실행해도 된다(함수만 바꿈, 표·데이터는 그대로)
--
--  바뀐 점
--   ① '저소득'만 붙은 사업은 특정 대상이 아니다.
--      복지로는 소득 기준이 있는 사업(청년월세 지원·행복주택·버팀목전세·청년내일저축계좌·국민취업지원제도 …)에
--      거의 다 '저소득'을 붙인다. 06에서는 이 사업들이 모두 "특정 대상 정책 보기" 안으로 숨었다.
--      → 저소득 외의 대상(장애인·보훈대상자·한부모 …)이 있을 때만 특정 대상. 저소득만 있으면 기본 카드에 나오고
--        추천 이유에 '소득 기준이 있어요'를 붙인다.
--   ② 메뉴·특정 대상·나이 자료 보정은 risk_agent/haru_sync.py 규칙으로 한다(이 파일과 별개).
--      python haru_sync.py --refresh-menus  ← API 없이 저장된 정책에 다시 적용
--
--  Python 판: risk_agent/haru_recommend.py (같은 규칙, tests/test_haru_recommend.py)
-- ============================================================

-- 특정 대상인가 — 저소득을 뺀 대상 특성이 남으면 특정 대상
create or replace function public._haru_is_special(groups text[])
returns boolean language sql immutable set search_path = public
as $$ select cardinality(array_remove(coalesce(groups, '{}'), '저소득')) > 0 $$;

create or replace function public.recommend_programs(
  p_menu text, p_limit int default 3, p_special boolean default false)
returns table (
  serv_id text, name text, summary text, org text, region_label text, is_local boolean,
  benefit_text text, target_text text, criteria_text text, apply_text text,
  detail_url text, homepage text, contact text, online_apply boolean,
  last_checked date, age_note boolean, target_groups text[], reason text)
language plpgsql stable security definer set search_path = public
as $$
#variable_conflict use_column
declare s record;
begin
  select * into s from public._haru_scope();
  return query
  with cand as (
    select w.*,
           (w.source = 'local') as loc,
           (s.age_lo is not null and (w.age_min is null and w.age_max is null)) as age_unknown,
           (s.age_lo is not null and (coalesce(w.age_min, 0) > s.age_lo or coalesce(w.age_max, 200) < s.age_hi)) as age_partial
    from public.welfare_programs w
    where w.is_active
      and p_menu = any(w.menus)
      and (w.source = 'central' or w.sgg_code = s.my_sgg)
      and (s.stages is null or cardinality(w.life_stages) = 0 or w.life_stages && s.stages)
      and (s.age_lo is null or (coalesce(w.age_min, 0) <= s.age_hi and coalesce(w.age_max, 200) >= s.age_lo))
      and public._haru_is_special(w.target_groups) = p_special
  )
  select c.serv_id, c.name, c.summary, c.org, c.region_label, c.loc,
         c.benefit_text, c.target_text, c.criteria_text, c.apply_text,
         c.detail_url, c.homepage,
         nullif(concat_ws(' ', c.contacts->0->>'name', c.contacts->0->>'value'), ''),
         c.online_apply,
         coalesce(c.source_modified, c.fetched_at::date),
         (c.age_unknown or c.age_partial),
         c.target_groups,
         concat_ws(' · ',
           case when c.loc then c.region_label || '에서 하는 사업이에요' end,
           case when c.life_stages = array['청년'] then '청년만을 위한 사업이에요' end,
           case when c.online_apply then '온라인으로 신청할 수 있어요' end,
           case when not p_special and '저소득' = any(c.target_groups) then '소득 기준이 있어요' end,
           case when c.age_partial then '나이 조건이 일부만 맞을 수 있어요' end)
  from cand c
  order by (coalesce(c.online_apply::int, 0) + (c.life_stages = array['청년'])::int) desc,
           c.loc desc, c.popularity desc nulls last, c.name
  limit greatest(1, least(coalesce(p_limit, 3), 10));
end $$;
revoke all on function public.recommend_programs(text, int, boolean) from public, anon;
grant execute on function public.recommend_programs(text, int, boolean) to authenticated;

create or replace function public.program_counts(p_menu text)
returns table (eligible int, special int, ineligible int)
language plpgsql stable security definer set search_path = public
as $$
#variable_conflict use_column
declare s record;
begin
  select * into s from public._haru_scope();
  return query
  with region as (
    select w.*,
           ((s.stages is null or cardinality(w.life_stages) = 0 or w.life_stages && s.stages)
            and (s.age_lo is null or (coalesce(w.age_min, 0) <= s.age_hi and coalesce(w.age_max, 200) >= s.age_lo))) as fits
    from public.welfare_programs w
    where w.is_active and p_menu = any(w.menus)
      and (w.source = 'central' or w.sgg_code = s.my_sgg)
  )
  select count(*) filter (where fits and not public._haru_is_special(target_groups))::int,
         count(*) filter (where fits and public._haru_is_special(target_groups))::int,
         count(*) filter (where not fits)::int
  from region;
end $$;
revoke all on function public.program_counts(text) from public, anon;
grant execute on function public.program_counts(text) to authenticated;

comment on column public.welfare_programs.target_groups is
  '대상 특성: 복지로 가구상황(장애인·저소득·한부모 …) + 이름으로 더한 것(의사상자·자립준비청년 …). 저소득 외의 값이 있으면 특정 대상 정책(09)';

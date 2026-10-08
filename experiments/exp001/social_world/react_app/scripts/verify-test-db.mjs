// EXP-001: 격리된 테스트 Supabase에서만 실행하는 두 사용자 RLS 확인.
// 익명 테스트 계정 2개와 가상 프로필/대화/미션 행을 만든다. 운영 프로젝트에는 실행하지 않는다.
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

function readEnv() {
  const rows = readFileSync(new URL('../.env', import.meta.url), 'utf8').split(/\r?\n/)
  return Object.fromEntries(rows.filter((line) => line && !line.trimStart().startsWith('#') && line.includes('='))
    .map((line) => {
      const i = line.indexOf('=')
      return [line.slice(0, i).trim(), line.slice(i + 1).trim().replace(/^['"]|['"]$/g, '')]
    }))
}

function ensure(condition, message) {
  if (!condition) throw new Error(message)
}

async function checked(label, promise) {
  const result = await promise
  if (result.error) throw new Error(`${label}: ${result.error.message}`)
  return result.data
}

async function main() {
  const env = readEnv()
  ensure(env.EXP_ALLOW_DB_WRITES === 'isolated-test-project',
    '.env에 EXP_ALLOW_DB_WRITES=isolated-test-project를 넣은 격리 테스트 프로젝트에서만 실행하세요.')
  ensure(env.VITE_SUPABASE_URL && env.VITE_SUPABASE_ANON_KEY, 'Supabase URL과 anon key가 필요합니다.')
  const makeClient = () => createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const a = makeClient()
  const b = makeClient()
  const userA = (await checked('A 익명 로그인', a.auth.signInAnonymously())).user
  const userB = (await checked('B 익명 로그인', b.auth.signInAnonymously())).user
  ensure(userA && userB && userA.id !== userB.id, '테스트 계정 두 개를 만들지 못했습니다.')

  for (const [client, user, nickname, region] of [
    [a, userA, 'EXP001_A', '11680'], [b, userB, 'EXP001_B', '51110'],
  ]) {
    await checked('가상 프로필 생성', client.from('profiles').insert({
      id: user.id, nickname, sgg_code: region, age_group: '20대', gender: 'F',
      onboarded_at: new Date().toISOString(),
    }))
  }
  const otherProfile = await checked('타인 프로필 조회', b.from('profiles').select('id').eq('id', userA.id))
  ensure(otherProfile.length === 0, 'RLS 실패: B가 A의 프로필을 읽었습니다.')

  const session = await checked('A 가상 대화 저장', a.from('npc_sessions').insert({
    npc_type: 'psych', risk_keyword_count: 0, severity_score: 0,
    keyword_tags: [], ended_at: new Date().toISOString(),
  }).select('id').single())
  const otherSession = await checked('타인 대화 조회', b.from('npc_sessions').select('id').eq('id', session.id))
  ensure(otherSession.length === 0, 'RLS 실패: B가 A의 대화 신호를 읽었습니다.')

  const missions = await checked('미션 목록 조회', a.from('missions').select('id').eq('is_active', true).limit(1))
  ensure(missions.length === 1, '활성 미션이 없습니다. 01 및 02 SQL 적용을 확인하세요.')
  const progress = await checked('A 미션 참여', a.from('mission_progress').insert({
    user_id: userA.id, mission_id: missions[0].id, status: 'in_progress',
  }).select('id').single())
  const otherProgress = await checked('타인 미션 조회', b.from('mission_progress').select('id').eq('id', progress.id))
  ensure(otherProgress.length === 0, 'RLS 실패: B가 A의 미션 기록을 읽었습니다.')

  console.log('통과: 익명 로그인 2명, 프로필·대화·미션 저장, 타인 기록 3종 조회 차단')
  console.log('테스트 프로젝트에는 익명 계정 2개와 가상 행이 남습니다. 실제 사용자 데이터는 사용하지 않았습니다.')
}

main().catch((error) => {
  console.error(`테스트 DB 점검 실패: ${error.message}`)
  process.exitCode = 1
})

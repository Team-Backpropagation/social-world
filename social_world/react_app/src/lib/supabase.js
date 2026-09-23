import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

// .env에 키가 아직 없으면(프로젝트를 만들기 전 로컬 확인 단계) 앱이 죽지 않고
// "설정 안내" 화면을 보여줄 수 있도록 플래그만 export 한다.
// DB_연결_단계별_실행가이드.md 7-2·7-3 절 그대로.
export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey)

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null

// 시군구 코드 — 대회 대상 지역 2곳 (데이터_지표_설계_노트 기준 행정표준코드)
export const SGG_CODES = [
  { code: '11680', label: '서울시 강남구' },
  { code: '51110', label: '강원도 춘천시' },
]

export const AGE_GROUPS = ['10대', '20대', '30대', '40대', '50대', '60대이상']

# 소셜 월드 DB 연결 — 단계별 실행 가이드

> 2026-09-22 작성 · **DB 연결 작업을 처음 해보는 사람 기준**으로 쓴 실행 문서.
> 「기능 정의서 v2.1」 3-7절(F-46 소셜 로그인 인증 및 계정 DB 연동)의 실행 편이며,
> 화면 기획서의 SW-01(로그인) · SW-02(온보딩) 구현에 그대로 대응한다.
>
> 읽는 법 — 0~1장은 개념(15분), 2~7장은 순서대로 따라 하면 실제로 동작한다.
> 8장부터는 막혔을 때 찾아보는 참고 자료다.
>
> **2026-09-23 추가** — 4장 SQL은 실행 파일 `01_socialworld_base.sql`로 정리했다(여러 번 실행해도 안전).
> 위험 탐지 에이전트와 순환 연결하는 절차는 **13장**. 실제 구현은 8장의 "서버가 지표를 직접 적재" 대신 13장 방식을 쓴다.

---

## 0. 먼저 알아야 할 개념 (15분)

### 0-1. 지금 우리가 하려는 게 뭔가

"DB 연결"이라는 말은 사실 세 가지 일을 한 번에 가리킨다.

| 하는 일 | 쉽게 말하면 | 우리 서비스에서 |
|---|---|---|
| ① 데이터 저장소 만들기 | 엑셀 시트 여러 장을 온라인에 두는 것 | 사용자 프로필, 미션 진행상태, 동아리 목록 |
| ② 거기에 접속할 권한 얻기 | 그 시트의 주소와 열쇠를 받는 것 | Project URL + API Key |
| ③ 코드에서 읽고 쓰기 | 화면에서 "저장" 누르면 시트에 줄이 추가되는 것 | 온보딩 완료 → profiles 테이블에 INSERT |

세 가지 모두 이 문서에서 다룬다.

### 0-2. 용어 7개

| 용어 | 뜻 | 비유 |
|---|---|---|
| 테이블(table) | 데이터를 담는 표 하나 | 엑셀의 시트 한 장 |
| 행(row) / 열(column) | 가로 한 줄 / 세로 한 칸 | 사용자 1명 / '닉네임' 항목 |
| 기본키(PK) | 행을 하나로 특정하는 값 | 학번, 사원번호 |
| 외래키(FK) | 다른 테이블의 행을 가리키는 값 | "이 미션기록은 3번 사용자의 것" |
| SQL | DB에 지시하는 언어 | `select * from profiles` = "profiles 전부 보여줘" |
| 환경변수(.env) | 코드에 직접 안 쓰고 따로 보관하는 비밀값 | 비밀번호를 메모장이 아니라 금고에 |
| RLS | 행 단위 접근 권한 규칙 | "각자 자기 사물함만 열 수 있음" |

RLS는 뒤에서 다시 자세히 설명한다. **초보자가 가장 많이 헤매는 지점**이라 4장을 통째로 썼다.

### 0-3. 왜 Supabase를 쓰는가

DB를 쓰려면 원래는 서버를 빌리고, PostgreSQL을 설치하고, 방화벽을 열고, 백업을 걸어야 한다.
Supabase는 이 과정을 없애고 **가입 후 2분이면 PostgreSQL 한 개를 바로 주는 서비스**다.

우리 상황에 맞는 이유는 세 가지다.

- 남은 개발 기간이 약 20일이다. 인프라 구축에 쓸 시간이 없다.
- **로그인 기능이 내장**되어 있고, **카카오 로그인을 공식 지원**한다(6장). 직접 만들면 며칠 걸리는 작업이다.
- 무료 플랜으로 프로토타입·시연이 가능하다.

> 대안: Firebase(문서형 DB, 카카오 미지원이라 별도 작업 필요), 직접 구축(PostgreSQL + 서버). 둘 다 지금 일정에는 권하지 않는다.

---

## 1. 전체 구조 — 무엇이 무엇과 연결되는가

```
[브라우저 — React 소셜 월드]
    │
    ├── ① 로그인 / 프로필 / 미션 / 동아리  ──────►  [Supabase]
    │        @supabase/supabase-js 라이브러리로 직접 통신        ├─ Auth (카카오 로그인)
    │                                                           └─ PostgreSQL (테이블들)
    │                                                                  ▲
    └── ② NPC 대화 (LLM 호출)  ──►  [우리 백엔드 서버] ─────────────────┘
                                     Node.js — LLM API 키 보관,
                                     대화 → 익명 지표 변환 후 적재
```

여기서 **꼭 이해해야 할 두 가지**가 있다.

**(가) 로그인·프로필·미션은 백엔드 서버 없이도 된다.**
React에서 Supabase로 바로 요청을 보낸다. 서버를 따로 안 만들어도 되니 그만큼 빠르다.

**(나) NPC 대화만은 반드시 백엔드를 거쳐야 한다.**
LLM API 키를 브라우저 코드에 넣으면 누구나 개발자도구로 꺼내 쓸 수 있다. 요금이 우리한테 청구된다.
또 대화 내용을 **개인 식별정보 제거 후 지표로 변환**하는 처리(기능정의서 F-32)도 서버에서 해야 한다.

즉 "Supabase를 쓰면 백엔드가 아예 필요 없다"는 아니다. **백엔드는 NPC 전용으로 최소한만 만든다.**

---

## 2. 준비물 체크리스트

시작 전에 아래를 확인한다. 전부 무료다.

| 항목 | 확인 방법 | 없으면 |
|---|---|---|
| Node.js | PowerShell에서 `node -v` 입력 → `v20.x` 등이 나오면 OK | [nodejs.org](https://nodejs.org)에서 LTS 버전 설치 후 PowerShell 재시작 |
| 코드 에디터 | VS Code 실행되는지 | code.visualstudio.com에서 설치 |
| 카카오 계정 | — | 개발자 등록은 3장에서 |
| Supabase 계정 | — | GitHub 계정으로 바로 가입 가능 |
| React 프로젝트 | 팀 저장소에 이미 있으면 그것 사용 | `npm create vite@latest socialworld -- --template react` |

> Windows PowerShell에서 `npm`이 "스크립트 실행이 사용되지 않습니다" 오류를 내면
> `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` 를 한 번 실행한다.

---

## 3. Supabase 프로젝트 만들기 (10분)

1. [supabase.com](https://supabase.com) 접속 → **Start your project** → GitHub 계정으로 로그인
2. **New project** 클릭 후 입력
   - Name: `socialworld` (아무거나)
   - Database Password: **자동 생성 버튼을 누르고 반드시 따로 저장**한다. 나중에 다시 못 본다.
   - Region: **Northeast Asia (Seoul)** — 한국 사용자 기준 응답이 가장 빠르다
3. 생성까지 1~2분 대기

### 3-1. 열쇠 3개가 어디 있는지 (중요)

프로젝트 생성 후 **Project Settings → API** 화면에서 세 가지를 확인한다. 이 셋의 차이를 모르면 보안 사고가 난다.

| 값 | 어디에 쓰나 | 공개해도 되나 |
|---|---|---|
| **Project URL** (`https://xxxx.supabase.co`) | 프론트·백엔드 모두 | 공개 OK |
| **anon key** (public) | 브라우저(React) | 공개 OK — 단 RLS가 켜져 있어야 안전 |
| **service_role key** (secret) | **백엔드 서버에서만** | **절대 금지** — 모든 RLS를 무시하고 전체 DB를 읽고 쓸 수 있다 |

**service_role key를 React 코드나 깃허브에 올리면 DB 전체가 털린다.** 이 문장만 기억하면 된다.

---

## 4. 테이블 만들기 (SQL 복사·붙여넣기)

Supabase 대시보드 왼쪽 **SQL Editor** → **New query**에 아래를 붙여넣고 **Run**을 누르면 테이블이 한 번에 만들어진다.

> 아래 4-1~4-5를 하나로 모은 실행 파일이 `database/01_socialworld_base.sql`이다(시연용 미션 4개 포함). 파일 하나만 붙여넣으면 된다.
> 단 4-4의 `npc_chat_metrics`는 그 파일에 없고 `02_loop_schema.sql`이 만든다(13장).
한 줄씩 이해하지 못해도 괜찮다. 주석(`--`)으로 각 칸이 무엇인지 적어 두었다.

### 4-1. 프로필 테이블 (SW-02 온보딩이 저장되는 곳)

```sql
-- 로그인한 사용자의 온보딩 정보. auth.users(Supabase가 자동 관리하는 계정표)와 1:1로 연결된다.
create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  nickname    text not null,                     -- 표시 닉네임
  sgg_code    text not null,                     -- 거주 시군구 코드 (예: 11680 강남구, 51110 춘천시)
  age_group   text,                              -- '20대' | '30대' 등
  gender      text,                              -- 'M' | 'F' | null
  created_at  timestamptz not null default now(),
  onboarded_at timestamptz                       -- 온보딩 완료 시각. null이면 아직 미완료
);
```

> **왜 auth.users를 그냥 안 쓰고 profiles를 따로 만드나?**
> `auth.users`는 Supabase가 관리하는 계정 테이블이라 우리가 컬럼을 마음대로 추가할 수 없다.
> 그래서 같은 id를 기본키로 쓰는 `profiles`를 따로 두고, 우리 서비스 정보(거주지·닉네임 등)는 여기에 담는다.
> **`sgg_code`·`age_group`·`gender` 세 칸이 위험 탐지 에이전트의 코호트 키**(지역×연령대×성별)가 된다.

### 4-2. 미션 테이블 (SW-06 미션방)

```sql
create table public.missions (
  id           bigint generated always as identity primary key,
  title        text not null,
  description  text,
  reward_point int  not null default 0,
  due_date     date,
  is_active    boolean not null default true
);

create table public.mission_progress (
  id           bigint generated always as identity primary key,
  user_id      uuid   not null references auth.users(id) on delete cascade,
  mission_id   bigint not null references public.missions(id) on delete cascade,
  status       text   not null default 'in_progress',   -- in_progress | done
  completed_at timestamptz,
  unique (user_id, mission_id)                          -- 같은 미션을 두 번 담지 못하게
);
```

### 4-3. 동아리 테이블 (SW-07, 확장 범위지만 미리 잡아둠)

```sql
create table public.clubs (
  id          bigint generated always as identity primary key,
  name        text not null,
  category    text,                                     -- 문화 | 공연 | 체육 ...
  description text,
  owner_id    uuid not null references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now()
);

create table public.club_members (
  club_id   bigint not null references public.clubs(id) on delete cascade,
  user_id   uuid   not null references auth.users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (club_id, user_id)
);
```

### 4-4. NPC 대화 지표 테이블 — 개인정보가 들어가지 않는 표

```sql
-- 위험 탐지 에이전트로 넘어가는 미시 신호. 개인 식별자(user_id)를 의도적으로 넣지 않는다.
create table public.npc_chat_metrics (
  id                 bigint generated always as identity primary key,
  measured_on        date not null,      -- 집계 날짜
  sgg_code           text not null,      -- 코호트: 지역
  age_group          text not null,      -- 코호트: 연령대
  gender             text,               -- 코호트: 성별
  npc_type           text not null,      -- policy | job | psych | civil
  session_count      int  not null default 0,
  risk_keyword_count int  not null default 0,   -- 위험 키워드 빈출도
  severity_score     numeric(4,2)                -- LLM 심각도 판정 평균
);
```

이 표에 **user_id가 없다는 점이 설계의 핵심**이다. 기능 정의서 F-32·F-44와 개인정보 방침(서비스 기획서 9-3)이 여기서 실제 스키마로 구현된다.
원문 대화를 보관할지, 보관한다면 얼마나 둘지는 아직 정해지지 않았다(12장 Open Item).

### 4-5. RLS 켜기 — 이걸 안 하면 남의 데이터가 다 보인다

anon key는 브라우저에 노출되는 값이다. 그래서 Supabase는 **"테이블마다 누가 무엇을 할 수 있는지"를 규칙으로 정하라**고 요구한다. 이게 RLS(Row Level Security)다.

**RLS를 켜지 않으면** → 누구나 남의 프로필을 전부 읽을 수 있다.
**RLS를 켜고 정책을 안 만들면** → 아무도(우리 앱도) 못 읽는다. "왜 데이터가 안 나오지?"의 90%가 이것이다.

아래를 그대로 실행한다.

```sql
-- 1) 모든 테이블에 RLS 켜기
alter table public.profiles         enable row level security;
alter table public.missions         enable row level security;
alter table public.mission_progress enable row level security;
alter table public.clubs            enable row level security;
alter table public.club_members     enable row level security;
alter table public.npc_chat_metrics enable row level security;

-- 2) 프로필: 본인 것만 읽고 쓰기
create policy "본인 프로필 조회" on public.profiles
  for select using (auth.uid() = id);
create policy "본인 프로필 생성" on public.profiles
  for insert with check (auth.uid() = id);
create policy "본인 프로필 수정" on public.profiles
  for update using (auth.uid() = id);

-- 3) 미션 목록: 로그인한 사람은 누구나 읽기 가능(쓰기는 불가)
create policy "미션 목록 조회" on public.missions
  for select to authenticated using (true);

-- 4) 미션 진행상태: 본인 것만
create policy "본인 미션기록 조회" on public.mission_progress
  for select using (auth.uid() = user_id);
create policy "본인 미션기록 생성" on public.mission_progress
  for insert with check (auth.uid() = user_id);
create policy "본인 미션기록 수정" on public.mission_progress
  for update using (auth.uid() = user_id);

-- 5) 동아리: 목록은 모두 조회, 개설은 본인 명의로만
create policy "동아리 목록 조회" on public.clubs
  for select to authenticated using (true);
create policy "동아리 개설" on public.clubs
  for insert with check (auth.uid() = owner_id);
create policy "동아리 멤버 조회" on public.club_members
  for select to authenticated using (true);
create policy "동아리 가입" on public.club_members
  for insert with check (auth.uid() = user_id);

-- 6) npc_chat_metrics 는 정책을 만들지 않는다.
--    → 브라우저에서는 조회·쓰기 모두 차단되고, service_role key를 쓰는 백엔드만 접근할 수 있다.
--      (service_role은 RLS를 우회한다)
```

`auth.uid()`는 "지금 로그인한 사용자의 id"를 뜻하는 Supabase 내장 함수다.
`auth.uid() = id`는 곧 **"자기 행일 때만 허용"**이라는 뜻이다.

확인 방법: **Table Editor**에서 각 테이블 이름 옆에 자물쇠 표시가 보이면 RLS가 켜진 것이다.

---

## 5. 카카오 로그인 연결 (25분)

여기가 SW-01 로그인 화면의 실제 구현이다. **카카오 개발자 콘솔 → Supabase 대시보드** 순서로 진행한다.

### 5-1. 카카오 개발자 콘솔

1. [developers.kakao.com](https://developers.kakao.com) 로그인 → **내 애플리케이션** → **애플리케이션 추가하기**
   - 앱 이름, 사업자명(개인이면 팀명), 카테고리 입력
2. **앱 설정 → 앱 키**에서 **REST API 키**를 복사해 둔다 → 이게 `client_id`다
3. 같은 화면에서 **Redirect URI**에 아래 주소를 정확히 입력한다

   ```
   https://<프로젝트참조값>.supabase.co/auth/v1/callback
   ```

   `<프로젝트참조값>`은 Supabase의 Project URL에 들어 있는 문자열이다.
   예: Project URL이 `https://abcdefgh.supabase.co`면 → `https://abcdefgh.supabase.co/auth/v1/callback`
   (로컬 개발 서버까지 쓸 경우 `http://localhost:54321/auth/v1/callback`도 함께 등록)

   > **오타 하나만 있어도 로그인이 실패한다.** 복사·붙여넣기를 권한다.

4. **앱 설정 → 앱 키**에서 **보안 → Client Secret**을 **생성하고 "사용함"으로 활성화**한 뒤 값을 복사
5. **제품 설정 → 카카오 로그인** → 활성화 상태를 **ON**
6. **제품 설정 → 카카오 로그인 → 동의항목**에서 아래를 설정
   - `profile_nickname` (닉네임) — 필수
   - `profile_image` (프로필 사진) — 필수
   - `account_email` (이메일) — 선택. 받지 않아도 되고, 개인정보 최소수집 원칙(기획서 9-3)상 **받지 않는 쪽을 권한다**

### 5-2. Supabase 대시보드

1. **Authentication → Sign In / Providers**에서 **Kakao**를 찾아 펼치고 **Enable**
2. 4-2에서 복사한 **REST API 키**를 `Kakao Client ID`에, **Client Secret**을 `Kakao Client Secret`에 입력
3. 이메일 동의항목을 받지 않기로 했다면 **"Allow users without an email"**(이메일 없는 사용자 허용)을 **켠다**
   - 이걸 안 켜면 이메일 미동의 사용자의 로그인이 실패한다
4. 저장

여기까지 하면 **서버 쪽 로그인 준비가 끝난다.** 아직 화면은 없다. 다음 장에서 붙인다.

---

## 6. 네이버 로그인은 왜 바로 안 되는가

기획서에는 "카카오·네이버 간편 로그인"으로 적어 두었지만, 실제 확인 결과 **Supabase는 카카오는 공식 지원하지만 네이버는 기본 제공 목록에 없다.**
(공식 문서의 제공자 목록: Apple, Azure, Bitbucket, Discord, Facebook, Figma, GitHub, GitLab, Google, **Kakao**, Keycloak, LinkedIn, Notion, Slack, Spotify, Twitter, Twitch, WorkOS, Zoom — 네이버 추가 요청은 논의만 열려 있는 상태)

선택지는 셋이다.

| 방안 | 작업량 | 설명 |
|---|---|---|
| **A. 프로토타입은 카카오만** (권장) | 0일 | 대회 시연에는 로그인 1종으로 충분하다. 화면에는 카카오 버튼만 노출하고, 기획서에는 "네이버는 확장 범위"로 명시 |
| B. Custom OAuth/OIDC로 네이버 추가 | 1~2일 | Supabase가 제공하는 커스텀 제공자 기능으로 네이버를 붙인다. 설정 항목이 많아 디버깅 시간이 든다 |
| C. 백엔드에서 네이버 OAuth 직접 처리 | 2~3일 | 우리 서버가 네이버 인증을 받고 Supabase에 계정을 만들어 주는 방식. 가장 자유롭지만 가장 오래 걸린다 |

**남은 일정(약 20일)과 소셜 월드가 MVP에서 해야 할 일의 양을 보면 A안을 권한다.**
결정되면 화면 기획서 SW-01의 버튼 구성과 기능 정의서 F-46 설명을 한 줄씩만 수정하면 된다.

---

## 7. React에서 연결하기 (코드)

### 7-1. 라이브러리 설치

프로젝트 폴더에서:

```bash
npm install @supabase/supabase-js
```

### 7-2. 비밀값을 .env 파일로 분리

프로젝트 최상단(package.json과 같은 위치)에 **`.env`** 파일을 만든다.

```
VITE_SUPABASE_URL=https://abcdefgh.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6...
```

- Vite에서는 **`VITE_` 접두사가 붙은 변수만** 코드에서 읽힌다. 빼먹으면 `undefined`가 된다.
- **`.env`를 수정하면 개발 서버(`npm run dev`)를 껐다 켜야** 반영된다.
- `.gitignore`에 `.env` 한 줄을 반드시 추가한다. 이미 저장소에 `.gitignore`가 있으니 거기에 적으면 된다.

### 7-3. 연결 파일 만들기 — `src/lib/supabase.js`

```js
import { createClient } from '@supabase/supabase-js'

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
)
```

이 파일이 **"DB 연결"의 실체**다. 앞으로 모든 화면은 이 `supabase` 하나를 가져다 쓴다.

### 7-4. SW-01 로그인 화면

```jsx
import { supabase } from '../lib/supabase'

export default function Login() {
  async function signInWithKakao() {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'kakao',
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    })
    if (error) alert('로그인에 실패했습니다. 잠시 후 다시 시도해 주세요.')
  }

  return (
    <div className="login">
      <h1>소셜 월드</h1>
      <button onClick={signInWithKakao}>카카오로 시작하기</button>
      <p className="terms">계속하면 이용약관과 개인정보처리방침에 동의하게 됩니다.</p>
    </div>
  )
}
```

버튼을 누르면 카카오 화면으로 이동했다가, 동의 후 다시 우리 사이트로 돌아온다.

### 7-5. 로그인 후 분기 — SW-02(온보딩)로 갈지 SW-03(광장)으로 갈지

화면 기획서의 "기존 계정이면 광장, 신규 계정이면 온보딩" 분기를 코드로 옮기면 이렇다.

```jsx
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

export default function AuthCallback() {
  const navigate = useNavigate()

  useEffect(() => {
    async function route() {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return navigate('/login')

      // 내 프로필이 있는지, 온보딩을 마쳤는지 확인
      const { data: profile } = await supabase
        .from('profiles')
        .select('onboarded_at')
        .eq('id', session.user.id)
        .maybeSingle()

      if (profile?.onboarded_at) navigate('/plaza')   // SW-03 광장
      else navigate('/onboarding')                     // SW-02 온보딩
    }
    route()
  }, [navigate])

  return <p>로그인 중입니다…</p>
}
```

`maybeSingle()`은 "행이 없어도 에러 내지 말고 null을 달라"는 뜻이다. 신규 사용자는 아직 프로필이 없으니 이게 맞다.

### 7-6. SW-02 온보딩 저장

```jsx
async function saveOnboarding({ nickname, sggCode, ageGroup, gender }) {
  const { data: { user } } = await supabase.auth.getUser()

  const { error } = await supabase.from('profiles').upsert({
    id: user.id,                 // auth.users의 id를 그대로 사용
    nickname,
    sgg_code: sggCode,           // 거주 시군구 — 위험도 산출의 필수 항목
    age_group: ageGroup,
    gender,
    onboarded_at: new Date().toISOString(),
  })

  if (error) { alert('저장에 실패했습니다.'); return false }
  return true
}
```

`upsert`는 "있으면 수정, 없으면 생성"이다. 온보딩을 중간에 멈췄다 다시 해도 안전하다.

### 7-7. 로그인 상태 유지와 로그아웃

Supabase는 로그인 정보를 브라우저에 자동 저장하므로, 새로고침해도 로그인이 풀리지 않는다.
앱 최상단에서 세션 변화를 구독해 두면 로그인/로그아웃에 화면이 자동으로 반응한다.

```jsx
useEffect(() => {
  const { data: { subscription } } = supabase.auth.onAuthStateChange(
    (_event, session) => setSession(session)
  )
  return () => subscription.unsubscribe()
}, [])

// 로그아웃
await supabase.auth.signOut()
```

---

## 8. 백엔드(NPC)에서 DB에 쓰기

NPC 대화는 1장에서 설명한 이유로 서버를 거친다. 서버에서는 **service_role key**를 쓴다.

```js
// server/supabaseAdmin.js  — 서버에서만 실행되는 파일
import { createClient } from '@supabase/supabase-js'

export const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,   // 절대 프론트로 넘기지 않는다
  { auth: { persistSession: false } }
)
```

서버용 `.env`는 프론트와 **별도 파일**로 둔다(`VITE_` 접두사를 붙이지 않는다).

```
SUPABASE_URL=https://abcdefgh.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOi...
ANTHROPIC_API_KEY=...
```

대화가 끝나면 **원문이 아니라 지표만** 적재한다(기능정의서 F-32).

```js
// 개인 식별자 없이 코호트 단위로만 기록
await supabaseAdmin.from('npc_chat_metrics').insert({
  measured_on: '2026-09-22',
  sgg_code: profile.sgg_code,
  age_group: profile.age_group,
  gender: profile.gender,
  npc_type: 'psych',
  session_count: 1,
  risk_keyword_count: 3,
  severity_score: 0.75,   // 0~1 척도 (02_loop_schema.sql과 같은 기준)
})
```

여기에 `user_id`를 넣고 싶은 유혹이 생기는데, **넣지 않는 것이 기획 의도**다.
넣는 순간 "개인 단위 심리상태 DB"가 되어 기획서 9-3의 개인정보 방침과 충돌한다.

> **현재 구현은 다른 길을 택했다(13장).** 대화 1건마다 서버가 코호트 행을 쓰면 세션 수·사람 수를 셀 수 없고 서버가 필요하다.
> 그래서 브라우저가 본인 행으로 `npc_sessions`에 신호만 저장하고, DB 함수 `aggregate_npc_sessions()`가 코호트×월로 묶어
> `npc_chat_metrics`에 쓴다. 결과 표에 user_id가 없다는 원칙은 같다.

---

## 9. 단계별 동작 확인 체크리스트

막히면 어디까지 됐는지부터 확인한다.

| # | 확인 항목 | 성공 판정 |
|---|---|---|
| 1 | Supabase 프로젝트 생성 | 대시보드에 Project URL이 보인다 |
| 2 | 테이블 생성 | Table Editor에 profiles 등 6개 테이블이 보인다 |
| 3 | RLS 적용 | 테이블 이름 옆에 자물쇠 표시가 있다 |
| 4 | 카카오 앱 설정 | Redirect URI가 Supabase 콜백 주소와 글자까지 동일하다 |
| 5 | Supabase Kakao 활성화 | Providers 목록에서 Kakao가 Enabled로 표시된다 |
| 6 | 프론트 연결 | 브라우저 콘솔에 `supabase` 관련 오류가 없다 |
| 7 | 로그인 성공 | **Authentication → Users**에 방금 로그인한 계정이 한 줄 생긴다 ← 가장 확실한 신호 |
| 8 | 온보딩 저장 | **Table Editor → profiles**에 행이 한 줄 생긴다 |
| 9 | 분기 동작 | 로그아웃 후 재로그인 시 온보딩을 건너뛰고 광장으로 간다 |

7번과 8번이 **"DB 연결에 성공했다"의 실제 증거**다. 여기까지 오면 나머지 기능은 같은 패턴의 반복이다.

---

## 10. 자주 나는 오류와 해결

| 증상 | 원인 | 해결 |
|---|---|---|
| 카카오 로그인 후 `redirect_uri_mismatch` / KOE006 | 카카오에 등록한 Redirect URI와 실제 호출 주소가 다름 | 5-1의 3번을 복사·붙여넣기로 다시 등록. `http`/`https`, 끝의 `/` 유무까지 일치해야 한다 |
| 조회 결과가 **빈 배열**인데 에러는 없음 | RLS select 정책이 없음 | 4-5의 정책 SQL을 실행했는지 확인. **에러가 아니라 빈 값으로 나오기 때문에 가장 헷갈린다** |
| `new row violates row-level security policy` | insert 정책이 없거나 조건 불일치 | `with check (auth.uid() = id)` 조건과 실제 저장하는 id가 같은지 확인 |
| `import.meta.env.VITE_...` 가 undefined | 접두사 누락 또는 서버 미재시작 | 변수명에 `VITE_` 확인 → `npm run dev` 재시작 |
| 로그인은 되는데 profiles에 행이 안 생김 | 온보딩 저장 코드가 호출되지 않음 | 7-6의 `saveOnboarding` 반환값과 콘솔 오류 확인 |
| 이메일 미동의 사용자 로그인 실패 | "Allow users without an email" 꺼짐 | 5-2의 3번 토글 켜기 |
| 로컬에서 CORS 오류 | 잘못된 URL(오타, `http` 누락) | Project URL을 대시보드에서 다시 복사 |

---

## 11. 보안·개인정보 체크리스트 (제출 전 반드시 확인)

- [ ] `service_role key`가 프론트엔드 코드·깃허브 어디에도 없다
- [ ] `.gitignore`에 `.env`가 포함되어 있다 (이미 커밋했다면 키를 **재발급**해야 한다)
- [ ] 모든 테이블에 RLS가 켜져 있다
- [ ] `npc_chat_metrics`에 `user_id`가 없다 (코호트 단위 집계만)
- [ ] 카카오 동의항목이 최소 수집 범위다 (닉네임·프로필사진, 이메일은 선택)
- [ ] 심리상담 NPC 화면에 "상담사가 아닌 연결 도구"라는 고지가 있다 (기능정의서 F-45)

---

## 12. 팀이 정해야 할 것 (Open Items)

- [ ] **네이버 로그인**: 6장 A/B/C안 중 선택 → 확정되면 화면 기획서 SW-01과 기능 정의서 F-46 수정
- [ ] **대화 원문 보관 여부와 기간**: 보관한다면 별도 테이블 + 접근 권한 + 삭제 주기 정의 필요
- [ ] **k-익명성 기준값**: `npc_chat_metrics`를 대시보드에 노출할 최소 세션 수(예: 5건 미만 코호트는 미노출)
  — 현재 구현은 5(`risk_agent/config.py`). 세션 수 대신 사람 수(`user_count`)로 볼지 결정 필요
- [ ] **시군구 코드 체계**: 행정표준코드(강남구 11680 / 춘천시 51110) 사용 여부 — 통신·카드 데이터의 지역 키와 맞춰야 결합이 된다
- [ ] **배포 방식**: 프론트는 Vercel, 백엔드는 Render/Railway 등 — 결정 시 Redirect URI를 배포 주소로 추가 등록해야 함
- [ ] **무료 플랜 한도**: Supabase 무료 플랜은 일정 기간 미사용 시 프로젝트가 일시 정지될 수 있으므로, 심사·시연 직전에 반드시 접속 확인

## 13. 위험 탐지 에이전트와 순환 연결하기 (2026-09-23)

소셜 월드에서 나온 대화 신호가 위험 탐지 에이전트로 들어가고, 에이전트의 판단이 다시 소셜 월드 추천으로 돌아오게 한다.
구조와 테이블은 `DB_테이블_정의서.md` 11장, 시연 순서는 `risk_agent/README.md` "전체 순환"에 있다.

### 13-1. 키가 두 종류다

| 키 | 어디에 | 할 수 있는 일 |
|---|---|---|
| publishable (`sb_publishable_…`) | 브라우저 — `social_world/socialworld-demo.html`, React `.env` | RLS가 허락한 것만 (본인 프로필·본인 대화 세션·본인 코호트 환류 읽기) |
| secret (`sb_secret_…`) | `risk_agent/.env`의 `SUPABASE_SECRET_KEY` | RLS 우회. 집계 함수 호출, 코호트 집계 읽기, 환류 쓰기 |

secret 키는 Project Settings → API Keys → Secret keys에서 만든다. **절대 커밋·공유하지 않는다.**
옛 방식의 `service_role` JWT(`eyJ…`)도 동작한다(`supabase_sync.py`가 알아서 헤더를 맞춘다).

### 13-2. 순서

1. SQL Editor에서 `database/02_loop_schema.sql` Run — 테이블 4개(npc_sessions·npc_chat_metrics·escalations·cohort_feedback)·함수 2개·미션 2개
2. Authentication → Sign In / Providers → **Anonymous Sign-Ins** 켜기 (데모의 게스트 입장)
3. `risk_agent/.env.example` → `.env` 복사 후 `SUPABASE_URL`, `SUPABASE_SECRET_KEY` 채우기
4. 확인
   ```bash
   cd risk_agent
   python supabase_sync.py check     # 테이블 4개 ✓
   python supabase_sync.py seed      # 시연용 합성 배경(청년 8개 코호트 × 최근 6개월, source='synthetic')
   python supabase_sync.py status    # 실제(live)·합성 건수
   ```
5. 소셜 월드 데모에서 대화 → `python run_pipeline.py --youth --supabase` → 데모 새로고침하면 추천 말풍선

### 13-3. 동작 확인 체크리스트

- [ ] 데모에서 NPC와 대화 후 Table Editor → `npc_sessions`에 행이 생김 (본인 계정으로 로그인한 상태여야 함)
- [ ] 브라우저 콘솔에서 `npc_chat_metrics`를 조회하면 **빈 결과** (RLS 정책 없음 = 차단이 정상)
- [ ] `run_pipeline.py --youth --supabase` 출력에 "실제 대화 N건"이 표시됨
- [ ] `cohort_feedback`에 코호트별 행이 생기고, 데모에서 **내 코호트 행만** 보임
- [ ] 위기 선택지 → 109 안내가 뜨고 `escalations`에 user_id 없이 1행

### 13-4. 자주 나는 오류

| 증상 | 원인 → 해결 |
|---|---|
| `check`에서 테이블 없음 | 02_loop_schema.sql 미실행 → 1단계 |
| `sb_publishable_` 키라서 거부 | `.env`에 브라우저 키를 넣음 → secret 키로 교체 |
| 게스트 입장 실패 | Anonymous Sign-Ins 꺼짐 → 2단계 |
| 대화했는데 에이전트가 0건으로 봄 | 온보딩에서 연령대가 비었거나 다른 코호트로 저장됨 → `profiles` 확인. 성별이 비면 'U' 코호트로 따로 집계됨 |
| 추천 말풍선이 안 뜸 | 에이전트를 `--supabase`로 다시 돌려야 환류가 갱신됨 / 성별 미입력 |

---

## 참고

- Supabase 카카오 로그인 공식 문서: https://supabase.com/docs/guides/auth/social-login/auth-kakao
- Supabase 소셜 로그인 제공자 목록: https://supabase.com/docs/guides/auth/social-login
- 관련 문서: 「기능 정의서 v2.1」 3-7절, 「화면 기획서 v2.1」 SW-01·SW-02, 「서비스 기획서 v2.0」 5-5·9-3

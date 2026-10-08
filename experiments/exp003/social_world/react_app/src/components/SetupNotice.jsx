// Supabase 키가 .env에 아직 없을 때 보여주는 안내 화면.
// DB_연결_단계별_실행가이드.md 3장(프로젝트 생성)·7-2절(.env 설정) 참고.
export default function SetupNotice() {
  return (
    <div className="setup-notice">
      <div className="setup-card">
        <h1>🌱 소셜 월드 설정이 필요해요</h1>
        <p>
          아직 Supabase 프로젝트 키가 연결되지 않았어요. 아래 순서대로 진행하면
          바로 실제 데이터로 동작합니다.
        </p>
        <p><a href="/preview">픽셀 캐릭터와 대화 화면 먼저 살펴보기</a> — 저장 기능은 꺼져 있습니다.</p>
        <ol>
          <li>
            <strong>Supabase 프로젝트 생성</strong> — supabase.com에서 새
            프로젝트를 만듭니다 (Region: Northeast Asia, Seoul 권장).
          </li>
          <li>
            <strong>스키마 실행</strong> — <code>database/01_socialworld_base.sql</code>{' '}
            내용을 SQL Editor에 붙여넣고 Run. 이어서 <code>database/02_loop_schema.sql</code>도
            실행해야 NPC 대화 저장과 추천 조회가 동작합니다.
          </li>
          <li>
            <strong>.env 작성</strong> — 프로젝트 루트에{' '}
            <code>.env.example</code>을 복사해 <code>.env</code>로 저장하고,
            Project Settings → API에서 Project URL과 anon key를 채워넣습니다.
          </li>
          <li>
            <strong>개발 서버 재시작</strong> — <code>npm run dev</code>를 껐다
            다시 켭니다.
          </li>
        </ol>
        <p className="setup-hint">
          자세한 절차는 프로젝트 문서 <code>DB_연결_단계별_실행가이드.md</code>{' '}
          3~4장을 참고하세요. 카카오 로그인(5장)은 나중에 붙여도 됩니다 —
          Supabase Authentication에서 “Anonymous Sign-Ins”를 켜면 게스트
          로그인으로도 이 프로토타입을 바로 체험할 수 있어요.
        </p>
      </div>
    </div>
  )
}

// 광장 NPC 3종 — 스크립트 목업 대화
// 통합기획서 7-1 (광장 NPC 3종 상주) / DB_연결_단계별_실행가이드.md 1장
// "NPC 대화만은 반드시 백엔드를 거쳐야 한다" 원칙에 따라, 실제 LLM 연동 전
// 이 프로토타입 단계에서는 분기형 스크립트로만 동작한다. 백엔드·API 키 불필요.

export const NPCS = [
  {
    id: 'policy',
    name: '정책추천 NPC',
    emoji: '📋',
    color: '#5b8def',
    greeting: '안녕하세요! 어떤 정책 정보가 필요하신가요?',
    disclaimer: null,
    tree: {
      root: {
        text: '안녕하세요! 저는 정책추천 도우미예요. 무엇을 도와드릴까요?',
        options: [
          { label: '청년 주거 지원 정책이 궁금해요', next: 'housing' },
          { label: '생활비 지원 제도를 알고 싶어요', next: 'living' },
          { label: '그냥 둘러볼게요', next: 'bye' },
        ],
      },
      housing: {
        text: '청년 월세 지원, 전세보증금 대출이자 지원 같은 제도가 있어요. 거주 지역 기준으로 더 정확히 안내해 드릴 수 있어요 (실제 서비스에서는 복지자원 DB와 연동됩니다).',
        options: [
          { label: '다른 것도 궁금해요', next: 'root' },
          { label: '고마워요', next: 'bye' },
        ],
      },
      living: {
        text: '청년 생활안정자금, 자립수당 등이 대표적이에요. 자격 요건은 소득·나이 기준에 따라 달라져요.',
        options: [
          { label: '다른 것도 궁금해요', next: 'root' },
          { label: '고마워요', next: 'bye' },
        ],
      },
      bye: { text: '언제든 다시 찾아주세요! 👋', options: [] },
    },
  },
  {
    id: 'job',
    name: '취업상담 NPC',
    emoji: '💼',
    color: '#2fa86b',
    greeting: '취업 준비, 함께 이야기해 볼까요?',
    disclaimer: null,
    tree: {
      root: {
        text: '어떤 취업 준비 단계에 계신가요?',
        options: [
          { label: '이제 막 구직을 시작했어요', next: 'start' },
          { label: '면접까지 왔는데 막막해요', next: 'interview' },
          { label: '그냥 둘러볼게요', next: 'bye' },
        ],
      },
      start: {
        text: '좋아요, 시작이 반이에요. 관심 직무 분야를 정하고 청년 취업지원 프로그램부터 알아보는 걸 추천해요.',
        options: [
          { label: '다른 것도 궁금해요', next: 'root' },
          { label: '고마워요', next: 'bye' },
        ],
      },
      interview: {
        text: '면접 전 모의면접 프로그램이나 취업 상담 센터를 연계해 드릴 수 있어요 (실제 서비스에서는 복지자원 DB와 연동됩니다).',
        options: [
          { label: '다른 것도 궁금해요', next: 'root' },
          { label: '고마워요', next: 'bye' },
        ],
      },
      bye: { text: '응원할게요, 다음에 또 봐요! 💪', options: [] },
    },
  },
  {
    id: 'psych',
    name: '심리상담 NPC',
    emoji: '🌱',
    color: '#c97ad1',
    greeting: '오늘 하루는 어떠셨어요?',
    disclaimer: '이 NPC는 전문 상담사가 아니라, 필요할 때 도움으로 연결해 주는 도구입니다.',
    tree: {
      root: {
        text: '오늘 기분이 어떠세요? 편하게 이야기해도 괜찮아요.',
        options: [
          { label: '요즘 좀 지치고 힘들어요', next: 'tired' },
          { label: '그냥저냥 괜찮아요', next: 'okay' },
          { label: '그냥 둘러볼게요', next: 'bye' },
        ],
      },
      tired: {
        text: '많이 힘드셨겠어요. 혼자 견디지 않으셨으면 좋겠어요. 원하시면 지역 심리지원센터나 상담 서비스를 연결해 드릴 수 있어요.',
        options: [
          { label: '조금 더 이야기하고 싶어요', next: 'root' },
          { label: '괜찮아요, 고마워요', next: 'bye' },
        ],
      },
      okay: {
        text: '다행이에요. 언제든 마음이 힘들 때 여기로 와주세요.',
        options: [
          { label: '다른 것도 궁금해요', next: 'root' },
          { label: '고마워요', next: 'bye' },
        ],
      },
      bye: { text: '오늘도 수고 많으셨어요. 또 만나요. 🌱', options: [] },
    },
  },
]

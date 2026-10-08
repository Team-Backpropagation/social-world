// EXP-003 mock boundary. A future Agent API can replace this function while
// Showcase keeps the same choice -> message -> suggested mission contract.
export function mockAgentResponse(choice) {
  switch (choice) {
    case 'rest':
      return {
        message: '쉬어 가도 괜찮아요. 여기서 잠깐 머물러도 좋아요. 나가고 싶은 마음이 생기면 아주 짧은 산책부터 시작해요.',
        mission: null,
      }
    case 'talk':
      return {
        message: '누군가와 이야기하고 싶군요. 동네에는 가볍게 인사할 수 있는 공간이 있어요. 오늘은 공원에 나가 보는 작은 목표부터 어떨까요?',
        mission: null,
      }
    case 'walk':
      return {
        message: '좋아요. 오늘은 공원까지 가보는 것만으로 충분해요. 준비되면 문을 통해 동네로 나가요.',
        mission: { id: 'park_walk', title: '공원까지 산책하기', reward: '작은 화분' },
      }
    default:
      return { message: '원하는 속도로 함께해요.', mission: null }
  }
}

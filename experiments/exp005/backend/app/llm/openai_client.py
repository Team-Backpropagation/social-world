"""외부 API 호출 경계입니다. 키는 서버 안에만 있고 실제 호출은 live+사용자 동의 때만 합니다."""

import json

from openai import AsyncOpenAI

from app.agent.prompts import SAFETY_PROMPT, companion_prompt
from app.agent.rules import local_safety
from app.schemas import ReplyProposal, SafetyAssessment


class DemoClient:
    """실제로 쓰는 두 번째 구현: 네트워크 없이 재현 가능한 흐름 검증용 대역입니다."""

    async def assess(self, text: str, context: dict) -> SafetyAssessment:
        return local_safety(text)

    async def propose(self, text: str, context: dict, npc: str) -> ReplyProposal:
        replies = {
            "lumi": "말씀해 주신 내용을 바탕으로 편한 도움부터 함께 골라볼게요.",
            "coco": "부담이 적은 선택부터 살펴볼게요. 참여 여부는 편하게 정하셔도 돼요.",
            "haru": "찾으려는 도움을 함께 정리해 볼게요. 확인된 정보의 범위를 구분해 안내할게요.",
        }
        return ReplyProposal(intent="companion", reflection=replies[npc], evidence_quote=text[:40], safety_concern=False)


class OpenAIClient:
    def __init__(self, api_key: str, model: str, timeout: float):
        # 생성과 연결은 app/main.py에서 담당합니다. 테스트는 이 클래스 대신 대역을 주입합니다.
        self.client = AsyncOpenAI(api_key=api_key, timeout=timeout, max_retries=0)
        self.model = model

    async def _parse(self, schema: type, prompt: str, data: dict):
        response = await self.client.responses.parse(
            model=self.model,
            input=[{"role": "system", "content": prompt},
                   {"role": "user", "content": json.dumps(data, ensure_ascii=False)}],
            text_format=schema, store=False, max_output_tokens=700,
        )
        # 구조화 출력도 거부·미완료일 수 있습니다. 이 경우 일반 추천으로 넘기지 않습니다.
        if response.status != "completed" or response.output_parsed is None:
            raise ValueError("model_output_unavailable")
        return response.output_parsed

    async def assess(self, text: str, context: dict) -> SafetyAssessment:
        return await self._parse(SafetyAssessment, SAFETY_PROMPT, {"message": text, "context": context})

    async def propose(self, text: str, context: dict, npc: str) -> ReplyProposal:
        return await self._parse(ReplyProposal, companion_prompt(npc), {"message": text, "context": context})

    async def close(self):
        await self.client.close()

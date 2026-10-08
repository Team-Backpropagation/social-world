import { useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import PixelCharacter from './PixelCharacter'

// 광장 NPC 3종의 분기형 스크립트 대화창 (목업 — 백엔드 호출 없음)
export default function NpcDialogModal({ npc, onClose, preview = false }) {
  const [nodeId, setNodeId] = useState('root')
  // REVIEW FIX: 대화 중 누적되는 값은 화면 상태가 아니므로 ref로 관리한다.
  // 선택할 때마다 재렌더링하지 않고, 종료 시점에 한 번만 익명 신호로 저장한다.
  const sessionRef = useRef({
    startedAt: new Date().toISOString(),
    tags: new Set(),
    maxSeverity: 0,
    selected: false,
    crisisReported: false,
  })
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(null)
  const node = npc.tree[nodeId]

  async function selectOption(option) {
    const session = sessionRef.current
    // REVIEW FIX: 원문은 저장하지 않고, 대본 선택지에 미리 정의된 신호만 누적한다.
    // 실제 자유대화/LLM 도입 시에는 서버에서 같은 검증을 수행해야 한다.
    if (option.signal) {
      session.selected = true
      for (const tag of option.signal.tags ?? []) session.tags.add(tag)
      session.maxSeverity = Math.max(session.maxSeverity, option.signal.severity ?? 0)

      if (option.signal.crisis && !session.crisisReported && !preview) {
        session.crisisReported = true
        const { error } = await supabase.rpc('report_crisis', { p_npc_type: npc.id })
        if (error) setSaveError('위기 안내 기록에 실패했습니다. 안내 번호로 직접 연락해 주세요.')
      }
    }
    setNodeId(option.next)
  }

  async function closeDialog() {
    const session = sessionRef.current
    // EXP-001 미리보기는 화면 확인 전용이다. 테스트 DB 연결 전에는 신호를 저장하지 않는다.
    if (preview) {
      onClose()
      return
    }
    if (!session.selected || saving) {
      onClose()
      return
    }

    setSaving(true)
    const { error } = await supabase.from('npc_sessions').insert({
      npc_type: npc.id,
      started_at: session.startedAt,
      ended_at: new Date().toISOString(),
      risk_keyword_count: session.tags.size,
      severity_score: Math.round(session.maxSeverity * 100) / 100,
      keyword_tags: [...session.tags],
    })
    setSaving(false)

    if (error) {
      setSaveError('대화 신호 저장에 실패했습니다. 다시 시도해 주세요.')
      return
    }
    onClose()
  }

  return (
    <div className="modal-backdrop" onClick={closeDialog}>
      <div
        className="npc-modal pixel-panel"
        onClick={(e) => e.stopPropagation()}
        style={{ borderColor: npc.color }}
      >
        <div className="npc-modal-header">
          <span className="npc-modal-portrait" style={{ background: npc.color }}>
            <PixelCharacter kind={npc.id} />
          </span>
          <div>
            <div className="npc-modal-name">{npc.name}</div>
            {npc.disclaimer && (
              <div className="npc-modal-disclaimer">{npc.disclaimer}</div>
            )}
          </div>
          <button className="btn-ghost npc-modal-close" onClick={closeDialog} disabled={saving}>
            ✕
          </button>
        </div>

        <p className="npc-modal-text">{node.text}</p>
        {preview && <p className="npc-modal-disclaimer">미리보기 대화입니다. 응답과 위험 신호는 저장되지 않습니다.</p>}
        {saveError && <p className="npc-modal-disclaimer">{saveError}</p>}

        <div className="npc-modal-options">
          {node.options.length > 0 ? (
            node.options.map((opt, i) => (
              <button
                key={i}
                className="btn btn-option"
                onClick={() => selectOption(opt)}
              >
                {opt.label}
              </button>
            ))
          ) : (
            <button className="btn btn-primary" onClick={closeDialog} disabled={saving}>
              {saving ? '저장 중…' : '대화 마치기'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

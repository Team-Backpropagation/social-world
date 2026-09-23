import { useState } from 'react'

// 광장 NPC 3종의 분기형 스크립트 대화창 (목업 — 백엔드 호출 없음)
export default function NpcDialogModal({ npc, onClose }) {
  const [nodeId, setNodeId] = useState('root')
  const node = npc.tree[nodeId]

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="npc-modal pixel-panel"
        onClick={(e) => e.stopPropagation()}
        style={{ borderColor: npc.color }}
      >
        <div className="npc-modal-header">
          <span className="npc-modal-emoji" style={{ background: npc.color }}>
            {npc.emoji}
          </span>
          <div>
            <div className="npc-modal-name">{npc.name}</div>
            {npc.disclaimer && (
              <div className="npc-modal-disclaimer">{npc.disclaimer}</div>
            )}
          </div>
          <button className="btn-ghost npc-modal-close" onClick={onClose}>
            ✕
          </button>
        </div>

        <p className="npc-modal-text">{node.text}</p>

        <div className="npc-modal-options">
          {node.options.length > 0 ? (
            node.options.map((opt, i) => (
              <button
                key={i}
                className="btn btn-option"
                onClick={() => setNodeId(opt.next)}
              >
                {opt.label}
              </button>
            ))
          ) : (
            <button className="btn btn-primary" onClick={onClose}>
              대화 마치기
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

/* 마을과 EXP-005 사이의 점검용 연결. 기존 NPC 대본이나 DB 코드는 덮어쓰지 않습니다. */
(function () {
  'use strict';
  var npcMap = { psych: 'lumi', coco: 'coco', haru: 'haru' };
  var overlay, frame, currentNpc = 'lumi';
  var style = document.createElement('style');
  style.textContent = '.exp005-backdrop{position:fixed;inset:0;background:#0007;z-index:10000;padding:18px;display:flex;flex-direction:column}.exp005-backdrop[hidden]{display:none}.exp005-toolbar{display:flex;align-items:center;justify-content:space-between;gap:8px;background:#edf1e7;padding:9px 14px;border-radius:12px 12px 0 0;color:#34433a;font:13px system-ui}.exp005-toolbar button,.exp005-launch button{padding:8px 12px;border-radius:9px;border:1px solid #becdbb;background:#fff;color:#34433a;cursor:pointer}.exp005-frame{border:0;width:100%;flex:1;min-height:0;background:#f5f3ee;border-radius:0 0 12px 12px}.exp005-launch{position:fixed;left:12px;bottom:12px;z-index:250;display:flex;gap:5px;flex-wrap:wrap;max-width:calc(100vw - 24px);padding:8px;background:#f5f3eef0;border-radius:12px;font:12px system-ui}.exp005-launch span{align-self:center}@media(max-width:540px){.exp005-backdrop{padding:0}.exp005-toolbar{border-radius:0;font-size:11px}.exp005-launch{bottom:70px}.exp005-toolbar button{padding:7px}}';
  document.head.appendChild(style);

  function selectNpc() {
    if (frame) frame.contentWindow.postMessage({ type: 'ieum:set-npc', npc: currentNpc }, location.origin);
  }
  function ensureFrame() {
    if (overlay) return;
    overlay = document.createElement('section');
    overlay.className = 'exp005-backdrop'; overlay.hidden = true;
    overlay.setAttribute('role', 'dialog'); overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'EXP-005 에이전트 대화 점검');
    var toolbar = document.createElement('div'); toolbar.className = 'exp005-toolbar';
    var note = document.createElement('span'); note.textContent = 'EXP-005 · 고정 응답 시연 · 돌아가도 세션 유지 / 삭제는 대화창에서';
    var close = document.createElement('button'); close.textContent = '마을로 돌아가기';
    close.addEventListener('click', function () { overlay.hidden = true; });
    toolbar.append(note, close);
    frame = document.createElement('iframe'); frame.className = 'exp005-frame';
    frame.title = 'EXP-005 상담·사전조사'; frame.src = '/agent/?npc=' + currentNpc;
    frame.addEventListener('load', selectNpc);
    overlay.append(toolbar, frame); document.body.appendChild(overlay);
  }
  window.Exp005World = {
    open: function (id) {
      if (!npcMap[id]) return false;
      currentNpc = npcMap[id]; ensureFrame(); overlay.hidden = false; selectNpc(); return true;
    }
  };
  window.addEventListener('message', function (event) {
    if (event.origin === location.origin && frame && event.source === frame.contentWindow && event.data?.type === 'ieum:ready') selectNpc();
  });
  var launcher = document.createElement('div'); launcher.className = 'exp005-launch';
  var label = document.createElement('span'); label.textContent = '에이전트 점검'; launcher.appendChild(label);
  [['psych', '루미'], ['coco', '코코'], ['haru', '하루']].forEach(function (entry) {
    var button = document.createElement('button'); button.textContent = entry[1];
    button.addEventListener('click', function () {
      // 실제 NPC 대화 진입을 사용하므로 투어 차단 등 기존 마을 규칙도 적용됩니다.
      if (window.__sw) window.__sw().openNpc(entry[0]);
    });
    launcher.appendChild(button);
  });
  document.body.appendChild(launcher);
})();

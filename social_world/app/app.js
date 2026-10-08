/*
 * 소셜 월드 앱 — 로그인·튜토리얼·투어·NPC 대화·미션방·동아리방·코코·이장 연결
 *
 * 원래 socialworld-demo.html 안에 있던 앱 로직을 그대로 옮긴 파일이다(2026-10-02 분리).
 *   world-engine.js  3D 장면·이동·미니맵 (전역 getEngine / ENGINE)
 *   ui.js            휴대폰·지도·설정·코코 알림 (window.WorldUI)
 *   app.js           이 파일. 게임 흐름과 DB
 * 배포용 한 파일은 bundle.py가 ../socialworld-demo.html 로 만든다 — 그 파일을 직접 고치지 않는다.
 */
(function(){
  "use strict";
  var SUPABASE_URL = "https://czfsoopkxucizommvcnp.supabase.co";
  var SUPABASE_ANON_KEY = "sb_publishable_D6jRdP6qgMc_lGoDiVLlsQ_pnoHND02";
  var sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  var SGG_CODES = [
    { code: "11680", label: "서울시 강남구" },
    { code: "51110", label: "강원도 춘천시" }
  ];
  var AGE_GROUPS = ["10대","20대","30대","40대","50대","60대이상"];
  var CATEGORIES = ["문화","공연","체육","스터디","기타"];

  // ---------------------------------------------------------------
  // NPC 대본 — 선택지마다 위험 신호(signal) 태그를 붙인다.
  //   tags     : 위험 키워드. 고립 척도(UCLA 외로움 척도·De Jong Gierveld 척도·서울시 고립은둔청년
  //              실태조사)의 문항 주제를 풀어 쓴 것 — 대화상대 부재, 소외감, 사회적 회피, 지속기간
  //   severity : 0~1 심각도. 대화 1회의 심각도는 선택한 값 중 최댓값
  //   crisis   : true면 즉시 위기 안내(109) + 지역 단위 위기 기록(user_id 없음)
  // 대화 원문은 저장하지 않는다. 저장되는 것은 NPC 종류·태그 수·심각도뿐이다.
  // ---------------------------------------------------------------
  var NPCS = [
    { id:"policy", name:"정책추천 NPC", emoji:"📋", color:"#5b8def",
      tree:{
        root:{text:"안녕하세요! 저는 정책추천 도우미예요. 무엇을 도와드릴까요?",
          options:[{label:"청년 주거 지원 정책이 궁금해요", next:"housing"},
                   {label:"생활비 지원 제도를 알고 싶어요", next:"living", signal:{tags:["생계부담"], severity:0.3}},
                   {label:"그냥 둘러볼게요", next:"bye"}]},
        housing:{text:"청년 월세 지원, 전세보증금 대출이자 지원 같은 제도가 있어요. 거주 지역 기준으로 더 정확히 안내해 드릴 수 있어요 (실제 서비스에서는 복지자원 DB와 연동됩니다).",
          options:[{label:"다른 것도 궁금해요", next:"root"},{label:"고마워요", next:"bye"}]},
        living:{text:"청년 생활안정자금, 자립수당 등이 대표적이에요. 자격 요건은 소득·나이 기준에 따라 달라져요.",
          options:[{label:"다른 것도 궁금해요", next:"root"},{label:"고마워요", next:"bye"}]},
        bye:{text:"언제든 다시 찾아주세요! 👋", options:[]}
      }},
    { id:"job", name:"취업상담 NPC", emoji:"💼", color:"#2fa86b",
      tree:{
        root:{text:"어떤 취업 준비 단계에 계신가요?",
          options:[{label:"이제 막 구직을 시작했어요", next:"start"},
                   {label:"면접까지 왔는데 막막해요", next:"interview"},
                   {label:"오래 준비했는데 계속 떨어져서 지쳤어요", next:"longterm", signal:{tags:["장기구직","무기력"], severity:0.6}},
                   {label:"그냥 둘러볼게요", next:"bye"}]},
        start:{text:"좋아요, 시작이 반이에요. 관심 직무 분야를 정하고 청년 취업지원 프로그램부터 알아보는 걸 추천해요.",
          options:[{label:"다른 것도 궁금해요", next:"root"},{label:"고마워요", next:"bye"}]},
        interview:{text:"면접 전 모의면접 프로그램이나 취업 상담 센터를 연계해 드릴 수 있어요 (실제 서비스에서는 복지자원 DB와 연동됩니다).",
          options:[{label:"다른 것도 궁금해요", next:"root"},{label:"고마워요", next:"bye"}]},
        longterm:{text:"그동안 정말 애쓰셨어요. 결과가 안 나오면 나 자신을 탓하게 되기 쉬운데, 그건 노력이 부족해서가 아니에요. 구직을 오래 쉬었던 청년을 위한 도전지원사업도 있고, 마음이 많이 지쳤다면 루미와 먼저 이야기해 보는 것도 좋아요.",
          options:[{label:"요즘은 아예 아무것도 하기 싫어요", next:"giveup", signal:{tags:["구직단념","사회적회피"], severity:0.7}},
                   {label:"지원사업 알려주세요", next:"interview"},
                   {label:"고마워요", next:"bye"}]},
        giveup:{text:"그럴 수 있어요. 당분간 취업 이야기는 잠시 내려놓아도 괜찮아요. 카페 앞에 있는 루미가 이야기를 들어줄 거예요.",
          options:[{label:"알겠어요", next:"bye"}]},
        bye:{text:"응원할게요, 다음에 또 봐요! 💪", options:[]}
      }},
    // 루미 — 튜토리얼과 같은 친구 말투(반말)로 통일. 선택지는 유저가 루미에게 하는 말이라 역시 반말
    { id:"psych", name:"루미", emoji:"🌱", color:"#B56CC0",
      disclaimer:"AI 친구 · 사람 상담사는 아니야",
      tree:{
        root:{text:function(){ return "왔구나, " + ((state.profile && state.profile.nickname) || "친구") + "! 오늘 하루는 어땠어? 편하게 얘기해도 돼."; },
          options:[{label:"요즘 좀 지치고 힘들어", next:"tired", signal:{tags:["무기력"], severity:0.4}},
                   {label:"그냥저냥 괜찮아", next:"okay", signal:{tags:[], severity:0.1}},
                   {label:"그냥 인사하러 왔어", next:"bye"}]},
        tired:{text:"그랬구나, 많이 힘들었겠다. 요즘 사람들이랑은 어떻게 지내?",
          options:[{label:"가끔 친구들 만나", next:"social", signal:{tags:[], severity:0.2}},
                   {label:"속얘기할 사람이 별로 없어", next:"duration", signal:{tags:["대화상대없음","소외감"], severity:0.6}},
                   {label:"다 귀찮고 혼자 있는 게 편해", next:"duration", signal:{tags:["사회적회피"], severity:0.6}}]},
        social:{text:"다행이다! 가까운 사람들이랑 보내는 시간이 힘이 될 거야. 지친 마음은 가벼운 활동으로 풀어 보는 것도 좋아. 미션방에 작은 퀘스트들이 있어.",
          options:[{label:"고마워", next:"bye"}]},
        duration:{text:"그런 시간이 길어지면 마음이 더 무겁게 느껴질 수 있어. 이런 상태가 얼마나 됐어?",
          options:[{label:"몇 주 됐어", next:"support", signal:{tags:["고립지속"], severity:0.7}},
                   {label:"몇 달째야", next:"support", signal:{tags:["고립지속","장기고립"], severity:0.8}},
                   {label:"사실 다 그만두고 싶을 때가 있어", next:"crisis", signal:{tags:["위기발화"], severity:1.0, crisis:true}}]},
        support:{text:"말해 줘서 고마워. 혼자 견디지 않았으면 좋겠어. 동아리센터에는 부담 없이 들어갈 수 있는 모임이 있고, 원하면 전문 상담도 같이 찾아볼 수 있어.",
          options:[{label:"상담은 어디서 받을 수 있어?", next:"counsel"},
                   {label:"동아리센터 한번 가 볼게", next:"bye"},
                   {label:"고마워", next:"bye"}]},
        counsel:{text:"청년 마음건강 바우처로 전문 심리상담을 받을 수 있고, 가까운 정신건강복지센터(정신건강 상담전화 1577-0199)에서도 상담받을 수 있어. 신청 방법은 지원센터 쪽 창구에서 알려 줄 거야.",
          options:[{label:"고마워", next:"bye"}]},
        crisis:{crisis:true,
          text:"그런 마음까지 들었구나. 지금 많이 힘든 상태일 수 있어. 혼자 견디지 말고 지금 바로 전문 상담사랑 이야기해 줘. 24시간 언제든 연결돼. 나도 여기 있을게.",
          options:[{label:"알겠어", next:"bye"}]},
        okay:{text:"다행이다! 마음이 무거운 날엔 언제든 카페로 놀러 와.",
          options:[{label:"다른 얘기도 할래", next:"root"},{label:"고마워", next:"bye"}]},
        bye:{text:"오늘도 수고 많았어. 또 보자! 🌱", options:[]}
      }},
    // 마을이장 — 튜토리얼 1단계 퀘스트 대상. 위험 신호를 수집하지 않는 대화라 npc_sessions에 남기지 않는다
    // chief/chief.js가 있으면 그 대화창(이번 주 이벤트·참여)을 쓰고, 이 대본 트리는 모듈을 못 불러왔을 때의 대체용이다
    { id:"chief", name:"마을이장", emoji:"🎩", color:"#b08a3e", noSignal:true,
      tree:{
        root:{text:function(){ return "어서 와요, " + ((state.profile && state.profile.nickname) || "주민") + "님! 이 마을 이장이에요. 우리 마을에 온 걸 환영해요."; },
          options:[{label:"잘 부탁드려요!", next:"events"}]},
        events:{text:"이번 주엔 공원에서 같이 걷기 모임이 있어요. 말 안 하고 걷기만 해도 되니까 부담 없이 와요. 궁금한 건 루미한테 물어봐도 되고요.",
          options:[{label:"네, 가볼게요", next:"bye"},{label:"다음에 볼게요", next:"bye"}]},
        bye:{text:"언제든 광장에 들러요. 🎩", options:[]}
      }},
    // 코코 — 활동 추천. 대본 트리 대신 coco/coco.js 대화창을 연다(openNpc 참고).
    // 위험 신호가 아니라 수요 신호라 npc_sessions에 남기지 않고, coco.js가 npc_demand_logs에 기록한다
    { id:"coco", name:"코코", emoji:"🎈", color:"#2E6B4F", noSignal:true, external:true }
  ];

  var state = {
    view: "loading",
    session: null,
    profile: null,
    missions: [],
    progress: {},
    clubs: [],
    myClubIds: {},
    busy: null,
    plazaPos: { px:49, py:58 },
    activeNpc: null,
    npcNode: "root",
    npcSession: null,     // 진행 중인 대화의 신호 누적 {npc_type, started_at, tags, maxSev, turns, crisisReported}
    feedback: null,       // 위험 탐지 에이전트가 내려준 내 코호트 개인화(cohort_feedback)
    toast: null,
    showClubForm: false,
    ob: null,             // 튜토리얼 설문 진행 상태
    room: null,           // 내 방 상태
    tutorialCtx: null,    // 설문의 '요즘'·'해보고 싶은 것' — 루미 첫 인사용, 저장 안 함
    firstQuestDone: false,
    tour: null            // 루미와 함께 걷는 마을 투어 진행 상태
  };

  var app = document.getElementById("app");
  function h(html){ var t = document.createElement("template"); t.innerHTML = html.trim(); return t.content; }
  function el(sel, root){ return (root||app).querySelector(sel); }
  function esc(s){ return String(s==null?"":s).replace(/[&<>"']/g, function(c){
    return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];
  }); }

  // 3D 엔진(getEngine·makeEngine·ENGINE)은 world-engine.js에 있다(전역).

  // ---------------- auth / data ----------------
  function refreshProfile(){
    if(!state.session) { state.profile = null; return Promise.resolve(); }
    return sb.from("profiles").select("*").eq("id", state.session.user.id).maybeSingle()
      .then(function(res){ state.profile = res.data || null; return syncLocalProfile(); });
  }

  // DB에 캐릭터·관심사·가입목표 칸(03_world_update.sql)이 없던 시절 이 브라우저에만 남겨둔 값을,
  // 칸이 생긴 뒤 처음 들어올 때 DB로 옮긴다. DB에 이미 값이 있으면 덮어쓰지 않는다.
  function syncLocalProfile(){
    var p = state.profile;
    if(!p || !("avatar" in p)) return Promise.resolve();          // 칸이 아직 없으면 그대로 둔다
    var patch = {}, localAv = null, extra = null;
    try { var r1 = localStorage.getItem(avatarKey()); if(r1) localAv = JSON.parse(r1); } catch(e){}
    try { var r2 = localStorage.getItem(extraKey());  if(r2) extra   = JSON.parse(r2); } catch(e){}
    if(!p.avatar && localAv) patch.avatar = localAv;
    if(extra){
      if((!p.interests || !p.interests.length) && extra.interests && extra.interests.length) patch.interests = extra.interests;
      if(!p.join_goal && extra.join_goal) patch.join_goal = extra.join_goal;
    }
    if(!Object.keys(patch).length) return Promise.resolve();
    return sb.from("profiles").update(patch).eq("id", p.id).then(function(res){
      if(res.error){ console.warn("브라우저 보관값을 DB로 옮기지 못했습니다(다음 접속 때 다시 시도):", res.error.message); return; }
      Object.assign(p, patch);
      try { localStorage.removeItem(avatarKey()); localStorage.removeItem(extraKey()); } catch(e){}
    });
  }

  // ⑩ 환류 — 에이전트가 쓴 "내 코호트" 개인화 지시를 읽는다. RLS가 본인 코호트 행만 돌려준다.
  // 위험 등급은 이 표에 없다(시민 화면에 등급이 노출될 경로 자체를 두지 않음).
  function loadFeedback(){
    if(!state.session || !state.profile) { state.feedback = null; return Promise.resolve(); }
    return sb.from("cohort_feedback").select("npc_emphasis,priority_missions,updated_at").maybeSingle()
      .then(function(res){ state.feedback = (res && !res.error) ? res.data : null; })
      .catch(function(){ state.feedback = null; });
  }

  function routeAfterAuth(){
    if(!state.session){ state.view = "login"; render(); return; }
    refreshProfile().then(loadFeedback).then(function(){
      if(state.profile && state.profile.onboarded_at){ state.view = "plaza"; render(); }
      else startSurvey();
    });
  }

  sb.auth.getSession().then(function(res){
    state.session = res.data.session;
    routeAfterAuth();
  });
  sb.auth.onAuthStateChange(function(_e, session){
    state.session = session;
  });

  function signInGuest(btn){
    btn.disabled = true; btn.textContent = "접속 중…";
    sb.auth.signInAnonymously().then(function(res){
      if(res.error){ alert("게스트 로그인에 실패했습니다: " + res.error.message); btn.disabled = false; return; }
      state.session = res.data.session;
      routeAfterAuth();
    });
  }

  // ---------------- render dispatch ----------------
  function render(){
    var tut = document.getElementById("tut-backdrop"); if(tut && state.view !== "room") tut.remove();
    if(state.view === "plaza") return renderPlaza();
    if(state.view === "market" || state.view === "market-bank" || state.view === "market-clothing") return renderMarket();
    if(state.view === "room") return renderRoom();
    hideWorld();
    if(state.view === "loading") return renderLoading();
    if(state.view === "survey") return renderSurvey();
    if(state.view === "character") return renderCharacter();
    if(state.view === "login") return renderLogin();
    if(state.view === "mission") return renderMissionRoom();
    if(state.view === "club") return renderClubRoom();
  }

  function renderLoading(){
    app.innerHTML = "";
    app.appendChild(h('<div class="center-screen"><p>불러오는 중…</p></div>'));
  }

  // ---------------- login ----------------
  function renderLogin(){
    app.innerHTML = "";
    app.appendChild(h(
      '<div class="center-screen">' +
        '<div class="login-card pixel-panel">' +
          '<div class="login-logo">🌱</div>' +
          '<h1>소셜 월드</h1>' +
          '<p class="login-sub">함께 있으면, 덜 외로워요.</p>' +
          '<button class="btn btn-primary" id="btn-guest">게스트로 체험하기</button>' +
          '<button class="btn btn-kakao" id="btn-kakao" disabled>카카오로 시작하기 (정식 배포에서 지원)</button>' +
          '<p class="terms">소셜 월드는 닉네임, 거주 지역·나이대·성별, 캐릭터·관심사만 저장하며, 대화 원문은 저장하지 않습니다.</p>' +
          '<p class="demo-note">이 페이지는 브리핑용 라이브 데모예요. 실제 socialworld Supabase 프로젝트에 연결되어 있어서, 게스트로 들어가도 온보딩·미션·동아리·NPC 대화 신호가 실제 데이터베이스에 기록됩니다. 대화 원문은 저장하지 않고, 선택지에 붙은 위험 신호 수치만 남습니다.</p>' +
        '</div>' +
      '</div>'
    ));
    el("#btn-guest").addEventListener("click", function(){ signInGuest(this); });
  }

  // ================================================================
  // 튜토리얼 (설계 문서 13절, 2026-09-29)
  //   ① 사전 설문 8문항 → ② 캐릭터 자동 생성(+직접 꾸미기) → ③ 내 방에서 깨어남 → ④ 루미 소개(대본형)
  //   "요즘 하루는 어때요?" 답은 루미 첫 인사 말투에만 쓰고 저장하지 않는다.
  // ================================================================
  var REGION_CHOICES = [{v:"11680",label:"서울시 강남구"},{v:"51110",label:"강원도 춘천시"},{v:"OTHER",label:"다른 지역"}];
  var AGE_CHOICES = [{v:"20대",label:"20대"},{v:"30대",label:"30대"},{v:"기타",label:"그 외"}];
  var GENDER_CHOICES = [{v:"F",label:"여성"},{v:"M",label:"남성"}];
  var VIBES = [{v:"cozy",label:"아늑한",emoji:"🧣"},{v:"lively",label:"활발한",emoji:"⚡"},
               {v:"calm",label:"차분한",emoji:"🍃"},{v:"quirky",label:"엉뚱한",emoji:"🌀"}];
  var COLORS = [{v:"#e76f51",label:"코랄"},{v:"#f4a261",label:"오렌지"},{v:"#e9c46a",label:"노랑"},
                {v:"#4caf6e",label:"초록"},{v:"#5b8def",label:"파랑"},{v:"#9b72cf",label:"보라"}];
  var INTERESTS = ["운동","게임","음악","독서","요리","취업","공부","휴식"];
  var GOALS = [{v:"rest",label:"그냥 쉬고 싶어요"},{v:"talk",label:"이야기 나누고 싶어요"},
               {v:"meet",label:"새로운 사람을 만나고 싶어요"},{v:"info",label:"필요한 정보를 찾고 싶어요"}];
  var MOODS = [{v:"relaxed",label:"여유로워요"},{v:"busy",label:"바빠요"},{v:"tired",label:"좀 지쳤어요"},{v:"unsure",label:"잘 모르겠어요"}];

  var SURVEY = [
    {key:"nickname", type:"text", required:true, q:"소셜 월드에서 쓸 이름을 정해 주세요",
     sub:"다른 주민에게 보이는 이름이에요. 실명이 아니어도 괜찮아요."},
    {key:"sgg", type:"single", required:true, choices:REGION_CHOICES, q:"어느 지역에 살고 있나요?",
     sub:"비슷한 이웃끼리 묶은 통계에만 쓰여요. 다른 지역에 살아도 이용할 수 있어요(통계에는 들어가지 않아요)."},
    {key:"age", type:"single", required:true, choices:AGE_CHOICES, q:"나이대를 알려 주세요",
     sub:"또래에게 맞는 활동을 추천하는 데 써요."},
    {key:"gender", type:"single", required:true, choices:GENDER_CHOICES, q:"성별을 알려 주세요",
     sub:"또래·지역별 통계를 정확하게 내는 데 필요해요. 다른 주민에게는 보이지 않아요."},
    {key:"look", type:"look", required:true, q:"어떤 분위기가 좋아요?",
     sub:"고른 분위기와 색으로 첫 캐릭터를 만들어 드려요. 마음에 안 들면 직접 바꿀 수 있어요."},
    {key:"interests", type:"multi", max:3, required:false, choices:INTERESTS, q:"요즘 관심 있는 걸 골라 주세요",
     sub:"최대 3개까지 고를 수 있어요. 어울리는 모임과 활동을 추천할 때 써요."},
    {key:"goal", type:"single", required:false, choices:GOALS, q:"소셜 월드에서 뭘 해보고 싶어요?",
     sub:"첫 안내를 여기에 맞춰 드려요."},
    {key:"mood", type:"single", required:false, choices:MOODS, q:"요즘 하루는 어때요?",
     sub:"첫 인사 말투만 맞출게요. 이 답은 저장하지 않아요."}
  ];

  // ---------------- 캐릭터 (SVG 조합) ----------------
  var AV_OPTS = {
    hair:[{v:"short",label:"짧은 머리"},{v:"long",label:"긴 머리"},{v:"curly",label:"곱슬머리"},{v:"bun",label:"묶은 머리"},{v:"spiky",label:"삐죽 머리"}],
    hairColor:[{v:"#2b2b2b",label:"검정"},{v:"#6b4226",label:"갈색"},{v:"#c28f4b",label:"밝은 갈색"},{v:"#e9c46a",label:"금발"},{v:"#b5475b",label:"와인"},{v:"#5b8def",label:"파랑"}],
    skin:[{v:"#f6d7b8",label:"밝은 톤"},{v:"#e8b98f",label:"중간 톤"},{v:"#c98e62",label:"구릿빛"},{v:"#8d5a3b",label:"짙은 톤"}],
    outfit:COLORS,
    acc:[{v:"none",label:"없음"},{v:"glasses",label:"안경"},{v:"cap",label:"모자"},{v:"beanie",label:"비니"},{v:"headphones",label:"헤드폰"},{v:"flower",label:"꽃핀"}],
    face:[{v:"smile",label:"미소"},{v:"calm",label:"차분"},{v:"grin",label:"활짝"},{v:"wink",label:"윙크"}]
  };
  var PART_ORDER = ["hair","hairColor","skin","outfit","acc","face"];
  var PART_LABELS = {hair:"머리 모양",hairColor:"머리색",skin:"피부색",outfit:"옷 색",acc:"소품",face:"표정"};
  // 분위기 → 1차 캐릭터. 설문의 "요즘" 답은 외모에 쓰지 않는다(상태를 겉모습으로 드러내지 않기)
  var VIBE_PRESET = {
    cozy:  {hair:"long",  hairColor:"#6b4226", acc:"beanie",     face:"smile"},
    lively:{hair:"spiky", hairColor:"#2b2b2b", acc:"cap",        face:"grin"},
    calm:  {hair:"short", hairColor:"#2b2b2b", acc:"glasses",    face:"calm"},
    quirky:{hair:"curly", hairColor:"#e9c46a", acc:"headphones", face:"wink"}
  };

  function presetAvatar(vibe, color, seed){
    var p = VIBE_PRESET[vibe] || VIBE_PRESET.calm;
    var hsh = 0; seed = seed || "";
    for(var i=0;i<seed.length;i++) hsh = (hsh*31 + seed.charCodeAt(i)) >>> 0;
    return { vibe:vibe, color:color, hair:p.hair, hairColor:p.hairColor,
             skin:AV_OPTS.skin[hsh % AV_OPTS.skin.length].v, outfit:color || "#4caf6e", acc:p.acc, face:p.face };
  }

  function avatarSvg(av, size){
    av = av || presetAvatar("calm","#4caf6e","");
    var S = ' stroke="#2b2b2b" stroke-width="2" stroke-linejoin="round"';
    var hc = av.hairColor, parts = [];
    if(av.hair === "long") parts.push('<path d="M17 27 Q16 12 32 12 Q48 12 47 27 L48 43 Q44 45 42 41 L42 29 L22 29 L22 41 Q20 45 16 43 Z" fill="'+hc+'"'+S+'/>');
    parts.push('<path d="M13 64 Q13 44 32 44 Q51 44 51 64 Z" fill="'+av.outfit+'"'+S+'/>');
    parts.push('<circle cx="32" cy="29" r="14" fill="'+av.skin+'"'+S+'/>');
    var top = '<path d="M18 27 Q18 13 32 13 Q46 13 46 27 Q40 20 32 21 Q24 20 18 27 Z" fill="'+hc+'"'+S+'/>';
    if(av.hair === "curly"){
      top = [20,26,32,38,44].map(function(x,i){ var y=[18,15,14,15,18][i]; return '<circle cx="'+x+'" cy="'+y+'" r="6" fill="'+hc+'"'+S+'/>'; }).join("");
    } else if(av.hair === "spiky"){
      top = '<path d="M18 26 L19 14 L25 19 L28 9 L32 17 L36 9 L39 19 L45 14 L46 26 Q40 20 32 21 Q24 20 18 26 Z" fill="'+hc+'"'+S+'/>';
    } else if(av.hair === "bun"){
      top = '<circle cx="32" cy="10" r="6" fill="'+hc+'"'+S+'/>' + top;
    }
    parts.push(top);
    parts.push('<circle cx="23" cy="34" r="2.5" fill="#f28ab2" opacity=".45"/><circle cx="41" cy="34" r="2.5" fill="#f28ab2" opacity=".45"/>');
    var L = ' stroke="#2b2b2b" stroke-width="1.8" stroke-linecap="round" fill="none"';
    if(av.face === "calm") parts.push('<path d="M25 30 h4 M35 30 h4"'+L+'/><path d="M29 37 h6"'+L+'/>');
    else if(av.face === "grin") parts.push('<path d="M25 31 Q27 28 29 31 M35 31 Q37 28 39 31"'+L+'/><path d="M26 35 Q32 42 38 35 Z" fill="#fff" stroke="#2b2b2b" stroke-width="1.8" stroke-linejoin="round"/>');
    else if(av.face === "wink") parts.push('<circle cx="27" cy="30" r="1.8" fill="#2b2b2b"/><path d="M35 30 h4"'+L+'/><path d="M27 36 Q32 40 37 36"'+L+'/>');
    else parts.push('<circle cx="27" cy="30" r="1.8" fill="#2b2b2b"/><circle cx="37" cy="30" r="1.8" fill="#2b2b2b"/><path d="M27 36 Q32 40 37 36"'+L+'/>');
    if(av.acc === "glasses") parts.push('<circle cx="27" cy="30" r="4.2"'+L+'/><circle cx="37" cy="30" r="4.2"'+L+'/><path d="M31.2 30 h1.6"'+L+'/>');
    else if(av.acc === "cap") parts.push('<path d="M17 23 Q18 10 32 10 Q46 10 47 23 Z" fill="'+av.outfit+'"'+S+'/><path d="M40 22 Q52 21 55 24 Q48 26 40 25 Z" fill="'+av.outfit+'"'+S+'/>');
    else if(av.acc === "beanie") parts.push('<path d="M17 24 Q17 9 32 9 Q47 9 47 24 Z" fill="'+av.outfit+'"'+S+'/><rect x="16" y="20" width="32" height="6" rx="3" fill="#fff" opacity=".55"'+S+'/><circle cx="32" cy="7" r="3.5" fill="#fff"'+S+'/>');
    else if(av.acc === "headphones") parts.push('<path d="M17 29 Q16 11 32 11 Q48 11 47 29" fill="none" stroke="#333" stroke-width="3"/><rect x="12" y="25" width="7" height="11" rx="3" fill="#333"/><rect x="45" y="25" width="7" height="11" rx="3" fill="#333"/>');
    else if(av.acc === "flower") parts.push('<g transform="translate(43 16)">' +
      [[0,-3],[3,0],[0,3],[-3,0]].map(function(d){ return '<circle cx="'+d[0]+'" cy="'+d[1]+'" r="2.6" fill="#f28ab2"/>'; }).join("") +
      '<circle r="2" fill="#ffd166"/></g>');
    return '<svg viewBox="0 0 64 64" width="'+size+'" height="'+size+'" role="img" aria-label="내 캐릭터">'+parts.join("")+'</svg>';
  }

  function avatarKey(){ return "sw_avatar_" + (state.session ? state.session.user.id : "guest"); }
  function currentAvatar(baseOnly){
    var av = state.profile && state.profile.avatar;
    if(!av) try { var raw = localStorage.getItem(avatarKey()); if(raw) av = JSON.parse(raw); } catch(e){}
    var data = !baseOnly && economy && economy.getState();
    var worn = data && data.inventory.instances.find(function(i){ return i.id === data.equippedClothing; });
    var definition = worn && window.FishingData.items[worn.itemId];
    if(definition && definition.kind === 'clothing') av = Object.assign({}, av || presetAvatar('calm','#4caf6e',nick()), {outfit:definition.color});
    return av || null;
  }

  // ---------------- ① 사전 설문 ----------------
  function startSurvey(){
    state.ob = { step:0, answers:{ interests:[] }, avatar:null, editOnly:false };
    state.view = "survey";
    render();
  }

  function surveyNext(){
    if(state.ob.step < SURVEY.length - 1){ state.ob.step += 1; renderSurvey(); }
    else {
      var a = state.ob.answers;
      state.ob.avatar = presetAvatar(a.vibe, a.color, a.nickname);
      state.view = "character"; render();
    }
  }

  function renderSurvey(){
    app.innerHTML = "";
    var ob = state.ob, st = SURVEY[ob.step], a = ob.answers;
    var pct = Math.round((ob.step) / SURVEY.length * 100);
    var body = "", canNext = false;
    if(st.type === "text"){
      body = '<input class="survey-input" id="sv-text" maxlength="20" placeholder="예: 느긋한고양이" value="'+esc(a.nickname||"")+'">';
    } else if(st.type === "single"){
      body = '<div class="choice-list">' + st.choices.map(function(c){
        var on = a[st.key] === c.v;
        return '<button class="choice'+(on?" on":"")+'" data-v="'+esc(c.v)+'" aria-pressed="'+on+'">'+esc(c.label)+'</button>';
      }).join("") + '</div>';
    } else if(st.type === "multi"){
      var sel = a[st.key] || [];
      body = '<div class="chips">' + st.choices.map(function(c){
        var on = sel.indexOf(c) >= 0;
        return '<button class="chip" data-v="'+esc(c)+'" aria-pressed="'+on+'">'+esc(c)+'</button>';
      }).join("") + '</div><p class="survey-count">'+sel.length+' / '+st.max+'</p>';
      canNext = sel.length > 0;
    } else if(st.type === "look"){
      body = '<div class="vibe-grid">' + VIBES.map(function(v){
        var on = a.vibe === v.v;
        return '<button class="vibe'+(on?" on":"")+'" data-vibe="'+v.v+'" aria-pressed="'+on+'"><span class="vibe-emoji">'+v.emoji+'</span>'+esc(v.label)+'</button>';
      }).join("") + '</div>' +
      '<p class="survey-mini">좋아하는 색</p><div class="swatches">' + COLORS.map(function(c){
        var on = a.color === c.v;
        return '<button class="swatch'+(on?" on":"")+'" data-color="'+c.v+'" style="background:'+c.v+'" aria-label="'+esc(c.label)+'" aria-pressed="'+on+'"></button>';
      }).join("") + '</div>';
      canNext = !!(a.vibe && a.color);
    }
    var showNext = st.type === "text" || st.type === "multi" || st.type === "look";
    app.appendChild(h(
      '<div class="center-screen">' +
        '<div class="pixel-panel survey-card">' +
          '<div class="survey-step"><span>'+(ob.step+1)+' / '+SURVEY.length+'</span><span>'+(st.required?"필수":"건너뛰어도 돼요")+'</span></div>' +
          '<div class="survey-progress"><span style="width:'+pct+'%"></span></div>' +
          '<h1 class="survey-q">'+esc(st.q)+'</h1>' +
          '<p class="survey-sub">'+esc(st.sub)+'</p>' + body +
          '<div class="survey-nav">' +
            (ob.step > 0 ? '<button class="btn-ghost" id="sv-back">← 이전</button>' : '<span></span>') +
            '<div class="survey-nav-right">' +
              (!st.required ? '<button class="btn-ghost" id="sv-skip">건너뛰기</button>' : '') +
              (showNext ? '<button class="btn btn-primary btn-auto" id="sv-next"'+(st.type==="text"||canNext?"":" disabled")+'>다음</button>' : '') +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>'
    ));
    var back = el("#sv-back"); if(back) back.addEventListener("click", function(){ ob.step -= 1; renderSurvey(); });
    var skip = el("#sv-skip"); if(skip) skip.addEventListener("click", function(){
      if(st.type === "multi") a[st.key] = []; else delete a[st.key];
      surveyNext();
    });
    if(st.type === "text"){
      var inp = el("#sv-text"); inp.focus();
      var go = function(){
        var v = inp.value.trim();
        if(!v){ inp.classList.add("shake"); inp.setAttribute("aria-invalid","true"); inp.placeholder = "이름을 입력해 주세요"; return; }
        a.nickname = v; surveyNext();
      };
      el("#sv-next").addEventListener("click", go);
      inp.addEventListener("keydown", function(e){ if(e.key === "Enter"){ e.preventDefault(); go(); } });
    } else if(st.type === "single"){
      Array.prototype.forEach.call(app.querySelectorAll(".choice"), function(b){
        b.addEventListener("click", function(){ a[st.key] = b.getAttribute("data-v"); surveyNext(); });
      });
    } else if(st.type === "multi"){
      Array.prototype.forEach.call(app.querySelectorAll(".chip"), function(b){
        b.addEventListener("click", function(){
          var v = b.getAttribute("data-v"), list = a[st.key] || (a[st.key] = []), i = list.indexOf(v);
          if(i >= 0) list.splice(i,1); else if(list.length < st.max) list.push(v);
          renderSurvey();
        });
      });
      el("#sv-next").addEventListener("click", surveyNext);
    } else if(st.type === "look"){
      Array.prototype.forEach.call(app.querySelectorAll("[data-vibe]"), function(b){
        b.addEventListener("click", function(){ a.vibe = b.getAttribute("data-vibe"); renderSurvey(); });
      });
      Array.prototype.forEach.call(app.querySelectorAll("[data-color]"), function(b){
        b.addEventListener("click", function(){ a.color = b.getAttribute("data-color"); renderSurvey(); });
      });
      el("#sv-next").addEventListener("click", surveyNext);
    }
  }

  // ---------------- ② 캐릭터 생성·꾸미기 ----------------
  function openCustomizer(){
    state.ob = { step:0, answers:{}, avatar: JSON.parse(JSON.stringify(currentAvatar() || presetAvatar("calm","#4caf6e",""))), editOnly:true };
    state.view = "character"; render();
  }

  function renderCharacter(){
    app.innerHTML = "";
    var ob = state.ob, av = ob.avatar;
    var rows = PART_ORDER.map(function(k){
      var opts = AV_OPTS[k], idx = Math.max(0, opts.map(function(o){return o.v;}).indexOf(av[k]));
      var val = k === "outfit" || k === "hairColor" || k === "skin"
        ? '<span class="dot" style="background:'+opts[idx].v+'"></span>'+esc(opts[idx].label) : esc(opts[idx].label);
      return '<div class="part-row"><span class="part-name">'+PART_LABELS[k]+'</span>' +
        '<button data-part="'+k+'" data-dir="-1" aria-label="'+PART_LABELS[k]+' 이전">◀</button>' +
        '<span class="part-val">'+val+'</span>' +
        '<button data-part="'+k+'" data-dir="1" aria-label="'+PART_LABELS[k]+' 다음">▶</button></div>';
    }).join("");
    var intro = ob.editOnly ? "캐릭터를 원하는 대로 바꿔 보세요." :
      "고른 분위기로 첫 캐릭터를 만들었어요! 마음에 들면 그대로, 아니면 직접 바꿔 보세요.";
    app.appendChild(h(
      '<div class="center-screen">' +
        '<div class="pixel-panel survey-card char-card">' +
          '<h1 class="survey-q">'+(ob.editOnly ? "캐릭터 꾸미기" : "내 캐릭터")+'</h1>' +
          '<p class="survey-sub">'+esc(intro)+'</p>' +
          '<div class="char-preview" id="char-preview" aria-label="내 캐릭터 미리보기"></div>' +
          '<p class="char-name">'+esc(ob.editOnly ? (state.profile && state.profile.nickname || "") : ob.answers.nickname)+'</p>' +
          rows +
          '<div class="survey-nav">' +
            (ob.editOnly ? '<button class="btn-ghost" id="ch-cancel">취소</button>'
                         : '<button class="btn-ghost" id="ch-back">← 설문으로</button>') +
            '<div class="survey-nav-right">' +
              (ob.editOnly ? '' : '<button class="btn-ghost" id="ch-reset">처음 추천으로</button>') +
              '<button class="btn btn-primary btn-auto" id="ch-done">'+(ob.editOnly ? "저장하기" : "이 캐릭터로 시작하기")+'</button>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>'
    ));
    var E3 = getEngine(), pvBox = el("#char-preview");
    if(E3) E3.preview(pvBox, av); else pvBox.innerHTML = avatarSvg(av, 150);
    Array.prototype.forEach.call(app.querySelectorAll("[data-part]"), function(b){
      b.addEventListener("click", function(){
        var k = b.getAttribute("data-part"), dir = Number(b.getAttribute("data-dir")), opts = AV_OPTS[k];
        var i = opts.map(function(o){return o.v;}).indexOf(av[k]);
        av[k] = opts[(i + dir + opts.length) % opts.length].v;
        renderCharacter();
      });
    });
    var back = el("#ch-back"); if(back) back.addEventListener("click", function(){ ob.step = SURVEY.length - 1; state.view = "survey"; render(); });
    var reset = el("#ch-reset"); if(reset) reset.addEventListener("click", function(){
      ob.avatar = presetAvatar(ob.answers.vibe, ob.answers.color, ob.answers.nickname); renderCharacter();
    });
    var cancel = el("#ch-cancel"); if(cancel) cancel.addEventListener("click", function(){ openRoom(false); });
    el("#ch-done").addEventListener("click", function(){
      var btn = this; btn.disabled = true; btn.textContent = "저장 중…";
      (ob.editOnly ? saveAvatarOnly(av) : saveProfileFromSurvey()).then(function(ok){
        if(!ok){ btn.disabled = false; btn.textContent = "다시 시도"; return; }
        openRoom(!ob.editOnly);
      });
    });
  }

  // 저장 — 팀 DB에 03_world_update.sql(avatar·interests·join_goal 칸)이 아직 없으면
  // 기본 칸만 DB에 저장하고 캐릭터·관심사·가입목표는 이 브라우저에 보관한다(프로토타입 폴백).
  // 칸이 생긴 뒤 첫 접속 때 syncLocalProfile()이 DB로 옮긴다.
  function isMissingColumn(err){ return err && /column|schema cache/i.test(err.message || ""); }
  function keepAvatarLocally(av){ try { localStorage.setItem(avatarKey(), JSON.stringify(av)); } catch(e){} }
  function extraKey(){ return "sw_profile_extra_" + (state.session ? state.session.user.id : "guest"); }
  function keepExtraLocally(x){ try { localStorage.setItem(extraKey(), JSON.stringify(x)); } catch(e){} }

  function saveProfileFromSurvey(){
    var a = state.ob.answers, av = state.ob.avatar;
    state.tutorialCtx = { mood: a.mood || null, goal: a.goal || null, interests: a.interests || [] };   // 말투용 — 저장 안 함
    var base = { id: state.session.user.id, nickname: a.nickname, sgg_code: a.sgg, age_group: a.age,
                 gender: a.gender, onboarded_at: new Date().toISOString() };
    var full = Object.assign({}, base, { avatar: av, interests: a.interests || [], join_goal: a.goal || null });
    return sb.from("profiles").upsert(full).then(function(res){
      if(!res.error) return true;
      if(!isMissingColumn(res.error)){ alert("저장에 실패했습니다: " + res.error.message); return false; }
      console.warn("profiles에 튜토리얼 칸이 없어 기본 정보만 DB에 저장합니다(03_world_update.sql 적용 전).");
      keepAvatarLocally(av);
      keepExtraLocally({ interests: a.interests || [], join_goal: a.goal || null });
      showToast("캐릭터·관심사는 이 브라우저에 임시 보관했어요. DB 준비가 끝나면 다음 접속 때 자동으로 옮겨져요.");
      return sb.from("profiles").upsert(base).then(function(r2){
        if(r2.error){ alert("저장에 실패했습니다: " + r2.error.message); return false; }
        return true;
      });
    }).then(function(ok){
      if(!ok) return false;
      return refreshProfile().then(loadFeedback).then(function(){ return true; });
    });
  }

  function saveAvatarOnly(av){
    return sb.from("profiles").update({ avatar: av }).eq("id", state.session.user.id).then(function(res){
      if(res.error && !isMissingColumn(res.error)){ alert("저장에 실패했습니다: " + res.error.message); return false; }
      if(res.error) keepAvatarLocally(av);
      return refreshProfile().then(function(){ return true; });
    });
  }

  // ================================================================
  // 3D 마을 ↔ 앱 연결 — 광장·내 방·루미와 걷는 투어 (2026-09-29)
  // ================================================================
  var STUB_MSG = {
    support: "🏛️ 지원센터는 준비 중이에요. 하루가 곧 이사 와요 — 지금은 분수 옆 정책추천·취업상담 창구를 이용해 주세요.",
    park: "🌳 공원 산책로·러닝 챌린지는 준비 중이에요. 연못가 벤치에서 쉬어 가도 돼요.",
    game: "🎮 게임방은 준비 중이에요. 곧 같이 하는 미니게임이 열려요.",
    cafe: "☕ 카페 안은 준비 중이에요. 루미는 카페 앞에 있어요!"
  };
  function npcName(id){ var n = NPCS.filter(function(x){ return x.id === id; })[0]; return n ? n.name : ""; }
  // 앱 대화창(NPC·튜토리얼·코코·이장)이 열려 있는가 — 휴대폰(ui.js)이 알림을 미룰 때도 쓴다
  function dialogOpen(){ return !!document.querySelector(".modal-backdrop, .coco-backdrop, .chief-backdrop"); }
  // 3D 입력을 멈춰야 하는가 — 대화창 또는 휴대폰·지도(ui.js)가 열려 있을 때
  function worldBlocked(){ return !!(window.MarketUI && (window.MarketUI.isTravelling() || window.MarketUI.isTyping() || window.MarketUI.isManipulating())) || dialogOpen() || !!(window.WorldUI && window.WorldUI.isOpen()); }
  // 현재 키 이름 — 휴대폰 설정에서 바꿀 수 있다(ui.js). ui.js가 없으면 기본 키
  function key(action){ return window.WorldUI ? window.WorldUI.keyLabel(action) : ({interact:"E",forward:"W",left:"A",back:"S",right:"D",map:"M"})[action]; }
  function hud(id){ return document.getElementById(id); }

  function showWorld(mode, opt){
    var E = getEngine();
    app.innerHTML = "";
    if(!E){ renderNoWebGL(); return false; }
    E.hooks.blocked = worldBlocked;
    E.hooks.near = function(t){ state.near = t; updateHud(); };
    E.hooks.action = onWorldAction;
    E.hooks.tick = function(dt){ onWorldTick(dt); if(window.WorldUI) window.WorldUI.tick(dt); if(window.MarketUI) window.MarketUI.tick(); };
    E.hooks.afterView = function(){ if(window.MarketUI) window.MarketUI.drawSpeech(); };
    E.hooks.target = function(t){ return window.WorldUI ? window.WorldUI.target(t) : t; };
    E.hooks.movementBlocked = function(){ return !!(window.WorldUI && window.WorldUI.isFishing()); };
    E.hooks.teleport = function(){ if(window.WorldUI) window.WorldUI.cancelFishing(); };
    E.hooks.view = function(changed){ var b = document.getElementById("hud-view"); if(b) b.hidden = !changed; };
    var mmc = document.getElementById("hud-minimap"); if(mmc && E.attachMinimap && !mmc.__on){ mmc.__on = true; mmc.hidden = false; E.attachMinimap(mmc); }
    if(window.WorldUI) window.WorldUI.attach(E);
    E.bubbleNpc = (state.feedback && state.feedback.npc_emphasis) || "psych";
    opt = opt || {};
    opt.avatar = currentAvatar() || presetAvatar("calm", "#4caf6e", nick());
    E.enter(mode, opt);
    E.setHomeName(nick());
    E.setNpcVisible("psych", !state.tour);
    if(!state.tour){ E.setMarker(null); }
    updateHud();
    return true;
  }
  function hideWorld(){ if(ENGINE) ENGINE.leave(); if(window.MarketUI) window.MarketUI.sync(); document.body.classList.remove("in-world"); }

  function renderNoWebGL(){
    app.innerHTML = "";
    app.appendChild(h(
      '<div class="center-screen"><div class="pixel-panel survey-card">' +
        '<h1 class="survey-q">이 기기에서는 3D 마을을 열 수 없어요</h1>' +
        '<p class="survey-sub">브라우저의 하드웨어 가속(WebGL)이 꺼져 있거나 지원되지 않아요. 미션방과 동아리센터는 그대로 이용할 수 있어요.</p>' +
        '<button class="btn btn-primary" id="nw-mission">📮 미션방</button><button class="btn" id="nw-club">🎸 동아리센터</button>' +
      '</div></div>'));
    el("#nw-mission").addEventListener("click", loadMissionRoom);
    el("#nw-club").addEventListener("click", loadClubRoom);
  }

  function updateHud(){
    var E = ENGINE; if(!E || !E.isRunning()) return;
    var inRoom = state.view === "room", inMarket = state.view.indexOf("market") === 0, marketIndoor = inMarket && state.view !== "market";
    var travelling = !!(window.MarketUI && window.MarketUI.isTravelling());
    document.querySelector(".hud-title h1").textContent = inMarket ? "이음 시장" : "이음 마을";
    hud("hud-sub").textContent = inMarket ? (state.view === "market-bank" ? "이음 은행" : state.view === "market-clothing" ? "오늘의 옷장" : "시장 광장 · " + nick() + "님") : inRoom ? nick() + "의 방" : (state.tour ? "루미와 마을 한 바퀴" : "광장 · " + nick() + "님");
    var busyRoom = inRoom && state.room && state.room.phase !== "free";
    hud("hud-room").hidden = !inRoom || busyRoom;
    var mmc = hud("hud-minimap"); if(mmc) mmc.hidden = inRoom || marketIndoor;
    hud("hud-help").hidden = !!state.tour || busyRoom;
    var move = esc(key("forward") + key("left") + key("back") + key("right")), ek = esc(key("interact"));
    hud("hud-help").innerHTML = inRoom
      ? '<b>' + move + '</b> 이동 · <b>끌기</b> 시점 · 문 앞에서 <b>' + ek + '</b>'
      : '<b>' + move + '</b> 이동 · <b>끌기</b> 시점 · <b>휠</b> 줌 · 가까이서 <b>' + ek + '</b> · <b>' + esc(key("map")) + '</b> 지도';
    var act = hud("hud-act"), t = state.near;
    if(state.tour || busyRoom || travelling || !t){ act.hidden = true; }
    else {
      act.hidden = false;
      act.textContent = t.type === "bus" || t.type === "service" || t.type === "exit" || t.type === "wardrobe" || t.type === "fish-shop" ? t.label + " (" + key("interact") + ")"
        : t.type === "fishing" ? t.label + " (" + key("interact") + ")"
        : t.type === "npc" ? npcName(t.id) + " — 대화하기 (" + key("interact") + ")"
        : t.id === "room-door" ? "🚪 밖으로 나가기 (" + key("interact") + ")" : t.label + " 들어가기 (" + key("interact") + ")";
    }
    // 휴대폰 버튼·코코 알림 시점 (ui.js) — 투어 중이거나 방 튜토리얼 중엔 휴대폰을 숨긴다
    if(window.WorldUI) window.WorldUI.sync({ inVillage: E.mode() === "village", tour: !!state.tour, roomBusy: busyRoom || travelling });
    if(window.MarketUI) window.MarketUI.sync();
    drawTour();
  }

  function onWorldAction(t){
    if(worldBlocked()) return;
    if(state.tour){
      if(state.tour.arrived) tourAdvance();
      else showToast("루미를 따라가 보세요 — '루미 따라가기'를 누르면 자동으로 걸어가요");
      return;
    }
    if(state.view === "room" && state.room && state.room.phase !== "free") return;
    if(window.WorldUI && window.WorldUI.interactFishing({ hiddenOnly: true })) return;
    if(!t) return;
    if(t.type === "fishing"){ if(window.WorldUI) window.WorldUI.interactFishing(); return; }
    if(t.type === "bus"){ if(window.MarketUI) window.MarketUI.ride(); return; }
    if(t.type === "wardrobe"){ window.Wardrobe?.open(t.id === "home-wardrobe" ? "home" : "shop"); return; }
    if(t.type === "fish-shop"){ window.FishShop?.open(); return; }
    if(t.type === "service"){ if(window.MarketUI) window.MarketUI.openService(ENGINE.mode()); return; }
    if(t.type === "npc") openNpc(t.id);
    else doorAction(t.id);
  }

  function doorAction(id){
    var P = ENGINE.places();
    if(id === "market-bank" || id === "market-clothing"){ state.view = id; state.near = null; render(); }
    else if(id === "bank-exit" || id === "clothing-exit"){ state.spawn = P[id === "bank-exit" ? "market-bank" : "market-clothing"]; state.view = "market"; state.near = null; render(); }
    else if(id === "mission"){ state.spawn = P.mission; loadMissionRoom(); }
    else if(id === "club"){ state.spawn = P.club; loadClubRoom(); }
    else if(id === "home"){ openRoom(false); }
    else if(id === "room-door"){ state.spawn = P.home; state.view = "plaza"; render(); }
    else if(STUB_MSG[id]) showToast(STUB_MSG[id]);
  }

  function renderPlaza(){
    var spawn = state.spawn || { x: 0.6, z: 7.4 }, facing = state.spawnFacing;
    state.spawn = null; state.spawnFacing = null;
    if(!showWorld("village", { spawn: spawn, facing: facing })) return;
    if(state.activeNpc) renderNpcModal();
  }

  function renderMarket(){
    var mode = state.view === "market-bank" ? "bank" : state.view === "market-clothing" ? "clothing" : "market";
    var spawn = state.spawn, facing = state.spawnFacing;
    state.spawn = null; state.spawnFacing = null; state.near = null;
    if(mode !== "market") spawn = ENGINE.places()[mode + "-inside"];
    else if(!spawn) spawn = window.MarketWorldData.marketStop;
    showWorld(mode, { spawn: spawn, facing: facing != null ? facing : Math.PI, resetView: true });
  }
  function rememberWorldReturn(){
    if(!ENGINE || !ENGINE.isRunning()) return;
    var mode = ENGINE.mode();
    if(["market","bank","clothing"].indexOf(mode) < 0){ state.worldReturn = null; return; }
    state.worldReturn = { spawn: mode === "market" ? ENGINE.playerPos() : ENGINE.places()[mode === "bank" ? "market-bank" : "market-clothing"] };
  }
  function returnFromRoomScreen(){
    if(state.worldReturn){
      state.spawn = state.worldReturn.spawn; state.worldReturn = null; state.view = "market";
    } else state.view = "plaza";
    render();
  }

  // ---------------- ③ 내 방 (3D 실내) ----------------
  function openRoom(withTutorial){
    state.room = { phase: withTutorial ? "wake" : "free", dialog: null };
    state.view = "room"; render();
  }

  function renderRoom(){
    var tutorial = state.room.phase === "wake";
    if(!showWorld("room", tutorial ? { spawnPlace: "bedside", seated: true, sleeping: true } : { spawnPlace: "roomMid", facing: 0 })) return;
    var E = ENGINE;
    if(tutorial){
      var token = state.room;
      setTimeout(function(){ if(state.room !== token || state.view !== "room") return; E.wake(); }, 1700);
      setTimeout(function(){ if(state.room !== token || state.view !== "room") return; lumiEntersRoom(); }, 2400);
    } else if(state.room.dialog){ renderTutorial(); }
  }

  // 루미가 문을 두드리고 걸어 들어온다
  function lumiEntersRoom(){
    var E = ENGINE, P = E.places(), token = state.room;
    token.phase = "knock"; updateHud();
    E.guideShow(P.roomDoor.x, P.roomDoor.z, -Math.PI / 2);
    E.guideWalk(P.roomDoor.x, P.roomDoor.z, null, { knock: true });
    setTimeout(function(){
      if(state.room !== token || state.view !== "room") return;
      E.guideWalk(P.roomMid.x, P.roomMid.z, function(){
        if(state.room !== token || state.view !== "room") return;
        openTutorial();
      }, { direct: true, speed: 2.4 });
    }, 1000);
  }

  // ---------------- 루미와 함께 걷는 마을 투어 ----------------
  var TOUR_STOPS = {
    plaza:  { label:"광장", go:"먼저 광장 한가운데, 분수 앞으로 가자!",
              text:function(){ return "여기가 광장! 마을 한가운데라 어디든 금방 가. 분수 옆에 계신 분이 마을이장님이야 — 이따 인사하러 가자."; } },
    mission:{ label:"미션방", go:"미션방으로 가자!",
              text:function(){ return "📮 미션방이야. 1단계부터 4단계까지 퀘스트가 있어. 1단계는 아주 쉬워서 오늘 바로 할 수 있어."; } },
    park:   { label:"공원", go:"연못 있는 공원으로 가자!",
              text:function(c){ return "🌳 공원! 연못가 벤치에서 쉬거나 산책·러닝 챌린지를 할 수 있어. 이장님이 가끔 같이 걷기 모임도 여셔." + (c.goal === "rest" ? " 쉬고 싶을 때 딱이야." : ""); } },
    support:{ label:"지원센터", go:"저 위 지원센터로 가자!",
              text:function(){ return "🏛️ 지원센터야. 하루가 청년 정책·취업·주거 지원을 찾아 줘. 신청은 네가 직접 하고, 하루는 어디서 어떻게 하는지 알려 줘. 하루가 이사 오기 전까지는 분수 옆 정책추천·취업상담 창구를 쓰면 돼."; } },
    game:   { label:"게임방", go:"줄무늬 천막, 게임방으로 가자!",
              text:function(){ return "🎮 게임방! 다른 주민들이랑 가볍게 게임하는 곳이야. 말 안 하고 같이 있기만 해도 괜찮아."; } },
    cafe:   { label:"카페", go:"지원센터 왼쪽, 카페로 가자! 내 자리야.",
              text:function(){ return "☕ 여기가 카페, 내 자리야! 오늘 있었던 일, 별거 아닌 얘기도 다 좋아. 말하기 싫은 날엔 그냥 앉아만 있다 가도 돼."; } },
    club:   { label:"동아리센터", go:"동아리센터로 가자!",
              text:function(c){ var it = (c.interests && c.interests.length) ? c.interests.join("·") : "관심사";
                return "🎸 동아리센터야. 코코가 네 " + it + "에 맞는 모임을 골라 줘. 마음에 드는 동아리에 응원 스티커도 남길 수 있어."; } },
    chief:  { label:"마을이장님", go:"마지막으로 마을이장님께 가자!", final:true,
              text:function(){ return state.tour && state.tour.route.length === 1 ? "여기가 마을이장님이야! 첫 퀘스트는 이장님께 인사하기. 가서 인사해 봐, 내가 옆에 있을게." : "마지막으로 마을이장님이야! 첫 퀘스트는 이장님께 인사하기. 가서 인사해 봐, 내가 옆에 있을게."; } }
  };
  var TOUR_ROUTE = ["mission","park","cafe","club","game","support"];
  var GOAL_FIRST = { rest:"park", talk:"cafe", meet:"club", info:"support" };

  function tourRoute(){
    var first = GOAL_FIRST[tctx().goal], rest = TOUR_ROUTE.filter(function(k){ return k !== first; });
    return ["plaza"].concat(first ? [first] : [], rest, ["chief"]);
  }
  function tourKey(){ return state.tour.route[state.tour.i]; }
  function tourStop(){ return TOUR_STOPS[tourKey()]; }
  // 루미가 서는 자리(입구에서 광장 쪽으로 조금)와 금색 표시가 뜨는 자리
  function tourSpots(key){
    var P = ENGINE.places(), p = P[key];
    var l = Math.hypot(p.x, p.z) || 1, k = key === "plaza" || key === "chief" ? 0 : 1.2;
    var lumi = { x: p.x - p.x / l * k, z: p.z - p.z / l * k };
    var mark = key === "plaza" ? { x: 0, z: 0 } : key === "chief" ? { x: -4.2, z: 4.6 } : p;
    return { lumi: lumi, mark: mark };
  }

  function startTour(short){
    var old = document.getElementById("tut-backdrop"); if(old) old.remove();
    state.room.dialog = null;
    var fade = document.getElementById("fade"); fade.classList.add("on");
    setTimeout(function(){
      var P = ENGINE.places();
      state.tour = { route: short ? ["chief"] : tourRoute(), i: 0, arrived: false, intro: true };
      state.spawn = P.home; state.view = "plaza"; render();
      // 문을 나서자마자 루미가 바로 옆에 있다
      var l = Math.hypot(P.home.x, P.home.z) || 1;
      ENGINE.guideShow(P.home.x - P.home.x / l * 1.5 + 0.6, P.home.z - P.home.z / l * 1.5 + 0.9);
      ENGINE.guideWalk(ENGINE.guidePos().x, ENGINE.guidePos().z, null, { hello: true });
      fade.classList.remove("on");
      var token = state.tour;
      setTimeout(function(){ if(state.tour !== token) return; token.intro = false; goStop(); }, 2200);
    }, 450);
  }

  function goStop(){
    var t = state.tour, s = tourSpots(tourKey());
    t.arrived = false; t.walkTarget = s.lumi;
    ENGINE.guideWalk(s.lumi.x, s.lumi.z, null, { speed: 3.1, leash: 7 });   // 7칸 넘게 멀어지면 멈춰서 기다린다
    ENGINE.setMarker(s.mark);
    updateHud();
  }

  var fittingInside = false;
  function onWorldTick(){
    if(ENGINE) { var fp=ENGINE.places().fittingRoom, pos=ENGINE.playerPos();
      var inside=ENGINE.mode()==='clothing'&&fp&&Math.abs(pos.x-fp.x)<.66&&pos.z>fp.z-.62&&pos.z<fp.z+.7;
      if(inside&&!fittingInside&&!worldBlocked())window.Wardrobe?.open('shop'); fittingInside=!!inside;
    }
    var t = state.tour;
    if(!t || t.arrived || t.intro || !ENGINE) return;
    var g = ENGINE.guidePos(), p = ENGINE.playerPos();
    if(!g || ENGINE.guideMoving()) return;
    if(Math.hypot(p.x - g.x, p.z - g.z) < 2.9){
      t.arrived = true; ENGINE.stopAuto(); updateHud();
      var b = hud("tour-next") || hud("tour-chief"); if(b) b.focus({ preventScroll: true });
    }
  }

  function tourAdvance(){
    var t = state.tour; if(!t || !t.arrived) return;
    if(tourStop().final){
      // 이장님과 인사하는 동안에도 루미는 옆에 있다. 대화가 끝나면 루미가 마무리 인사를 한다
      state.tour = null; state.tourOutro = true;
      ENGINE.setMarker(null); ENGINE.stopAuto();
      updateHud(); openNpc("chief"); return;
    }
    t.i += 1; goStop();
  }

  function followLumi(){
    var t = state.tour; if(!t || t.arrived) return;
    var s = t.walkTarget; ENGINE.autoWalkTo(s.x, s.z + 1.4);
    drawTour.key = ""; updateHud();
  }

  // 투어 그만하기 — 루미가 인사하고 카페로 간다
  function endTour(){
    if(!state.tour) return;
    state.tour = null;
    ENGINE.setMarker(null); ENGINE.stopAuto();
    updateHud();
    showLumiOutro("skip");
  }

  var OUTRO = {
    done1:{ text:"첫 퀘스트 완료! 🎉 이장님 좋으시지? 오늘 마을 같이 돌아 줘서 고마워.", options:[{ label:"나도 고마워!", next:"done2" }] },
    done2:{ text:"난 카페 앞에 있을게. 심심하거나 이야기하고 싶을 때 언제든 와. 미션방에 2단계 퀘스트도 기다리고 있어!", options:[{ label:"응, 또 보자!", next:"END" }] },
    skip1:{ text:"알겠어, 여기까지 하자! 나머지는 천천히 둘러봐도 돼. 첫 퀘스트는 분수 옆 마을이장님께 인사하기야. 난 카페 앞에 있을게!", options:[{ label:"응, 고마워!", next:"END" }] }
  };
  function showLumiOutro(kind){ renderLumiOutro(kind === "skip" ? "skip1" : "done1"); }
  function renderLumiOutro(key){
    var old = document.getElementById("tut-backdrop"); if(old) old.remove();
    if(key === "END"){ lumiGoHome(); return; }
    var node = OUTRO[key];
    var back = document.createElement("div");
    back.className = "modal-backdrop"; back.id = "tut-backdrop";
    back.innerHTML =
      '<div class="npc-modal pixel-panel" role="dialog" aria-label="루미와의 대화">' +
        '<div class="npc-modal-header"><span class="npc-modal-emoji" style="background:#B56CC0">🌱</span>' +
        '<div><div class="npc-modal-name">루미</div><div class="npc-modal-disclaimer">AI 친구 · 사람 상담사는 아니야</div></div></div>' +
        '<p class="npc-modal-text">' + esc(node.text) + '</p>' +
        '<div class="npc-modal-options">' + node.options.map(function(o, i){ return '<button class="btn btn-option" data-oopt="' + i + '">' + esc(o.label) + '</button>'; }).join("") + '</div>' +
      '</div>';
    document.body.appendChild(back);
    Array.prototype.forEach.call(back.querySelectorAll("[data-oopt]"), function(b){
      b.addEventListener("click", function(){ renderLumiOutro(node.options[Number(b.getAttribute("data-oopt"))].next); });
    });
    var f = back.querySelector("[data-oopt]"); if(f) f.focus();
  }
  function lumiGoHome(){
    var E = ENGINE, L = E.places().lumi;
    E.guideWalk(L.x, L.z, function(){ E.guideHide(); E.setNpcVisible("psych", true); }, { speed: 3.6 });
    updateHud();
  }

  function drawTour(){
    var panel = hud("tour-panel"), t = state.tour;
    if(!t || !ENGINE || !ENGINE.isRunning()){ panel.hidden = true; drawTour.key = ""; return; }
    panel.hidden = false;
    var key = t.i + "|" + t.arrived + "|" + ENGINE.isAuto() + "|" + !!t.intro;
    if(key === drawTour.key) return;      // 같은 내용이면 다시 그리지 않는다(버튼 포커스 유지)
    drawTour.key = key;
    var stop = tourStop(), c = tctx(), n = t.route.length;
    var dots = t.route.map(function(k, i){ return '<span class="tour-dot' + (i < t.i ? " done" : i === t.i ? " now" : "") + '" title="' + esc(TOUR_STOPS[k].label) + '"></span>'; }).join("");
    var body, btns;
    if(t.intro){
      body = t.route.length === 1 ? "짜잔, 여기가 우리 이음 마을이야! 이장님은 분수 옆에 계셔. 내가 앞장설 테니까 따라와!" : "짜잔, 여기가 우리 이음 마을이야! 내가 앞장설 테니까 잘 따라와.";
      btns = "";
    } else if(!t.arrived){
      var lead = (t.i === 1 && GOAL_FIRST[c.goal] === t.route[1]) ? "네가 해보고 싶다던 거 하기 좋은 곳부터! " : "";
      body = lead + stop.go + " 금색 표시 쪽으로 가는 나를 따라와 줘. 너무 멀어지면 기다릴게!";
      btns = '<button type="button" id="tour-follow">' + (ENGINE.isAuto() ? "따라가는 중…" : "🚶 루미 따라가기") + '</button>';
    } else {
      body = stop.text(c);
      btns = stop.final ? '<button type="button" class="primary" id="tour-chief">🎩 이장님께 인사하기 (E)</button>'
                        : '<button type="button" class="primary" id="tour-next">다음 장소로 (E)</button>';
    }
    panel.innerHTML =
      '<div class="tour-head"><span class="who" style="background:#B56CC0">🌱 루미</span><span class="tour-count">' + (t.i + 1) + ' / ' + n + ' · ' + esc(stop.label) + '</span></div>' +
      '<div class="tour-dots">' + dots + '</div>' +
      '<p class="line">' + esc(body) + '</p>' +
      '<div class="row"><button type="button" id="tour-skip">투어 그만하기</button>' + btns + '</div>';
    var f = hud("tour-follow"); if(f) f.addEventListener("click", followLumi);
    var nx = hud("tour-next"); if(nx) nx.addEventListener("click", tourAdvance);
    var ch = hud("tour-chief"); if(ch) ch.addEventListener("click", tourAdvance);
    hud("tour-skip").addEventListener("click", function(){ endTour(); });
  }

  // HUD 버튼 (한 번만 연결)
  (function bindHud(){
    hud("hud-act").addEventListener("click", function(){ onWorldAction(state.near); });
    hud("hud-view").addEventListener("click", function(){ if(ENGINE) ENGINE.resetView(); });
    // 화질·로그아웃 버튼은 휴대폰 → 설정으로 옮겼다(ui.js)
    hud("rm-custom").addEventListener("click", openCustomizer);
    hud("rm-replay").addEventListener("click", function(){ if(state.room && state.room.phase === "free") lumiEntersRoom(); });
    hud("rm-out").addEventListener("click", function(){ doorAction("room-door"); });
  })();

  // 휴대폰·지도·설정·코코 알림 (ui.js) — 앱 기능을 여기서 넘겨준다
  var economy = null;
  function getEconomy(){
    var uid = state.session && state.session.user.id;
    if(!uid || !window.OnlineEconomy) return null;
    if(!economy || economy.userId !== uid){
      if(economy) economy.destroy();
      economy = window.OnlineEconomy.create({sb:sb,userId:uid});
      var lastAppearance = null;
      economy.subscribe(function(){ var av = currentAvatar() || presetAvatar('calm','#4caf6e',nick()); var signature = JSON.stringify(av); if(ENGINE && ENGINE.isRunning() && signature !== lastAppearance){ lastAppearance = signature; ENGINE.setAvatar(av); } });
      if(window.Achievements) window.Achievements.attach({sb:sb,userId:uid,economy:economy,toast:showToast});
      economy.initialize();
    }
    return economy;
  }
  if(window.Wardrobe) window.Wardrobe.init({engine:function(){return ENGINE;},economy:getEconomy,baseAvatar:function(){return currentAvatar(true)||presetAvatar('calm','#4caf6e',nick());},tutorial:function(){return !!state.tour||(state.view==='room'&&state.room&&state.room.phase!=='free');},toast:showToast});
  window.FishShop?.init({engine:function(){return ENGINE;},economy:getEconomy,toast:showToast});
  var CONTACT_ORDER = ["psych","coco","chief","policy","job"];
  if(window.WorldUI) window.WorldUI.init({
    sb: sb,
    userId: function(){ return state.session ? state.session.user.id : null; },
    economy: getEconomy,
    nickname: nick,
    feedback: function(){ return state.feedback; },
    npcs: function(){
      return CONTACT_ORDER.map(function(id){ return NPCS.filter(function(n){ return n.id === id; })[0]; })
        .filter(Boolean).map(function(n){ return { id: n.id, name: n.name, emoji: n.emoji, color: n.color }; });
    },
    busy: function(){ return dialogOpen() || !!(window.MarketUI && window.MarketUI.isTravelling()); },
    openNpc: openNpc,
    teleport: function(spawn, facing){
      if(state.tour || !ENGINE || (window.MarketUI && window.MarketUI.isTravelling())) return false;
      state.near = null; state.spawn = spawn; state.spawnFacing = facing; state.view = ["market", "bank", "clothing"].indexOf(ENGINE.mode()) >= 0 ? "market" : "plaza"; render();
      return true;
    },
    openMissionRoom: function(){ if(ENGINE) state.spawn = ENGINE.places().mission; loadMissionRoom(); },
    openClubRoom: function(){ if(ENGINE) state.spawn = ENGINE.places().club; loadClubRoom(); },
    logout: logout,
    toast: showToast,
    onKeysChanged: updateHud
  });

  if(window.MarketUI) window.MarketUI.init({
    economy: getEconomy,
    engine: function(){ return ENGINE; },
    nickname: nick,
    portrait: function(){
      var image = ENGINE && ENGINE.avatarPortrait(); if(image) return image;
      var av = Object.assign({}, currentAvatar() || presetAvatar("calm", "#4caf6e", nick()));
      ["skin", "hairColor", "outfit"].forEach(function(k){ if(!/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(av[k] || "")) av[k] = k === "skin" ? "#F6D7BD" : k === "hairColor" ? "#2b2b2b" : "#4caf6e"; });
      return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(avatarSvg(av, 96).replace('viewBox="0 0 64 64"', 'viewBox="6 0 52 49"'));
    },
    blocked: dialogOpen,
    tutorial: function(){ return !!state.tour || (state.view === "room" && state.room && state.room.phase !== "free"); },
    arrive: function(mode, spawn){ state.near = null; state.spawn = spawn; state.view = mode === "market" ? "market" : "plaza"; render(); },
    refresh: updateHud,
    toast: showToast
  });

  // 테스트·디버그용 (콘솔에서 __sw().engine 등으로 확인)
  window.__sw = function(){ return { state: state, engine: ENGINE, economy: economy, openRoom: openRoom, openNpc: openNpc }; };

  // ---------------- ④ 루미의 월드 소개 (대본형, LLM 없음) ----------------
  function tctx(){ return state.tutorialCtx || { mood:null, goal: state.profile && state.profile.join_goal, interests: (state.profile && state.profile.interests) || [] }; }
  function nick(){ return (state.profile && state.profile.nickname) || "주민"; }

  var TUT = {
    hello:{ text:function(c){
        var m = { relaxed:" 오늘 표정이 여유로워 보여서 나도 기분 좋다!", busy:" 바쁜 와중에 와줘서 고마워. 소개는 짧게 할게!",
                  tired:" 천천히 둘러봐도 돼. 여기선 서두를 일이 하나도 없어." }[c.mood] || " 편하게 둘러보면 돼.";
        return "똑똑! 일어났구나, " + nick() + "! 나는 루미야. 이 마을에 온 걸 환영해 🌱" + m; },
      options:[{label:"안녕, 루미!", next:"about"}] },
    about:{ details:true,
      text:"먼저 나를 소개할게. 나는 AI 친구라서 사람 상담사는 아니야. 우리가 나눈 말은 저장하지 않아. 대화 분위기만 이름 없이 모아서, 우리 동네에 어떤 모임이나 지원이 있으면 좋을지 찾는 데 써. 혹시 더 큰 도움이 필요해 보이면, 믿을 만한 곳을 같이 찾아볼게.",
      options:[{label:"응, 알겠어", next:"choose"},{label:"마을 소개는 나중에 들을래", next:"skip"}] },
    choose:{ text:function(c){
        return { rest:"쉬러 왔구나! 그럼 쉬기 좋은 곳부터 보여줄게.", talk:"이야기 나누고 싶구나. 그럼 내가 있는 곳부터 보여줄게!",
                 meet:"새로운 사람을 만나고 싶구나! 사람들이 모이는 곳부터 보여줄게.", info:"필요한 정보가 있구나. 그럼 도와줄 친구가 있는 곳부터 보여줄게." }[c.goal]
          || "그럼 마을 한 바퀴 같이 돌아보자!"; },
      options:[{label:"좋아!", next:"tourGo"}] },
    tourGo:{ text:"말로 설명하는 것보다 같이 걸어보는 게 빠르지! 나랑 같이 나가 보자 🚪 내가 앞장설 테니까 따라와.",
      options:[{label:"좋아, 가자!", next:"TOUR"}] },
    skip:{ text:"알겠어! 마을 구경은 나중에 해도 돼. 그래도 첫 퀘스트는 같이 하자 — 광장에 계신 마을이장님께 인사하러 가는 거야. 내가 데려다줄게!",
      options:[{label:"좋아, 같이 가자", next:"TOUR_SHORT"}] }
  };

  function openTutorial(){ state.room.dialog = "hello"; state.room.phase = "talk"; updateHud(); renderTutorial(); }

  function renderTutorial(){
    var old = document.getElementById("tut-backdrop"); if(old) old.remove();
    var key = state.room.dialog;
    if(key === "TOUR"){ startTour(false); return; }
    if(key === "TOUR_SHORT"){ startTour(true); return; }
    if(!key || key === "END"){
      state.room.dialog = null; state.room.phase = "free";
      if(ENGINE){ var P = ENGINE.places(); ENGINE.guideWalk(P.roomDoor.x, P.roomDoor.z, function(){ ENGINE.guideHide(); }, { direct: true, speed: 2.6 }); }
      updateHud(); return;
    }
    var node = TUT[key], c = tctx();
    var text = typeof node.text === "function" ? node.text(c) : node.text;
    var extra = "";
    if(node.details) extra = '<details class="tut-details"><summary>ⓘ 자세히 보기</summary><ul>' +
      '<li>지금 체험판의 루미는 정해진 대본으로 대답해요. 정식 버전에서는 루미의 답을 AI(OpenAI)가 만들고, 답을 만들기 위해 입력한 글이 AI 서비스로 전달돼요.</li>' +
      '<li>전화번호·이메일 같은 개인정보는 보내기 전에 가려요.</li>' +
      '<li>대화 원문은 저장하지 않아요. "요즘 기운이 없음" 같은 분위기 표시만 이름 없이 남고, 같은 동네·또래가 충분히 모였을 때만 통계로 쓰여요.</li>' +
      '<li>이 통계는 지자체가 청년 모임·지원 프로그램을 준비하는 데 쓰여요.</li></ul></details>';
    var back = document.createElement("div");
    back.className = "modal-backdrop"; back.id = "tut-backdrop";
    back.innerHTML =
      '<div class="npc-modal pixel-panel" role="dialog" aria-label="루미와의 대화">' +
        '<div class="npc-modal-header">' +
          '<span class="npc-modal-emoji" style="background:#B56CC0">🌱</span>' +
          '<div><div class="npc-modal-name">루미</div><div class="npc-modal-disclaimer">AI 친구 · 사람 상담사는 아니야</div></div>' +
        '</div>' +
        '<p class="npc-modal-text">'+esc(text)+'</p>' + extra +
        '<div class="npc-modal-options">' + node.options.map(function(o,i){
          return '<button class="btn btn-option" data-topt="'+i+'">'+esc(o.label)+'</button>'; }).join("") + '</div>' +
      '</div>';
    document.body.appendChild(back);
    Array.prototype.forEach.call(back.querySelectorAll("[data-topt]"), function(b){
      b.addEventListener("click", function(){ state.room.dialog = node.options[Number(b.getAttribute("data-topt"))].next; renderTutorial(); });
    });
    var first = back.querySelector("[data-topt]"); if(first) first.focus();
  }

  // 1단계 첫 퀘스트 — 광장에서 마을이장에게 인사하면 '광장 방문하기' 완료
  function completeFirstQuest(){
    if(state.firstQuestDone) return;
    state.firstQuestDone = true;
    showToast("🎉 첫 퀘스트 완료 — 이장님께 인사하기");
    playSound("missionComplete");
    sb.from("missions").select("id,title").eq("title","광장 방문하기").maybeSingle().then(function(res){
      if(!res || res.error || !res.data) return;   // 03_world_update.sql 적용 전이면 기록 없이 넘어간다
      sb.from("mission_progress").upsert(
        { user_id: state.session.user.id, mission_id: res.data.id, status:"done", completed_at: new Date().toISOString() },
        { onConflict: "user_id,mission_id" }
      ).then(function(r){ if(r.error) console.warn("퀘스트 기록 실패:", r.error.message); });
    });
  }

  // 효과음 (sounds.js) — 파일이 없거나 소리가 막혀도 게임은 그대로
  function playSound(name){ if(window.Sound) window.Sound.play(name); }

  function showToast(msg){
    var t = document.createElement("div"); t.className = "sw-toast"; t.setAttribute("role","status"); t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(function(){ t.remove(); }, 3200);
  }

  // ---------------- topbar ----------------
  function topbarHtml(title){
    var nick = state.profile ? '<span class="topbar-nick">'+esc(state.profile.nickname)+'님</span>' : "";
    return '<div class="topbar"><div class="topbar-title"><span>🌱</span><span>'+esc(title)+'</span></div>' +
      '<div class="topbar-right">'+nick+'<button class="btn-ghost" id="btn-logout">로그아웃</button></div></div>';
  }
  function bindTopbar(){
    el("#btn-logout").addEventListener("click", function(){
      logout();
    });
  }
  function logout(){
    window.FishShop?.close(); window.Wardrobe?.close(); window.Achievements?.reset(); fittingInside=false;
    if(economy) economy.destroy(); economy = null;
    if(window.MarketUI) window.MarketUI.reset();
    state.worldReturn = null; state.spawn = null; state.spawnFacing = null;
    if(state.tour && state.tour.walking) clearInterval(state.tour.walking); state.tour = null;
    if(window.WorldUI) window.WorldUI.reset();
    hideWorld();
    sb.auth.signOut().then(function(){ state.session = null; state.profile = null; state.view = "login"; render(); });
  }

  // ---------------- npc modal ----------------
  function openNpc(id){
    if(state.tour){ showToast("투어 중이에요 — 루미를 따라가 보세요"); return; }
    if(id === "coco"){ openCoco(); return; }
    if(id === "chief" && window.Chief){ openChief(); return; }
    state.near = null;
    state.activeNpc = NPCS.filter(function(n){ return n.id===id; })[0];
    state.npcNode = "root";
    state.npcSession = { npc_type: id, started_at: new Date().toISOString(), tags: {}, maxSev: 0, turns: 0, crisisReported: false };
    renderNpcModal();
  }

  // 코코 — 추천 계산은 DB(recommend_activities), 화면은 coco/coco.js. 자유 입력·LLM 없음
  var cocoDialog = null;
  function openCoco(){
    if(cocoDialog) return;
    if(!window.Coco){ showToast("코코가 잠깐 자리를 비웠어요 (coco/coco.js를 불러오지 못함)"); return; }
    state.near = null;
    cocoDialog = window.Coco.open({
      sb: sb,
      onOpenClub: function(){
        if(cocoDialog){ var d = cocoDialog; cocoDialog = null; d.close(); }
        state.spawn = ENGINE.places().club;
        loadClubRoom();
      },
      onClose: function(){ cocoDialog = null; }
    });
  }

  // 마을이장 — 이벤트는 risk_agent/chief.py가 정하고 담당자가 승인한 것만 보인다(world_events_public).
  // 대화를 마치면 대본 트리 때와 똑같이 첫 퀘스트 완료 + (튜토리얼 마지막이면) 루미 마무리 인사
  var chiefDialog = null;
  function openChief(){
    if(chiefDialog) return;
    state.near = null;
    chiefDialog = window.Chief.open({
      sb: sb,
      nickname: state.profile && state.profile.nickname,
      onClose: function(){
        chiefDialog = null;
        completeFirstQuest();
        if(state.tourOutro){ state.tourOutro = false; setTimeout(function(){ showLumiOutro("done"); }, 350); }
      }
    });
  }

  // 대화 1회를 npc_sessions에 남긴다 — 원문 없이 신호 수치만. 선택을 한 번도 안 했으면 남기지 않는다.
  function saveNpcSession(){
    var sess = state.npcSession;
    state.npcSession = null;
    if(!sess || sess.turns === 0 || !state.session) return;
    if(state.activeNpc && state.activeNpc.noSignal) return;
    var tags = Object.keys(sess.tags);
    sb.from("npc_sessions").insert({
      npc_type: sess.npc_type,
      started_at: sess.started_at,
      ended_at: new Date().toISOString(),
      risk_keyword_count: tags.length,
      severity_score: Math.round(sess.maxSev * 100) / 100,
      keyword_tags: tags
    }).then(function(res){
      if(res.error) console.warn("대화 신호 저장 실패:", res.error.message);
    });
  }

  function closeNpc(){
    var wasChief = state.activeNpc && state.activeNpc.id === "chief";
    saveNpcSession();
    if(wasChief) completeFirstQuest();
    if(wasChief && state.tourOutro){ state.tourOutro = false; setTimeout(function(){ showLumiOutro("done"); }, 350); }
    state.activeNpc = null;
    var existing = document.getElementById("npc-modal-backdrop");
    if(existing) existing.remove();
  }

  function chooseOption(opt){
    var sess = state.npcSession;
    if(sess){
      sess.turns += 1;
      if(opt.signal){
        (opt.signal.tags || []).forEach(function(t){ sess.tags[t] = true; });
        sess.maxSev = Math.max(sess.maxSev, opt.signal.severity || 0);
        // 가드레일(8-1) — 위기 발화는 모든 NPC 공통으로 즉시 기록. 지역·NPC 종류만 남고 user_id는 저장하지 않는다.
        if(opt.signal.crisis && !sess.crisisReported){
          sess.crisisReported = true;
          sb.rpc("report_crisis", { p_npc_type: sess.npc_type }).then(function(res){
            if(res.error) console.warn("위기 기록 실패:", res.error.message);
          });
        }
      }
    }
    state.npcNode = opt.next;
    renderNpcModal();
  }

  function renderNpcModal(){
    var existing = document.getElementById("npc-modal-backdrop");
    if(existing) existing.remove();
    var npc = state.activeNpc;
    var node = npc.tree[state.npcNode];
    var optionsHtml = node.options.length
      ? node.options.map(function(o,i){ return '<button class="btn btn-option" data-opt="'+i+'">'+esc(o.label)+'</button>'; }).join("")
      : '<button class="btn btn-primary" id="npc-bye">대화 마치기</button>';
    var disclaimerHtml = npc.disclaimer ? '<div class="npc-modal-disclaimer">'+esc(npc.disclaimer)+'</div>' : "";
    var crisisHtml = node.crisis
      ? '<div class="crisis-box" role="alert">' +
          '<div class="crisis-title">지금 바로 이야기할 수 있는 곳</div>' +
          '<div class="crisis-line"><b>자살예방 상담전화</b> <span class="crisis-num">109</span> <span class="crisis-sub">24시간 · 무료</span></div>' +
          '<div class="crisis-line"><b>정신건강 상담전화</b> <span class="crisis-num">1577-0199</span></div>' +
          '<div class="crisis-sub">' + (npc.id === "psych" ? "위급하면 바로 112나 119에 연락해." : "위급하면 112 또는 119에 바로 연락하세요.") + '</div>' +
        '</div>'
      : "";
    var backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop"; backdrop.id = "npc-modal-backdrop";
    backdrop.innerHTML =
      '<div class="npc-modal pixel-panel" style="border-color:'+npc.color+'">' +
        '<div class="npc-modal-header">' +
          '<span class="npc-modal-emoji" style="background:'+npc.color+'">'+npc.emoji+'</span>' +
          '<div><div class="npc-modal-name">'+esc(npc.name)+'</div>'+disclaimerHtml+'</div>' +
          '<button class="btn-ghost npc-modal-close" id="npc-close">✕</button>' +
        '</div>' +
        '<p class="npc-modal-text">'+esc(typeof node.text === "function" ? node.text() : node.text)+'</p>' +
        crisisHtml +
        '<div class="npc-modal-options">'+optionsHtml+'</div>' +
      '</div>';
    backdrop.addEventListener("click", function(e){ if(e.target===backdrop){ closeNpc(); } });
    document.body.appendChild(backdrop);
    el("#npc-close", backdrop).addEventListener("click", closeNpc);
    var byeBtn = el("#npc-bye", backdrop);
    if(byeBtn) byeBtn.addEventListener("click", closeNpc);
    Array.prototype.forEach.call(backdrop.querySelectorAll("[data-opt]"), function(btn){
      btn.addEventListener("click", function(){ chooseOption(node.options[Number(btn.getAttribute("data-opt"))]); });
    });
  }

  // ---------------- mission room ----------------
  function loadMissionRoom(){
    rememberWorldReturn();
    state.view = "mission";
    render();
    Promise.all([
      sb.from("missions").select("*").eq("is_active", true).order("id"),
      sb.from("mission_progress").select("*").eq("user_id", state.session.user.id)
    ]).then(function(results){
      state.missions = results[0].data || [];
      var map = {};
      (results[1].data || []).forEach(function(r){ map[r.mission_id] = r; });
      state.progress = map;
      renderMissionRoom();
    });
  }

  function renderMissionRoom(){
    app.innerHTML = "";
    var itemsHtml;
    if(state.missions === undefined){
      itemsHtml = "<p>불러오는 중…</p>";
    } else if(state.missions.length === 0){
      itemsHtml = "<p>등록된 미션이 없어요.</p>";
    } else {
      // ⑩ 환류 — 에이전트가 추천한 미션을 맨 위로 올리고 '추천' 표시
      var prio = (state.feedback && state.feedback.priority_missions) || [];
      var ordered = state.missions.slice().sort(function(a,b){
        var ia = prio.indexOf(a.title), ib = prio.indexOf(b.title);
        ia = ia < 0 ? 99 : ia; ib = ib < 0 ? 99 : ib;
        return ia - ib || a.id - b.id;
      });
      itemsHtml = '<ul class="mission-list">' + ordered.map(function(m){
        var p = state.progress[m.id];
        var isRec = prio.indexOf(m.title) >= 0;
        var actionHtml;
        if(p && p.status === "done") actionHtml = '<span class="badge-done">완료됨 ✅</span>';
        else if(p) actionHtml = '<button class="btn btn-primary btn-auto" data-complete="'+m.id+'">완료하기</button>';
        else actionHtml = '<button class="btn btn-option btn-auto" data-join="'+m.id+'">참여하기</button>';
        return '<li class="mission-item pixel-panel"><div class="mission-item-main">' +
          '<div class="mission-title">'+esc(m.title)+'<span class="mission-reward">+'+m.reward_point+'P</span>' +
            (isRec ? '<span class="mission-rec">추천</span>' : '') + '</div>' +
          (m.description ? '<p class="mission-desc">'+esc(m.description)+'</p>' : '') +
          '</div><div class="mission-actions">'+actionHtml+'</div></li>';
      }).join("") + '</ul>';
    }
    app.appendChild(h(
      topbarHtml("미션방") +
      '<div class="room-wrap">' +
        '<button class="btn-ghost" id="btn-back">← 광장으로</button>' +
        '<p class="room-desc">꾸준히 사회 활동을 이어갈 수 있도록 작은 미션들을 준비했어요. 완료하면 포인트를 받을 수 있어요.</p>' +
        itemsHtml +
      '</div>'
    ));
    bindTopbar();
    el("#btn-back").textContent = state.worldReturn ? "← 시장으로 돌아가기" : "← 광장으로 돌아가기";
    el("#btn-back").addEventListener("click", returnFromRoomScreen);
    Array.prototype.forEach.call(app.querySelectorAll("[data-join]"), function(btn){
      btn.addEventListener("click", function(){
        var id = Number(btn.getAttribute("data-join"));
        btn.disabled = true;
        sb.from("mission_progress").insert({ user_id: state.session.user.id, mission_id: id, status:"in_progress" })
          .then(function(res){ if(res.error){ alert("참여에 실패했습니다."); } loadMissionRoom(); });
      });
    });
    Array.prototype.forEach.call(app.querySelectorAll("[data-complete]"), function(btn){
      btn.addEventListener("click", function(){
        var id = Number(btn.getAttribute("data-complete"));
        btn.disabled = true;
        sb.from("mission_progress").update({ status:"done", completed_at: new Date().toISOString() })
          .eq("user_id", state.session.user.id).eq("mission_id", id)
          .then(function(res){ if(res.error){ alert("완료 처리에 실패했습니다."); } else playSound("missionComplete"); loadMissionRoom(); });
      });
    });
  }

  // ---------------- club room ----------------
  function loadClubRoom(){
    rememberWorldReturn();
    state.view = "club";
    render();
    Promise.all([
      sb.from("clubs").select("*, member_count:club_members(count)").order("created_at", { ascending:false }),
      sb.from("club_members").select("club_id").eq("user_id", state.session.user.id)
    ]).then(function(results){
      state.clubs = results[0].data || [];
      var ids = {};
      (results[1].data || []).forEach(function(r){ ids[r.club_id] = true; });
      state.myClubIds = ids;
      renderClubRoom();
    });
  }

  function renderClubRoom(){
    app.innerHTML = "";
    var catOptions = CATEGORIES.map(function(c){ return '<option value="'+c+'">'+c+'</option>'; }).join("");
    var formHtml = state.showClubForm ? (
      '<form class="pixel-panel club-form" id="club-form">' +
        '<label>동아리 이름<input id="cf-name" maxlength="30" placeholder="예: 퇴근 후 러닝 크루"></label>' +
        '<label>카테고리<select id="cf-category">'+catOptions+'</select></label>' +
        '<label>소개<textarea id="cf-desc" maxlength="200" rows="3" placeholder="어떤 모임인지 짧게 소개해 주세요"></textarea></label>' +
        '<button class="btn btn-primary btn-auto" type="submit">개설하기</button>' +
      '</form>'
    ) : "";
    var listHtml;
    if(state.clubs.length === 0){
      listHtml = "<p>아직 개설된 동아리가 없어요. 첫 동아리를 만들어 보세요!</p>";
    } else {
      listHtml = '<ul class="club-list">' + state.clubs.map(function(c){
        var joined = !!state.myClubIds[c.id];
        var count = (c.member_count && c.member_count[0] && c.member_count[0].count) || 0;
        var actionHtml = joined ? '<span class="badge-done">가입됨 ✅</span>' : '<button class="btn btn-option btn-auto" data-join-club="'+c.id+'">가입하기</button>';
        return '<li class="club-item pixel-panel"><div class="club-item-main">' +
          '<div class="mission-title">'+esc(c.name)+'<span class="club-category">'+esc(c.category||"")+'</span></div>' +
          (c.description ? '<p class="mission-desc">'+esc(c.description)+'</p>' : '') +
          '<p class="club-member-count">멤버 '+count+'명</p>' +
          '</div><div class="mission-actions">'+actionHtml+'</div></li>';
      }).join("") + '</ul>';
    }
    app.appendChild(h(
      topbarHtml("동아리센터") +
      '<div class="room-wrap">' +
        '<button class="btn-ghost" id="btn-back">← 광장으로</button>' +
        '<div class="room-header-row"><p class="room-desc">관심사가 비슷한 사람들과 문화·공연·체육 활동을 함께 해보세요.</p>' +
        '<button class="btn btn-primary btn-auto" id="btn-toggle-form">'+(state.showClubForm?"닫기":"+ 동아리 개설")+'</button></div>' +
        formHtml + listHtml +
      '</div>'
    ));
    bindTopbar();
    el("#btn-back").textContent = state.worldReturn ? "← 시장으로 돌아가기" : "← 광장으로 돌아가기";
    el("#btn-back").addEventListener("click", returnFromRoomScreen);
    el("#btn-toggle-form").addEventListener("click", function(){ state.showClubForm = !state.showClubForm; renderClubRoom(); });
    var form = el("#club-form");
    if(form){
      form.addEventListener("submit", function(ev){
        ev.preventDefault();
        var name = el("#cf-name").value.trim();
        if(!name){ alert("동아리 이름을 입력해 주세요."); return; }
        sb.from("clubs").insert({
          name: name, category: el("#cf-category").value,
          description: el("#cf-desc").value.trim() || null,
          owner_id: state.session.user.id
        }).select().single().then(function(res){
          if(res.error || !res.data){ alert("동아리 개설에 실패했습니다."); return; }
          sb.from("club_members").insert({ club_id: res.data.id, user_id: state.session.user.id }).then(function(){
            state.showClubForm = false;
            loadClubRoom();
          });
        });
      });
    }
    Array.prototype.forEach.call(app.querySelectorAll("[data-join-club]"), function(btn){
      btn.addEventListener("click", function(){
        var id = Number(btn.getAttribute("data-join-club"));
        btn.disabled = true;
        sb.from("club_members").insert({ club_id: id, user_id: state.session.user.id })
          .then(function(res){ if(res.error){ alert("가입에 실패했습니다."); } loadClubRoom(); });
      });
    });
  }

  render();
})();

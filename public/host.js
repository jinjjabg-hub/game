// 진행 화면: 서버가 보내 주는 상태(state)를 그대로 그린다. 스페이스바 = 다음.
const code = (new URLSearchParams(location.search).get("r") || "").toLowerCase();
const key = (JSON.parse(localStorage.getItem("hanpan_rooms") || "{}"))[code];
const $ = (id) => document.getElementById(id);
const stage = $("stage");
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const GAMES = [
  { id: "tap", ico: "👆", name: "연타 대결", sub: "10초 동안 화면을 최대한 많이 터치" },
  { id: "shake", ico: "📳", name: "흔들어라", sub: "10초 동안 폰을 힘껏 흔들기" },
  { id: "stop10", ico: "⏱️", name: "딱 10초", sub: "감으로 정확히 10초에 멈추기" },
  { id: "quiz", ico: "💡", name: "BNI 퀴즈", sub: "빨리 맞힐수록 높은 점수" },
  { id: "mole", ico: "🐹", name: "두더지 잡기", sub: "20초 동안 튀어나온 두더지 터치" },
  { id: "order", ico: "🔢", name: "숫자 순서", sub: "30초 동안 1부터 차례대로 터치" },
  { id: "oddcolor", ico: "🎨", name: "다른 색 찾기", sub: "30초 동안 색이 다른 칸 찾기" },
  { id: "math", ico: "🧮", name: "암산왕", sub: "30초 동안 계산 문제 풀기" },
  { id: "stroop", ico: "🌈", name: "색깔 함정", sub: "30초 동안 글자의 '색' 고르기" },
];
const gameOf = (id) => GAMES.find((g) => g.id === id) || {};

let st = null, ws = null, offset = 0, sel = 0, viewKey = "", revealed = 0;
const now = () => Date.now() + offset; // 서버 시계 기준 현재 시각
const colorOf = (teamId) => "c" + ((parseInt(teamId.slice(1), 10) - 1) % 12);
const teamOf = (id) => st.teams.find((t) => t.id === id) || { name: "?" };
const send = (o) => ws && ws.readyState === 1 && ws.send(JSON.stringify(o));

function connect() {
  ws = new WebSocket((location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/ws");
  ws.onopen = () => { $("net").textContent = ""; send({ t: "host", code, key }); };
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.t === "error") { stage.innerHTML = `<div class="center"><div class="title">${esc(m.error)}</div><p><a class="btn" href="./">처음으로</a></p></div>`; ws.onclose = null; return; }
    offset = m.now - Date.now();
    st = m;
    render();
  };
  ws.onclose = () => { $("net").textContent = "연결이 끊겨 다시 연결 중…"; setTimeout(connect, 1000); };
}

/* ───────── 화면 그리기 ───────── */
function render() {
  const r = st.round;
  // 화면 구조가 바뀔 때만 통째로 다시 그리고, 그 외엔 숫자만 갱신
  const k = [st.phase, r && r.game, r && r.quiz && r.quiz.qi, r && r.quiz && r.quiz.reveal, st.teams.map((t) => t.name).join(), st.phase === "lobby" && st.teams.map((t) => t.total + ":" + t.n).join() + st.quiz.length].join("|");
  if (k !== viewKey) {
    viewKey = k;
    if (st.phase === "final") revealed = 0;
    stage.innerHTML = ({ lobby, countdown, playing, result, final })[st.phase]();
    $("hint").innerHTML = ({
      lobby: "<kbd>←→</kbd> 게임 고르기 · <kbd>Space</kbd> 시작",
      countdown: "", result: "<kbd>Space</kbd> 대기실로",
      playing: r && r.game === "quiz" ? "<kbd>Space</kbd> 정답 공개 / 다음 문제" : r && r.game === "stop10" ? "<kbd>Space</kbd> 바로 마감" : "",
      final: "<kbd>Space</kbd> 한 팀씩 공개",
    })[st.phase];
  }
  update();
}

function boardHtml() {
  const rows = [...st.teams].sort((a, b) => b.total - a.total).map((t) => `
    <div class="trow ${colorOf(t.id)}"><span class="dot"></span><span class="nm">${esc(t.name)}</span>
      <span class="ph">📱${t.n}</span>
      <button class="adj" data-adj="${t.id}" data-d="-10">−10</button><button class="adj" data-adj="${t.id}" data-d="10">+10</button>
      <span>${t.total}</span></div>`).join("");
  return `<aside class="card board"><h3>종합 순위</h3>${rows}</aside>`;
}

function lobby() {
  const url = `${location.origin}/play?r=${code}`;
  return `
  <aside class="card join">
    <h3 style="font-size:2.6vh">📱 폰으로 QR 찍고 입장</h3>
    <img src="qr.svg?r=${code}" alt="참가 QR">
    <div class="code">${code.toUpperCase()}</div>
    <div class="url">${esc(url)}</div>
  </aside>
  <section class="mid">
    <div class="games">${GAMES.map((g, i) => `
      <button class="game ${i === sel ? "sel" : ""}" data-game="${g.id}"><span class="ico">${g.ico}</span>
        <span><b>${g.name}</b><small>${g.sub}${g.id === "quiz" ? ` · ${st.quiz.length}문제` : ""}</small></span><span class="num">${i + 1}</span></button>`).join("")}
    </div>
    <div class="tools">
      <button class="btn line small" id="bTeams">👥 팀 설정</button>
      <button class="btn line small" id="bQuiz">✏️ 퀴즈 문제 편집</button>
      <button class="btn line small" id="bReset">↺ 점수 초기화</button>
      <a class="btn line small" href="draw.html" target="_blank">🎁 경품 추첨</a>
      <button class="btn red small" id="bFinal" style="margin-left:auto">🏆 최종 발표</button>
    </div>
  </section>
  ${boardHtml()}`;
}

function countdown() {
  const g = gameOf(st.round.game);
  return `<div class="center"><div class="title">${g.ico} ${g.name}</div><div class="muted" style="font-size:3vh;font-weight:700">${g.sub}</div><div class="count" id="cnt">3</div></div>`;
}

function barsHtml() {
  return `<div class="bars" style="--n:${st.teams.length}">${st.teams.map((t) => `
    <div class="bar ${colorOf(t.id)}"><span class="nm">${esc(t.name)}</span><span class="track"><span class="fill" id="f_${t.id}" style="display:block"></span></span><span class="val" id="v_${t.id}">0</span></div>`).join("")}</div>`;
}

function playing() {
  const r = st.round, g = gameOf(r.game);
  if (r.game === "quiz" && r.quiz) {
    const q = r.quiz;
    return `<section class="quiz">
      <div class="race"><div class="top"><span class="title">💡 ${q.qi + 1} / ${q.total}</span><span class="hint" id="ans"></span><span class="timer" id="tm"></span></div></div>
      <div class="q">${esc(q.q)}</div>
      <div class="choices">${q.c.map((c, i) => `<div class="ch ${q.reveal ? (i === q.answer ? "ok" : "no") : ""}"><i>${i + 1}</i>${esc(c)}</div>`).join("")}</div>
    </section>${boardLive()}`;
  }
  return `<section class="race"><div class="top"><span class="title">${g.ico} ${g.name}</span><span class="timer" id="tm"></span></div>${barsHtml()}</section>`;
}

// 퀴즈 중 오른쪽에 보이는 실시간 점수
function boardLive() {
  return `<aside class="card board"><h3>이번 게임 점수</h3>${st.teams.map((t) => `
    <div class="trow ${colorOf(t.id)}"><span class="dot"></span><span class="nm">${esc(t.name)}</span><span id="v_${t.id}">0</span></div>`).join("")}</aside>`;
}

function detail(game, score) {
  if (game === "stop10") return `오차 ${((10000 - score) / 1000).toFixed(2)}초`;
  return score + (game === "tap" || game === "shake" ? "회" : game === "quiz" ? "점" : "개");
}

function result() {
  const L = st.last, g = gameOf(L.game);
  return `<section class="result" style="--n:${Math.max(4, L.rows.length)}">
    <div class="title" style="text-align:center">${g.ico} ${g.name} 결과</div>
    ${L.rows.length ? L.rows.map((x) => `<div class="rrow ${colorOf(x.teamId)}"><span class="rk">${x.rank}위</span><span class="nm">${esc(teamOf(x.teamId).name)}</span><span class="dt">${detail(L.game, x.score)}</span><span class="pt">+${x.pts}</span></div>`).join("") : `<p class="muted" style="text-align:center;font-size:3vh">참가한 팀이 없어요</p>`}
    <div style="text-align:center;margin-top:1vh"><button class="btn line small" id="bUndo">↩ 이 결과 취소</button></div>
  </section>`;
}

function final() {
  const rows = [...st.teams].sort((a, b) => b.total - a.total);
  let rank = 0;
  rows.forEach((t, i) => { rank = i > 0 && rows[i - 1].total === t.total ? rank : i + 1; t.rank = rank; });
  return `<section class="result" style="--n:${Math.max(4, rows.length)}">
    <div class="title" style="text-align:center">🏆 최종 순위 발표</div>
    ${rows.map((t, i) => `<div class="rrow hid ${colorOf(t.id)}" data-i="${i}"><span class="rk">${t.rank}위</span><span class="nm">${esc(t.name)}</span><span class="pt">${t.total}점</span></div>`).join("")}
    <div style="text-align:center;margin-top:1vh"><button class="btn line small" id="bBack">대기실로</button></div>
  </section>`;
}

// 꼴찌부터 한 팀씩 공개, 1위가 나오면 폭죽
function revealNext() {
  const rows = [...stage.querySelectorAll(".rrow")];
  if (revealed >= rows.length) return;
  const el = rows[rows.length - 1 - revealed];
  el.classList.remove("hid");
  revealed++;
  if (revealed === rows.length) { el.classList.add("win"); confetti(); }
}

/* ───────── 숫자·타이머 갱신 ───────── */
function update() {
  if (!st) return;
  const r = st.round;
  if (st.phase === "countdown") {
    const el = $("cnt");
    if (el) el.textContent = Math.max(1, Math.ceil((r.startsAt - now()) / 1000));
  }
  if (st.phase === "playing" && r) {
    const end = r.quiz ? r.quiz.endsAt : r.endsAt;
    const tm = $("tm");
    if (tm) tm.textContent = r.quiz && r.quiz.reveal ? "정답!" : Math.max(0, (end - now()) / 1000).toFixed(1);
    if (r.quiz && $("ans")) $("ans").textContent = `답한 폰 ${r.quiz.answered} / ${r.quiz.players}`;
    const live = r.live || {}, max = Math.max(1, ...Object.values(live));
    for (const t of st.teams) {
      const v = $("v_" + t.id), f = $("f_" + t.id);
      if (v) v.textContent = r.done ? (r.done[t.id] ? "멈춤!" : "…") : live[t.id] || 0;
      if (f) f.style.width = (r.done ? (r.done[t.id] ? 100 : 0) : ((live[t.id] || 0) / max) * 100) + "%";
    }
  }
}
setInterval(update, 100);

/* ───────── 조작 ───────── */
function startSelected() { send({ t: "start", game: GAMES[sel].id }); }

document.addEventListener("keydown", (e) => {
  if (!st || document.querySelector("dialog[open]")) return;
  if (st.phase === "lobby") {
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") { sel = (sel + (e.key === "ArrowRight" ? 1 : GAMES.length - 1)) % GAMES.length; viewKey = ""; render(); }
    const n = parseInt(e.key, 10);
    if (n >= 1 && n <= GAMES.length) { sel = n - 1; viewKey = ""; render(); }
  }
  if (e.code === "Space" || e.key === "Enter" || e.key === "PageDown") { // PPT 리모컨도 PageDown을 보낸다
    e.preventDefault();
    if (st.phase === "lobby") startSelected();
    else if (st.phase === "final") revealNext();
    else send({ t: "next" });
  }
});

stage.addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  if (b.dataset.game) { sel = GAMES.findIndex((g) => g.id === b.dataset.game); startSelected(); }
  else if (b.dataset.adj) send({ t: "adjust", teamId: b.dataset.adj, delta: Number(b.dataset.d) });
  else if (b.id === "bUndo") send({ t: "undo" });
  else if (b.id === "bFinal") send({ t: "final" });
  else if (b.id === "bBack") send({ t: "lobby" });
  else if (b.id === "bReset") { if (confirm("모든 팀 점수를 0으로 되돌릴까요?")) send({ t: "reset" }); }
  else if (b.id === "bTeams") { $("taTeams").value = st.teams.map((t) => t.name).join("\n"); $("dlgTeams").showModal(); }
  else if (b.id === "bQuiz") { $("taQuiz").value = st.quiz.map((q) => [q.q, ...q.c, q.a + 1].join(" | ")).join("\n"); $("dlgQuiz").showModal(); }
  b.blur(); // 버튼에 포커스가 남으면 스페이스바가 버튼을 다시 눌러 버린다
});

document.querySelectorAll("[data-close]").forEach((b) => (b.onclick = () => b.closest("dialog").close()));
$("saveTeams").onclick = () => {
  const names = $("taTeams").value.split("\n").map((s) => s.trim()).filter(Boolean);
  if (names.length) send({ t: "teams", names });
  $("dlgTeams").close();
};
$("saveQuiz").onclick = () => {
  const questions = [], bad = [];
  $("taQuiz").value.split("\n").forEach((line, i) => {
    if (!line.trim()) return;
    const p = line.split("|").map((s) => s.trim());
    const a = parseInt(p[p.length - 1], 10) - 1, c = p.slice(1, -1);
    if (p.length < 4 || !(a >= 0 && a < c.length)) bad.push(i + 1); else questions.push({ q: p[0], c, a });
  });
  if (bad.length) return alert(`${bad.join(", ")}번째 줄 형식을 확인해 주세요.\n예) 질문 | 보기1 | 보기2 | 보기3 | 보기4 | 2`);
  send({ t: "quiz", questions });
  $("dlgQuiz").close();
};

/* ───────── 폭죽 ───────── */
function confetti() {
  const cv = $("fx"), g = cv.getContext("2d");
  cv.width = innerWidth; cv.height = innerHeight;
  const cols = ["#cf2030", "#1f6feb", "#17a589", "#f2a900", "#8e44ad"];
  const ps = Array.from({ length: 220 }, () => ({
    x: Math.random() * cv.width, y: -20 - Math.random() * cv.height * 0.5, vx: (Math.random() - 0.5) * 4, vy: 2 + Math.random() * 5,
    s: 6 + Math.random() * 8, c: cols[(Math.random() * cols.length) | 0], r: Math.random() * 6,
  }));
  const t0 = performance.now();
  (function tick(t) {
    g.clearRect(0, 0, cv.width, cv.height);
    if (t - t0 > 6000) return;
    for (const p of ps) {
      p.x += p.vx; p.y += p.vy; p.r += 0.1;
      g.save(); g.translate(p.x, p.y); g.rotate(p.r); g.fillStyle = p.c; g.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2); g.restore();
    }
    requestAnimationFrame(tick);
  })(t0);
}

if (!key) stage.innerHTML = `<div class="center"><div class="title">이 브라우저에는 진행 권한이 없어요</div><p class="muted" style="margin:12px">행사를 만든 브라우저에서 열어 주세요.</p><a class="btn" href="./">처음으로</a></div>`;
else connect();

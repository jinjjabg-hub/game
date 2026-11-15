// 참가자 폰 화면: 팀 고르기 → 대기 → 게임 조작 → 결과
const code = (new URLSearchParams(location.search).get("r") || "").toLowerCase();
const $ = (id) => document.getElementById(id);
const view = $("view");
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// 폰마다 고유 번호를 기억해 두어, 새로고침·재접속해도 같은 참가자로 이어진다
let pid = localStorage.getItem("hanpan_pid");
if (!pid) { pid = Math.random().toString(36).slice(2) + Date.now().toString(36); localStorage.setItem("hanpan_pid", pid); }
const TEAM_KEY = "hanpan_team_" + code;

let st = null, ws = null, offset = 0, viewKey = "";
let score = 0, sent = -1, stopped = false, motionOn = false;
const now = () => Date.now() + offset;
const colorOf = (teamId) => "c" + ((parseInt(teamId.slice(1), 10) - 1) % 12);
const send = (o) => ws && ws.readyState === 1 && ws.send(JSON.stringify(o));
const myTeam = () => st && st.teams.find((t) => t.id === st.me.teamId);

function connect() {
  ws = new WebSocket((location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/ws");
  ws.onopen = () => { $("net").textContent = ""; send({ t: "join", code, pid, teamId: localStorage.getItem(TEAM_KEY) }); };
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.t === "error") { view.innerHTML = `<h2>${esc(m.error)}</h2><p class="muted">QR을 다시 찍어 주세요.</p>`; ws.onclose = null; return; }
    offset = m.now - Date.now();
    st = m;
    render();
  };
  ws.onclose = () => { $("net").textContent = "연결이 끊겨 다시 연결 중…"; setTimeout(connect, 1000); };
}

function render() {
  const r = st.round, team = myTeam();
  $("me").textContent = team ? team.name : "";
  $("me").className = team ? colorOf(team.id) : "";
  view.className = team ? colorOf(team.id) : "";
  const k = [team && team.id, st.phase, r && r.game, r && r.quiz && r.quiz.qi, r && r.quiz && r.quiz.reveal, st.me.choice, st.teams.map((t) => t.name).join()].join("|");
  if (k === viewKey) return;
  viewKey = k;
  if (!team) return pickTeam();
  if (st.phase === "countdown") { score = 0; sent = -1; stopped = false; }
  clearInterval(miniTimer); miniTap = null;
  view.innerHTML = ({ lobby, countdown, playing, result, final })[st.phase]();
  if (st.phase === "playing" && MINI[r.game]) MINI[r.game]($("mini"));
  tick();
}

function pickTeam() {
  view.innerHTML = `<h2>우리 팀을 골라 주세요</h2><div class="teams">${st.teams.map((t) => `<button class="${colorOf(t.id)}" data-team="${t.id}">${esc(t.name)}</button>`).join("")}</div>`;
}

const lobby = () => `<div style="font-size:64px">🙌</div><h2>입장 완료!</h2><p class="muted">큰 화면을 보며 기다려 주세요.<br>게임이 시작되면 이 화면이 바뀌어요.</p><p><button class="btn line small" id="change">팀 바꾸기</button></p>`;
const NAMES = { tap: "👆 연타 대결", shake: "📳 흔들어라", stop10: "⏱️ 딱 10초", quiz: "💡 퀴즈", mole: "🐹 두더지 잡기", order: "🔢 숫자 순서", oddcolor: "🎨 다른 색 찾기", math: "🧮 암산왕", stroop: "🌈 색깔 함정" };
const HOW = { tap: "화면을 최대한 빨리 연타!", shake: "폰을 힘껏 흔들어요!", stop10: "감으로 정확히 10초에 멈춰요", quiz: "빨리 맞힐수록 고득점", mole: "튀어나온 두더지를 터치!", order: "1부터 차례대로 터치!", oddcolor: "색이 다른 칸 하나를 찾아요", math: "정답을 빨리 골라요", stroop: "글자 뜻 말고 글자의 '색'을 골라요" };
const countdown = () => `<h2>${NAMES[st.round.game]}</h2><div class="big" id="cnt">3</div><p class="muted" style="font-size:18px;font-weight:700">${HOW[st.round.game]}</p>`;
const final = () => `<div style="font-size:64px">🏆</div><h2>최종 순위 발표 중</h2><p class="muted">큰 화면을 봐 주세요!</p>`;

function playing() {
  const r = st.round;
  if (r.game === "tap") return `<div class="big" id="sc">${score}</div><button class="pad" id="pad">여기를 연타!</button>`;
  if (r.game === "shake") return `<div class="big" id="sc">${score}</div><button class="pad" id="pad">${motionOn ? "폰을 흔들어요!" : "흔들기가 안 되면<br>여기를 연타!"}</button>`;
  if (r.game === "stop10") return `<h2>정확히 10초에 멈춰요</h2><div class="big" id="sw">0.0</div><button class="pad" id="pad" ${stopped ? "disabled" : ""}>${stopped ? "멈춤 완료!" : "멈춰!"}</button>`;
  if (MINI[r.game]) return `<div class="bar2"><span>⏱ <span id="left"></span></span><span>점수 <span id="sc">${score}</span></span></div><div id="mini"></div>`;
  if (r.game === "quiz" && r.quiz) {
    const q = r.quiz, mine = st.me.choice;
    return `<p class="muted">${q.qi + 1} / ${q.total}</p><h2 style="font-size:22px">${esc(q.q)}</h2><div class="choices">${q.c.map((c, i) => {
      const cls = q.reveal ? (i === q.answer ? "ok" : i === mine ? "mine no" : "no") : i === mine ? "mine" : "";
      return `<button class="${cls}" data-choice="${i}" ${mine != null || q.reveal ? "disabled" : ""}>${i + 1}. ${esc(c)}</button>`;
    }).join("")}</div><p class="muted">${q.reveal ? (mine === q.answer ? "⭕ 정답!" : mine == null ? "시간 초과" : "❌ 아쉬워요") : mine != null ? "제출 완료! 결과를 기다려요" : ""}</p>`;
  }
  return `<p class="muted">곧 시작해요…</p>`;
}

function result() {
  const row = st.last && st.last.rows.find((x) => x.teamId === st.me.teamId);
  if (!row) return `<h2>이번 게임 결과</h2><p class="muted">큰 화면을 봐 주세요.</p>`;
  return `<p class="muted">우리 팀 이번 게임</p><div class="big">${row.rank}위</div><h2>+${row.pts}점</h2>`;
}

/* ───────── 미니게임 (폰에서 채점하고 점수만 서버로 보낸다) ───────── */
let miniTimer = null, miniTap = null;
const rint = (n) => Math.floor(Math.random() * n);
const mix = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = rint(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };
// 틀리면 잠깐 빨갛게 표시하고 0.5초 동안 입력을 막는다 (아무거나 연타하는 것 방지)
let lockedUntil = 0;
function wrong(el, then) { el.classList.add("bad"); lockedUntil = Date.now() + 500; setTimeout(() => { el.classList.remove("bad"); if (then) then(); }, 500); }
const locked = () => Date.now() < lockedUntil;

const MINI = {
  // 두더지: 3×3 칸 중 한 곳에 나타난다. 잡으면 바로 다음 두더지, 놓치면 0.8초 뒤 자리를 옮긴다
  mole(box) {
    box.innerHTML = `<div class="cells" style="--k:3">${Array.from({ length: 9 }, (_, i) => `<button class="cell" data-m="${i}"></button>`).join("")}</div>`;
    const cells = [...box.querySelectorAll(".cell")];
    let cur = -1;
    const spawn = () => {
      if (cur >= 0) { cells[cur].classList.remove("on"); cells[cur].textContent = ""; }
      let n; do { n = rint(9); } while (n === cur);
      cur = n; cells[cur].classList.add("on"); cells[cur].textContent = "🐹";
    };
    spawn(); miniTimer = setInterval(spawn, 800);
    miniTap = (b) => { if (+b.dataset.m === cur) { bump(); clearInterval(miniTimer); spawn(); miniTimer = setInterval(spawn, 800); } };
  },
  // 숫자 순서: 섞인 1~16을 차례대로. 다 누르면 새 판
  order(box) {
    let next = 1;
    const deal = () => { next = 1; box.innerHTML = `<div class="cells" style="--k:4">${mix(Array.from({ length: 16 }, (_, i) => i + 1)).map((n) => `<button class="cell" data-m="${n}">${n}</button>`).join("")}</div>`; };
    deal();
    miniTap = (b) => {
      if (locked() || b.classList.contains("done")) return;
      if (+b.dataset.m !== next) return wrong(b);
      b.classList.add("done"); bump();
      if (++next > 16) deal();
    };
  },
  // 다른 색 찾기: 맞힐수록 칸이 늘고 색 차이가 줄어든다
  oddcolor(box) {
    let odd = 0;
    const deal = () => {
      const k = Math.min(6, 2 + Math.floor(score / 3)), h = rint(360), diff = Math.max(5, 20 - score);
      odd = rint(k * k);
      box.innerHTML = `<div class="cells" style="--k:${k}">${Array.from({ length: k * k }, (_, i) => `<button class="cell" data-m="${i}" style="background:hsl(${h} 65% ${i === odd ? 50 + diff : 50}%)"></button>`).join("")}</div>`;
    };
    deal();
    miniTap = (b) => { if (locked()) return; if (+b.dataset.m === odd) { bump(); deal(); } else wrong(b); };
  },
  // 암산왕: 덧셈·뺄셈·곱셈 4지선다
  math(box) {
    let ans = 0;
    const deal = () => {
      const op = "+-×"[rint(3)];
      let a = 2 + rint(op === "×" ? 8 : 40), b = 2 + rint(op === "×" ? 8 : 40);
      if (op === "-" && b > a) [a, b] = [b, a];
      ans = op === "+" ? a + b : op === "-" ? a - b : a * b;
      const set = new Set([ans]);
      while (set.size < 4) { const v = ans + (rint(2) ? 1 : -1) * (1 + rint(9)); if (v >= 0) set.add(v); }
      box.innerHTML = `<div class="ask">${a} ${op} ${b} = ?</div><div class="opts">${mix([...set]).map((v) => `<button class="opt" data-m="${v}">${v}</button>`).join("")}</div>`;
    };
    deal();
    miniTap = (b) => { if (locked()) return; if (+b.dataset.m === ans) { bump(); deal(); } else wrong(b, deal); };
  },
  // 색깔 함정: '파랑'이라는 글자가 빨간색으로 쓰여 있으면 정답은 빨강
  stroop(box) {
    const C = [["빨강", "#cf2030"], ["파랑", "#1f6feb"], ["초록", "#17a589"], ["노랑", "#e0a100"]];
    let ink = 0;
    const deal = () => {
      const word = rint(4); do { ink = rint(4); } while (ink === word);
      box.innerHTML = `<p class="muted" style="font-weight:800">글자의 <b>색</b>은?</p><div class="ask" style="color:${C[ink][1]};font-size:84px">${C[word][0]}</div><div class="opts">${mix([0, 1, 2, 3]).map((i) => `<button class="opt" data-m="${i}">${C[i][0]}</button>`).join("")}</div>`;
    };
    deal();
    miniTap = (b) => { if (locked()) return; if (+b.dataset.m === ink) { bump(); deal(); } else wrong(b, deal); };
  },
};

/* ───────── 게임 조작 ───────── */
function inPlay(game) { return st && st.phase === "playing" && st.round && st.round.game === game && now() <= st.round.endsAt; }
function bump() { score++; const el = $("sc"); if (el) el.textContent = score; }

view.addEventListener("pointerdown", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  if (b.dataset.team) {
    askMotion();
    localStorage.setItem(TEAM_KEY, b.dataset.team);
    send({ t: "team", teamId: b.dataset.team });
  } else if (b.id === "change") { localStorage.removeItem(TEAM_KEY); st.me.teamId = null; viewKey = ""; render(); }
  else if (b.id === "pad") {
    if (inPlay("tap") || (inPlay("shake") && !motionOn)) bump();
    else if (inPlay("stop10") && !stopped) {
      stopped = true;
      const t = now() - st.round.startsAt;
      $("sw").textContent = (t / 1000).toFixed(2);
      b.disabled = true; b.textContent = "멈춤 완료!";
      send({ t: "score", v: t });
    }
  } else if (b.dataset.m != null) { if (miniTap && inPlay(st.round.game)) miniTap(b); }
  else if (b.dataset.choice != null) send({ t: "answer", qi: st.round.quiz.qi, choice: Number(b.dataset.choice) });
});

// 흔들기 감지: 아이폰은 사용자가 버튼을 누른 순간에만 센서 권한을 물어볼 수 있다 → 팀 고를 때 요청
function askMotion() {
  const D = window.DeviceMotionEvent;
  if (!D) return;
  if (typeof D.requestPermission === "function") D.requestPermission().then((p) => { if (p === "granted") listenMotion(); }).catch(() => {});
  else listenMotion();
}
let lastA = null, lastShake = 0;
function listenMotion() {
  if (listenMotion.on) return;
  listenMotion.on = true;
  window.addEventListener("devicemotion", (e) => {
    const a = e.accelerationIncludingGravity;
    if (!a || a.x == null) return;
    motionOn = true;
    if (lastA) {
      const d = Math.abs(a.x - lastA.x) + Math.abs(a.y - lastA.y) + Math.abs(a.z - lastA.z);
      const t = Date.now();
      if (d > 22 && t - lastShake > 90 && inPlay("shake")) { lastShake = t; bump(); }
    }
    lastA = { x: a.x, y: a.y, z: a.z };
  });
}
if (localStorage.getItem(TEAM_KEY) && !(window.DeviceMotionEvent && typeof DeviceMotionEvent.requestPermission === "function")) askMotion();

// 0.1초마다: 카운트다운·스톱워치 표시, 바뀐 점수만 서버로 전송
function tick() {
  if (!st || !st.round) return;
  const r = st.round;
  if (st.phase === "countdown" && $("cnt")) $("cnt").textContent = Math.max(1, Math.ceil((r.startsAt - now()) / 1000));
  if (st.phase === "playing" && r.game === "stop10" && !stopped && $("sw")) {
    const t = (now() - r.startsAt) / 1000;
    $("sw").textContent = t < 3 ? t.toFixed(1) : "?.?"; // 3초 뒤부터는 숫자를 가려 감으로 맞히게 한다
  }
  if (st.phase === "playing" && $("left")) $("left").textContent = Math.max(0, (r.endsAt - now()) / 1000).toFixed(0) + "초";
  if (st.phase === "playing" && (r.game === "tap" || r.game === "shake" || MINI[r.game]) && score !== sent) { sent = score; send({ t: "score", v: score }); }
}
setInterval(tick, 100);

if (!code) view.innerHTML = `<h2>참가 코드가 없어요</h2><p class="muted">큰 화면의 QR을 찍어 주세요.</p>`;
else connect();

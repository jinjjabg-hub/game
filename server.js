// 팀한판 서버 — 방(행사) 관리, 실시간 점수 집계, QR 생성
const express = require("express");
const http = require("http");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { WebSocketServer } = require("ws");
const QRCode = require("qrcode");

const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, "data", "rooms.json");
const COUNTDOWN_MS = 3500;
const QUIZ_MS = 15000;
const ROOM_TTL_MS = 14 * 24 * 3600 * 1000;
const MAX_TEAMS = 20;

// 게임 목록: dur = 진행 시간(ms), max = 한 폰이 낼 수 있는 최대 점수(비정상 값 차단)
const GAMES = {
  tap: { dur: 10000, max: 400 },
  shake: { dur: 10000, max: 400 },
  stop10: { dur: 20000, max: 20000 },
  quiz: { dur: 0, max: 0 },
  mole: { dur: 20000, max: 200 },
  order: { dur: 30000, max: 400 },
  oddcolor: { dur: 30000, max: 200 },
  math: { dur: 30000, max: 200 },
  stroop: { dur: 30000, max: 200 },
};

const DEFAULT_QUIZ = [
  { q: "BNI의 핵심 철학 'Givers Gain'의 뜻은?", c: ["주는 자가 얻는다", "먼저 받는 자가 이긴다", "빠른 자가 얻는다", "많이 아는 자가 얻는다"], a: 0 },
  { q: "BNI를 창립한 사람은?", c: ["아이번 마이즈너", "데일 카네기", "스티븐 코비", "피터 드러커"], a: 0 },
  { q: "멤버끼리 1:1로 만나 서로의 사업을 깊이 알아가는 활동은?", c: ["원투원", "피처 프레젠테이션", "비지터 데이", "위클리 프레젠테이션"], a: 0 },
  { q: "BNI가 처음 시작된 해는?", c: ["1975년", "1985년", "1995년", "2005년"], a: 1 },
  { q: "한 챕터에서 같은 전문분야 멤버는 몇 명까지 가능할까요?", c: ["1명", "2명", "3명", "제한 없음"], a: 0 },
  { q: "VCP 프로세스의 올바른 순서는?", c: ["수익 → 신뢰 → 인지", "신뢰 → 인지 → 수익", "인지 → 신뢰 → 수익", "인지 → 수익 → 신뢰"], a: 2 },
  { q: "초성 퀴즈! 'ㄹㅍㄹ' — 멤버에게 고객을 소개해 주는 것은?", c: ["리퍼럴", "리플릿", "리필", "라펠"], a: 0 },
  { q: "초성 퀴즈! 'ㅂㅈㅌ' — 챕터 모임에 처음 방문한 손님은?", c: ["비지터", "바리스타", "부자터", "배지터"], a: 0 },
];

/* ───────── 방 저장소 ───────── */
const rooms = new Map();

function loadRooms() {
  try {
    const list = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    for (const r of list) {
      if (Date.now() - r.touched > ROOM_TTL_MS) continue;
      rooms.set(r.code, { ...r, phase: "lobby", round: null, clients: new Set(), timer: null });
    }
  } catch (e) { /* 저장 파일 없음 = 첫 실행 */ }
}

let saveTimer = null;
function saveRooms() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    const list = [...rooms.values()].map((r) => ({
      code: r.code, key: r.key, teams: r.teams, quiz: r.quiz, last: r.last, touched: r.touched,
    }));
    fs.mkdir(path.dirname(DATA_FILE), { recursive: true }, () => {
      fs.writeFile(DATA_FILE, JSON.stringify(list), () => {});
    });
  }, 500);
}

function newCode() {
  const abc = "abcdefghjkmnpqrstuvwxyz23456789"; // 헷갈리는 글자(0,o,1,l,i) 제외
  let code;
  do { code = Array.from(crypto.randomBytes(5), (b) => abc[b % abc.length]).join(""); } while (rooms.has(code));
  return code;
}

function makeTeams(names, old = []) {
  return names.slice(0, MAX_TEAMS).map((name, i) => ({
    id: "t" + (i + 1), name: String(name).trim().slice(0, 20) || i + 1 + "팀", total: old[i] ? old[i].total : 0,
  }));
}

function createRoom() {
  const room = {
    code: newCode(), key: crypto.randomBytes(12).toString("hex"),
    teams: makeTeams(["1팀", "2팀", "3팀", "4팀"]), quiz: DEFAULT_QUIZ,
    phase: "lobby", round: null, last: null, touched: Date.now(), clients: new Set(), timer: null,
  };
  rooms.set(room.code, room);
  saveRooms();
  return room;
}

/* ───────── 점수 계산 ───────── */
// 팀 점수 = 그 팀 폰들의 평균 (폰 대수가 달라도 공정하도록)
function teamScores(room) {
  const sum = {}, cnt = {};
  for (const s of Object.values(room.round ? room.round.scores : {})) {
    if (s.v == null) continue;
    sum[s.teamId] = (sum[s.teamId] || 0) + s.v;
    cnt[s.teamId] = (cnt[s.teamId] || 0) + 1;
  }
  const out = {};
  for (const id of Object.keys(sum)) out[id] = Math.round(sum[id] / cnt[id]);
  return out;
}

function players(room) { return [...room.clients].filter((c) => !c.isHost && c.teamId); }

function setTimer(room, at, fn) {
  clearTimeout(room.timer);
  room.timer = setTimeout(fn, Math.max(0, at - Date.now()));
}

// 정답 위치가 늘 같으면 외워 버리므로, 게임을 시작할 때마다 보기 순서를 섞는다
function shuffleChoices(q) {
  const idx = q.c.map((_, i) => i);
  for (let i = idx.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [idx[i], idx[j]] = [idx[j], idx[i]]; }
  return { q: q.q, c: idx.map((i) => q.c[i]), a: idx.indexOf(q.a) };
}

function startRound(room, game) {
  if (!GAMES[game] || room.phase !== "lobby") return;
  if (game === "quiz" && !room.quiz.length) return;
  const startsAt = Date.now() + COUNTDOWN_MS;
  room.round = { game, startsAt, endsAt: startsAt + GAMES[game].dur, scores: {} };
  room.phase = "countdown";
  setTimer(room, startsAt, () => {
    room.phase = "playing";
    if (game === "quiz") { room.round.qi = -1; room.round.qs = room.quiz.map(shuffleChoices); nextQuestion(room); }
    else { setTimer(room, room.round.endsAt + 600, () => finishRound(room)); broadcast(room); }
  });
  broadcast(room);
}

function nextQuestion(room) {
  const r = room.round;
  if (r.qi + 1 >= r.qs.length) return finishRound(room);
  r.qi++; r.reveal = false; r.qStartsAt = Date.now(); r.qEndsAt = r.qStartsAt + QUIZ_MS;
  setTimer(room, r.qEndsAt, () => revealAnswer(room));
  broadcast(room);
}

function revealAnswer(room) {
  clearTimeout(room.timer);
  room.round.reveal = true;
  broadcast(room);
}

function finishRound(room) {
  clearTimeout(room.timer);
  const r = room.round;
  if (!r) return;
  const scores = teamScores(room);
  const rows = room.teams.filter((t) => scores[t.id] != null).map((t) => ({ teamId: t.id, score: scores[t.id] }));
  rows.sort((a, b) => b.score - a.score);
  rows.forEach((row, i) => {
    row.rank = i > 0 && rows[i - 1].score === row.score ? rows[i - 1].rank : i + 1; // 동점은 같은 순위
    row.pts = (room.teams.length - row.rank + 1) * 10;
    room.teams.find((t) => t.id === row.teamId).total += row.pts;
  });
  room.last = { game: r.game, rows };
  room.round = null;
  room.phase = "result";
  saveRooms();
  broadcast(room);
}

function undoLast(room) {
  if (room.phase !== "result" || !room.last) return;
  for (const row of room.last.rows) {
    const t = room.teams.find((x) => x.id === row.teamId);
    if (t) t.total -= row.pts;
  }
  room.last = null;
  room.phase = "lobby";
  saveRooms();
  broadcast(room);
}

/* ───────── 화면별 상태 만들기 ───────── */
function viewFor(room, client) {
  const count = {};
  for (const p of players(room)) count[p.teamId] = (count[p.teamId] || 0) + 1;
  const st = {
    t: "state", now: Date.now(), code: room.code, phase: room.phase, last: room.last,
    teams: room.teams.map((t) => ({ id: t.id, name: t.name, total: t.total, n: count[t.id] || 0 })),
  };
  const r = room.round;
  if (r) {
    st.round = { game: r.game, startsAt: r.startsAt, endsAt: r.endsAt };
    if (r.game === "stop10") { // 긴장감을 위해 진행 중엔 점수 대신 '멈춤 완료' 여부만
      st.round.done = {};
      for (const s of Object.values(r.scores)) st.round.done[s.teamId] = true;
    } else st.round.live = teamScores(room);
    if (r.game === "quiz" && r.qi >= 0) {
      const q = r.qs[r.qi];
      st.round.quiz = {
        qi: r.qi, total: r.qs.length, q: q.q, c: q.c, startsAt: r.qStartsAt, endsAt: r.qEndsAt, reveal: r.reveal,
        answer: r.reveal ? q.a : undefined, // 정답은 공개 전엔 절대 내려보내지 않는다
        answered: Object.values(r.scores).filter((s) => s.ans && s.ans[r.qi] != null).length, players: players(room).length,
      };
    }
  }
  if (client.isHost) st.quiz = room.quiz;
  else {
    const mine = r && r.scores[client.pid];
    st.me = { teamId: client.teamId, choice: mine && mine.ans && r.qi != null ? mine.ans[r.qi] : undefined };
  }
  return st;
}

function send(client, obj) { if (client.readyState === 1) client.send(JSON.stringify(obj)); }
function broadcast(room) { for (const c of room.clients) send(c, viewFor(room, c)); }

// 연타처럼 점수가 초당 수십 번 오는 게임은 0.2초에 한 번만 화면에 반영
function broadcastSoon(room) {
  if (room.dirty) return;
  room.dirty = setTimeout(() => { room.dirty = null; broadcast(room); }, 200);
}

/* ───────── 메시지 처리 ───────── */
function onHost(room, m) {
  room.touched = Date.now();
  const r = room.round;
  switch (m.t) {
    case "start": return startRound(room, m.game);
    case "next": // 스페이스바: 지금 단계에서 '다음'
      if (room.phase === "result") { room.phase = "lobby"; return broadcast(room); }
      if (room.phase === "playing" && r.game === "quiz") return r.reveal ? nextQuestion(room) : revealAnswer(room);
      if (room.phase === "playing" && r.game === "stop10") return finishRound(room);
      return;
    case "undo": return undoLast(room);
    case "lobby":
      clearTimeout(room.timer); room.round = null; room.phase = "lobby"; return broadcast(room);
    case "final":
      if (room.phase === "lobby" || room.phase === "result") { room.phase = "final"; broadcast(room); }
      return;
    case "adjust": {
      const t = room.teams.find((x) => x.id === m.teamId);
      const d = Number(m.delta);
      if (t && Number.isFinite(d) && Math.abs(d) <= 1000) { t.total += Math.round(d); saveRooms(); broadcast(room); }
      return;
    }
    case "teams":
      if (room.phase !== "lobby" || !Array.isArray(m.names) || !m.names.length) return;
      room.teams = makeTeams(m.names, room.teams);
      for (const c of room.clients) if (!room.teams.some((t) => t.id === c.teamId)) c.teamId = null;
      saveRooms(); return broadcast(room);
    case "quiz":
      if (room.phase !== "lobby" || !Array.isArray(m.questions)) return;
      room.quiz = m.questions.slice(0, 50).map((x) => ({
        q: String(x.q).slice(0, 200), c: (x.c || []).slice(0, 4).map((s) => String(s).slice(0, 60)), a: Number(x.a) | 0,
      })).filter((x) => x.q && x.c.length >= 2 && x.a >= 0 && x.a < x.c.length);
      saveRooms(); return broadcast(room);
    case "reset":
      if (room.phase !== "lobby") return;
      room.teams.forEach((t) => (t.total = 0)); room.last = null; saveRooms(); return broadcast(room);
  }
}

function onPlayer(room, c, m) {
  const r = room.round;
  if (m.t === "team") {
    if (room.teams.some((t) => t.id === m.teamId)) { c.teamId = m.teamId; broadcast(room); }
    return;
  }
  if (!c.teamId || room.phase !== "playing" || !r) return;
  const entry = (r.scores[c.pid] = r.scores[c.pid] || { teamId: c.teamId, v: null });
  if (m.t === "score" && r.game !== "quiz") {
    const v = Number(m.v);
    if (!Number.isFinite(v) || v < 0 || v > GAMES[r.game].max || Date.now() > r.endsAt + 500) return;
    if (r.game === "stop10") {
      if (entry.v != null) return; // 한 번만 멈출 수 있다
      entry.v = Math.max(0, Math.round(10000 - Math.abs(v - 10000))); // 10초에 가까울수록 고득점
      if (players(room).every((p) => r.scores[p.pid] && r.scores[p.pid].v != null)) return finishRound(room);
    } else entry.v = Math.max(entry.v || 0, Math.round(v));
    return broadcastSoon(room);
  }
  if (m.t === "answer" && r.game === "quiz" && !r.reveal && m.qi === r.qi) {
    entry.ans = entry.ans || {};
    if (entry.ans[r.qi] != null) return; // 답은 한 번만
    const choice = Number(m.choice) | 0;
    entry.ans[r.qi] = choice;
    entry.v = entry.v || 0;
    if (choice === r.qs[r.qi].a) { // 정답 100점 + 빨리 맞힐수록 최대 50점
      const left = Math.max(0, r.qEndsAt - Date.now()) / QUIZ_MS;
      entry.v += 100 + Math.round(50 * left);
    }
    if (players(room).every((p) => r.scores[p.pid] && r.scores[p.pid].ans && r.scores[p.pid].ans[r.qi] != null)) return revealAnswer(room);
    return broadcast(room);
  }
}

/* ───────── HTTP ───────── */
const app = express();
app.set("trust proxy", true);
app.use(express.json({ limit: "100kb" }));
app.use(express.static(path.join(__dirname, "public"), { extensions: ["html"] }));

app.get("/api/ping", (req, res) => res.json({ ok: true }));

app.post("/api/room", (req, res) => {
  const room = createRoom();
  res.json({ code: room.code, key: room.key });
});

app.get("/qr.svg", async (req, res) => {
  const code = String(req.query.r || "");
  if (!rooms.has(code)) return res.status(404).end();
  const url = `${req.protocol}://${req.get("host")}/play?r=${code}`;
  res.type("image/svg+xml").send(await QRCode.toString(url, { type: "svg", margin: 1, errorCorrectionLevel: "M" }));
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws", maxPayload: 64 * 1024 });

wss.on("connection", (ws) => {
  ws.alive = true;
  ws.on("pong", () => (ws.alive = true));
  ws.on("message", (raw) => {
    let m;
    try { m = JSON.parse(raw); } catch (e) { return; }
    if (!m || typeof m.t !== "string") return;
    if (!ws.room) { // 첫 메시지: 입장
      const room = rooms.get(String(m.code || "").toLowerCase());
      if (!room) return send(ws, { t: "error", error: "방을 찾을 수 없어요" });
      if (m.t === "host") {
        if (m.key !== room.key) return send(ws, { t: "error", error: "진행자 권한이 없어요" });
        ws.isHost = true;
      } else if (m.t === "join") {
        ws.pid = String(m.pid || "").slice(0, 40) || crypto.randomUUID();
        if (room.teams.some((t) => t.id === m.teamId)) ws.teamId = m.teamId;
      } else return;
      ws.room = room;
      room.clients.add(ws);
      return broadcast(room);
    }
    if (ws.isHost) onHost(ws.room, m); else onPlayer(ws.room, ws, m);
  });
  ws.on("close", () => {
    if (!ws.room) return;
    ws.room.clients.delete(ws);
    broadcast(ws.room);
  });
});

// 끊긴 연결 정리 + 프록시가 유휴 연결을 끊지 않게 주기적으로 ping
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.alive) { ws.terminate(); continue; }
    ws.alive = false; ws.ping();
  }
}, 25000);

loadRooms();
server.listen(PORT, () => console.log(`팀한판 실행 중 → http://localhost:${PORT}`));

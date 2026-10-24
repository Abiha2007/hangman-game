/* EF101-P01 — browser side.
   The browser only draws what the server sends. The hidden word is stored on
   the server, so it is not visible in the page source while playing. */

const $ = id => document.getElementById(id);
const LETTERS = "abcdefghijklmnopqrstuvwxyz".split("");

let state = null;                  // last state received from the server
let difficulty = "easy";
let busy = false;
let mode = "normal";             // "normal" or "daily"

/* ---------- API helpers ---------- */
async function api(path, method = "GET", body) {
  const res = await fetch(path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

/* ---------- build the on-screen keyboard once ---------- */
function buildKeyboard() {
  $("keyboard").innerHTML = "";
  for (const l of LETTERS) {
    const b = document.createElement("button");
    b.className = "key";
    b.textContent = l.toUpperCase();
    b.dataset.letter = l;
    b.addEventListener("click", () => guess(l));
    $("keyboard").appendChild(b);
  }
}

/* ---------- render ---------- */
function render(msg, cls) {
  if (!state) return;
  const shown = state.status === "playing" ? state.masked : (state.word || state.masked);
  $("word").textContent = shown.split("").join(" ");
  $("attempts").textContent = `${state.attemptsLeft} / ${state.maxAttempts}`;
  $("score").textContent = state.currentScore;
  $("length").textContent = `${state.length} letters`;
  $("guessed").textContent = state.guessed.length
    ? state.guessed.map(l => l.toUpperCase()).join(" ")
    : "nothing yet";

  // keyboard colours
  document.querySelectorAll(".key").forEach(b => {
    const l = b.dataset.letter;
    b.className = "key";
    b.disabled = state.status !== "playing";
    if (state.guessed.includes(l)) {
      b.disabled = true;
      b.classList.add(state.wrong.includes(l) ? "miss" : "hit");
    }
  });

  // hangman drawing: one part per wrong guess
  const used = state.maxAttempts - state.attemptsLeft;
  const parts = ["p1","p2","p3","p4","p5","p6"];
  const shownParts = Math.round(used * 6 / state.maxAttempts);   // scales to 5/6/8 attempts
  parts.forEach((id, i) => $(id).classList.toggle("show", i < shownParts));

  if (msg !== undefined) {
    $("message").textContent = msg;
    $("message").className = "message" + (cls ? " " + cls : "");
  }

  // hint button and mode tag
  $("hint").disabled = !(state.status === "playing" && state.hintsUsed < state.hintsMax);
  $("hint").textContent = state.hintsUsed >= state.hintsMax ? "Hint used" : "Hint (-25 pts)";
  const tag = $("modeTag");
  tag.hidden = state.mode !== "daily";
  if (state.mode === "daily") tag.textContent = `Daily challenge: same word for everyone today (${state.difficulty}, x1.25 score)`;

  // save box appears only when a game has ended and is not yet saved
  $("saveBox").hidden = !(state.status !== "playing" && !state.saved);
}

/* ---------- actions ---------- */
async function newGame() {
  try {
    state = await api("/api/game/new", "POST", { difficulty, mode });
    $("saveMsg").textContent = "";
    $("saveMsg").className = "savemsg";
    render("Good luck. Click a letter or use your keyboard.");
  } catch (e) { $("message").textContent = e.message; }
}

async function guess(letter) {
  if (busy || !state || state.status !== "playing") return;
  if (state.guessed.includes(letter)) {
    render(`You already guessed ${letter.toUpperCase()} — that does not cost an attempt.`);
    return;
  }
  busy = true;
  try {
    const before = state.attemptsLeft;
    state = await api("/api/game/guess", "POST", { gameId: state.gameId, letter });
    if (state.status === "won") {
      render(`Correct — the word was ${state.word.toUpperCase()}. You scored ${state.score}.`, "win");
      $("playerName").focus();
    } else if (state.status === "lost") {
      render(`Out of attempts. The word was ${state.word.toUpperCase()}. You scored ${state.score}.`, "lose");
      $("playerName").focus();
    } else if (state.attemptsLeft < before) {
      render(`No ${letter.toUpperCase()} in this word.`);
    } else {
      render(`${letter.toUpperCase()} is in the word.`);
    }
  } catch (e) {
    $("message").textContent = e.message;
  } finally { busy = false; }
}

async function hint() {
  if (busy || !state || state.status !== "playing") return;
  busy = true;
  try {
    state = await api("/api/game/hint", "POST", { gameId: state.gameId });
    render(`Hint: ${state.hintLetter.toUpperCase()} is in the word.`);
    $("word").classList.remove("pop"); void $("word").offsetWidth; $("word").classList.add("pop");
  } catch (e) { $("message").textContent = e.message; }
  finally { busy = false; }
}

async function saveScore() {
  const name = $("playerName").value.trim();
  const box = $("saveMsg");
  if (!name) { box.className = "savemsg"; box.textContent = "Enter a name before saving."; return; }
  try {
    await api("/api/scores", "POST", { gameId: state.gameId, playerName: name });
    state.saved = true;
    box.className = "savemsg ok";
    box.textContent = `Saved ${state.score} points for ${name}.`;
    $("saveBox").hidden = true;
    loadBoard();
  } catch (e) { box.className = "savemsg"; box.textContent = e.message; }
}

async function loadBoard() {
  const list = $("leaderboard");
  try {
    const rows = await api("/api/scores?limit=50");
    list.innerHTML = "";
    if (!rows.length) { list.innerHTML = '<li class="empty">No scores yet. Win a game and save one.</li>'; return; }
    for (const r of rows) {
      const li = document.createElement("li");
      if (r.rank <= 3) li.classList.add("top");
      const badge = r.rank <= 3
        ? `<span class="badge g${r.rank}">${["1st","2nd","3rd"][r.rank - 1]}</span>` : "";
      const when = new Date(r.playedAt).toLocaleDateString();
      li.innerHTML =
        `<span class="rank">${r.rank}</span>` +
        `<span class="name">${badge}${escapeHTML(r.playerName)}</span>` +
        `<span class="pts">${r.score}</span>` +
        `<span class="meta">${r.difficulty}${r.mode === "daily" ? " (daily)" : ""} · ${r.result} · ${when}</span>`;
      list.appendChild(li);
    }
  } catch { list.innerHTML = '<li class="empty">Leaderboard unavailable. Is the server running?</li>'; }
}

function escapeHTML(s) {
  return s.replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
}

/* ---------- wiring ---------- */
document.querySelectorAll(".diff[data-difficulty]").forEach(b => b.addEventListener("click", () => {
  document.querySelectorAll(".diff").forEach(x => x.classList.remove("is-active"));
  b.classList.add("is-active");
  difficulty = b.dataset.difficulty;
  mode = "normal";
  newGame();
}));
$("daily").addEventListener("click", () => {
  document.querySelectorAll(".diff").forEach(x => x.classList.remove("is-active"));
  $("daily").classList.add("is-active");
  mode = "daily";
  newGame();
});
$("hint").addEventListener("click", hint);
$("newGame").addEventListener("click", newGame);
$("saveScore").addEventListener("click", saveScore);
$("refresh").addEventListener("click", loadBoard);
$("playerName").addEventListener("keydown", e => { if (e.key === "Enter") saveScore(); });
document.addEventListener("keydown", e => {
  if (e.target.tagName === "INPUT") return;
  if (/^[a-zA-Z]$/.test(e.key)) guess(e.key.toLowerCase());
});

buildKeyboard();
newGame();
loadBoard();

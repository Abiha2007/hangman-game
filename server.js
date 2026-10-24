/* =====================================================================
   EF101-P01  Web-Based Hangman Game with Leaderboard
   Server: Node.js built-in modules only (no npm install needed)
   Run with:  node server.js
   ===================================================================== */

const http = require("http");
const fs   = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT       = process.env.PORT || 3000;
const ROOT       = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const WORDS_FILE = path.join(ROOT, "data", "words.txt");
const SCORES_FILE= path.join(ROOT, "data", "scores.json");

/* ------------------------------------------------------------------
   1. WORD DATABASE  (loaded once from data/words.txt)
      File format:  word,difficulty        e.g.  planet,easy
   ------------------------------------------------------------------ */
const WORDS = { easy: [], medium: [], hard: [] };

function loadWords() {
  const raw = fs.readFileSync(WORDS_FILE, "utf8").split("\n");
  let id = 0;
  for (const line of raw) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;            // skip comments/blank
    const [word, difficulty] = t.split(",");
    if (!word || !WORDS[difficulty]) continue;
    WORDS[difficulty].push({ id: ++id, word: word.toLowerCase(), difficulty });
  }
  const total = WORDS.easy.length + WORDS.medium.length + WORDS.hard.length;
  console.log(`Word database loaded: ${total} words ` +
    `(easy ${WORDS.easy.length}, medium ${WORDS.medium.length}, hard ${WORDS.hard.length})`);
  if (total < 5000) console.warn("WARNING: fewer than 5000 words loaded!");
}

/* ------------------------------------------------------------------
   2. SCORE STORE  (persistent JSON file - survives browser & server restart)
   ------------------------------------------------------------------ */
function readScores() {
  try { return JSON.parse(fs.readFileSync(SCORES_FILE, "utf8")); }
  catch { return []; }
}
function writeScores(list) {
  fs.mkdirSync(path.dirname(SCORES_FILE), { recursive: true });
  fs.writeFileSync(SCORES_FILE, JSON.stringify(list, null, 2));
}

/* ------------------------------------------------------------------
   3. GAME RULES
   ------------------------------------------------------------------ */
const MAX_ATTEMPTS = { easy: 8, medium: 6, hard: 5 };
const MULTIPLIER   = { easy: 1, medium: 1.5, hard: 2 };

/* Scoring formula (document this in the report):
     WIN  score = round( (100 + 10 * distinctLetters + 12 * attemptsLeft) * multiplier )
     LOSS score = round( (5 * correctGuesses) * multiplier )
   It rewards success (flat 100 win bonus), harder/longer words (distinct
   letters), efficient play (remaining attempts) and difficulty (multiplier). */
const HINT_PENALTY = 25;      // points lost for using the hint (win only)
const MAX_HINTS    = 1;       // one hint per game
const DAILY_BONUS  = 1.25;    // daily challenge multiplier

function computeScore(game, won) {
  const m = MULTIPLIER[game.difficulty] * (game.mode === "daily" ? DAILY_BONUS : 1);
  const distinct = new Set(game.word).size;
  const correct  = game.guessed.filter(l => game.word.includes(l)).length;
  const raw = won ? 100 + 10 * distinct + 12 * game.attemptsLeft : 5 * correct;
  let score = Math.round(raw * m);
  if (won) score = Math.max(10, score - HINT_PENALTY * game.hintsUsed);
  return score;
}

/* In-memory game sessions. The answer NEVER leaves the server until the
   game is over, so the hidden word cannot be read from the page source. */
const games = new Map();

function maskedWord(game) {
  return game.word.split("").map(c => (game.guessed.includes(c) ? c : "_")).join("");
}

/* Live "current score" shown while playing: what the player would earn if
   they won right now. Uses only letters already revealed, so it leaks nothing. */
function previewScore(game) {
  if (game.status !== "playing") return game.score;
  const revealed = game.guessed.filter(l => game.word.includes(l)).length;
  const m = MULTIPLIER[game.difficulty] * (game.mode === "daily" ? DAILY_BONUS : 1);
  return Math.max(10, Math.round((100 + 10 * revealed + 12 * game.attemptsLeft) * m) - HINT_PENALTY * game.hintsUsed);
}

function publicState(game, extra = {}) {
  const state = {
    currentScore: previewScore(game),
    gameId:      game.id,
    difficulty:  game.difficulty,
    masked:      maskedWord(game),
    length:      game.word.length,
    guessed:     game.guessed,
    wrong:       game.guessed.filter(l => !game.word.includes(l)),
    attemptsLeft: game.attemptsLeft,
    maxAttempts: game.maxAttempts,
    status:      game.status,               // playing | won | lost
    score:       game.score,
    saved:       game.saved,
    mode:        game.mode,
    hintsUsed:   game.hintsUsed,
    hintsMax:    MAX_HINTS
  };
  if (game.status !== "playing") state.word = game.word;   // reveal only at the end
  return Object.assign(state, extra);
}

/* Daily challenge: everyone gets the same word on the same (UTC) date.
   The index comes from a hash of the date, so no extra storage is needed. */
function dailyEntry() {
  const all = [...WORDS.easy, ...WORDS.medium, ...WORDS.hard].sort((a, b) => a.id - b.id);
  const day = new Date().toISOString().slice(0, 10);
  const n = parseInt(crypto.createHash("sha256").update("ef101-" + day).digest("hex").slice(0, 8), 16);
  return all[n % all.length];
}

function newGame(difficulty, mode = "normal") {
  if (!WORDS[difficulty]) difficulty = "easy";
  let entry;
  if (mode === "daily") { entry = dailyEntry(); difficulty = entry.difficulty; }
  else { const pool = WORDS[difficulty]; entry = pool[crypto.randomInt(pool.length)]; }   // random selection
  const game = {
    id: crypto.randomUUID(),
    wordId: entry.id,
    word: entry.word,
    difficulty,
    mode,
    hintsUsed: 0,
    guessed: [],
    maxAttempts: MAX_ATTEMPTS[difficulty],
    attemptsLeft: MAX_ATTEMPTS[difficulty],
    status: "playing",
    score: 0,
    saved: false,
    startedAt: new Date().toISOString()
  };
  games.set(game.id, game);
  // house-keeping: forget very old sessions
  if (games.size > 5000) {
    for (const [k, v] of games) { if (Date.now() - Date.parse(v.startedAt) > 6e6) games.delete(k); }
  }
  return game;
}

function applyGuess(game, letter) {
  if (game.status !== "playing") return { error: "Game already finished." };
  if (!/^[a-z]$/.test(letter))   return { error: "Guess must be a single letter A-Z." };
  if (game.guessed.includes(letter))
    return { duplicate: true };            // duplicate guess costs NO attempt

  game.guessed.push(letter);
  if (!game.word.includes(letter)) game.attemptsLeft--;     // wrong guess only

  const solved = game.word.split("").every(c => game.guessed.includes(c));
  if (solved)                 { game.status = "won";  game.score = computeScore(game, true);  }
  else if (game.attemptsLeft <= 0) { game.status = "lost"; game.score = computeScore(game, false); }
  return {};
}

/* Hint: reveals one letter that is still hidden. Costs HINT_PENALTY points
   on a win, never costs an attempt, and is limited to MAX_HINTS per game. */
function applyHint(game) {
  if (game.status !== "playing")       return { error: "Game already finished." };
  if (game.hintsUsed >= MAX_HINTS)     return { error: "No hints left in this game." };
  const hidden = [...new Set(game.word)].filter(c => !game.guessed.includes(c));
  if (hidden.length <= 1)              return { error: "Too close to the end for a hint." };
  const letter = hidden[crypto.randomInt(hidden.length)];
  game.hintsUsed++;
  game.guessed.push(letter);
  return { hintLetter: letter };
}

/* ------------------------------------------------------------------
   4. HTTP PLUMBING
   ------------------------------------------------------------------ */
const MIME = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript",
               ".json": "application/json", ".ico": "image/x-icon", ".svg": "image/svg+xml" };

function sendJSON(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", c => { data += c; if (data.length > 1e5) req.destroy(); });
    req.on("end", () => { try { resolve(data ? JSON.parse(data) : {}); } catch { reject(new Error("Bad JSON")); } });
    req.on("error", reject);
  });
}

function serveStatic(req, res, urlPath) {
  const rel  = urlPath === "/" ? "index.html" : decodeURIComponent(urlPath).replace(/^\/+/, "");
  const file = path.join(PUBLIC_DIR, rel);
  if (!file.startsWith(PUBLIC_DIR)) return sendJSON(res, 403, { error: "Forbidden" });
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404, { "Content-Type": "text/plain" }); return res.end("404 Not Found"); }
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
    res.end(buf);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const p   = url.pathname;

  try {
    /* ---- API: start a new game ---- */
    if (req.method === "POST" && p === "/api/game/new") {
      const { difficulty = "easy", mode = "normal" } = await readBody(req);
      const m = mode === "daily" ? "daily" : "normal";
      return sendJSON(res, 200, publicState(newGame(String(difficulty).toLowerCase(), m)));
    }

    /* ---- API: guess a letter ---- */
    if (req.method === "POST" && p === "/api/game/guess") {
      const { gameId, letter } = await readBody(req);
      const game = games.get(gameId);
      if (!game) return sendJSON(res, 404, { error: "Game not found. Start a new game." });
      const r = applyGuess(game, String(letter || "").toLowerCase());
      if (r.error) return sendJSON(res, 400, { error: r.error });
      return sendJSON(res, 200, publicState(game, { duplicate: !!r.duplicate }));
    }

    /* ---- API: use the hint ---- */
    if (req.method === "POST" && p === "/api/game/hint") {
      const { gameId } = await readBody(req);
      const game = games.get(gameId);
      if (!game) return sendJSON(res, 404, { error: "Game not found. Start a new game." });
      const r = applyHint(game);
      if (r.error) return sendJSON(res, 400, { error: r.error });
      return sendJSON(res, 200, publicState(game, { hintLetter: r.hintLetter }));
    }

    /* ---- API: save a finished game's score ---- */
    if (req.method === "POST" && p === "/api/scores") {
      const { gameId, playerName } = await readBody(req);
      const game = games.get(gameId);
      if (!game)                     return sendJSON(res, 404, { error: "Game not found." });
      if (game.status === "playing") return sendJSON(res, 400, { error: "Game is not finished yet." });
      if (game.saved)                return sendJSON(res, 400, { error: "Score already saved." });
      const name = String(playerName || "").trim().slice(0, 20);
      if (!name)                     return sendJSON(res, 400, { error: "Player name cannot be blank." });

      const scores = readScores();
      scores.push({
        id: scores.length ? scores[scores.length - 1].id + 1 : 1,
        playerName: name, score: game.score, difficulty: game.difficulty,
        word: game.word, result: game.status, mode: game.mode,
        hintsUsed: game.hintsUsed,
        playedAt: new Date().toISOString()
      });
      writeScores(scores);
      game.saved = true;
      return sendJSON(res, 200, { ok: true, saved: { playerName: name, score: game.score } });
    }

    /* ---- API: leaderboard (top 50) ---- */
    if (req.method === "GET" && p === "/api/scores") {
      const limit = Math.min(parseInt(url.searchParams.get("limit") || "50", 10), 200);
      const top = readScores()
        .sort((a, b) => b.score - a.score || Date.parse(a.playedAt) - Date.parse(b.playedAt))
        .slice(0, limit)
        .map((s, i) => ({ rank: i + 1, ...s }));
      return sendJSON(res, 200, top);
    }

    /* ---- API: word database stats (used by the test script) ---- */
    if (req.method === "GET" && p === "/api/stats") {
      return sendJSON(res, 200, {
        totalWords: WORDS.easy.length + WORDS.medium.length + WORDS.hard.length,
        easy: WORDS.easy.length, medium: WORDS.medium.length, hard: WORDS.hard.length,
        maxAttempts: MAX_ATTEMPTS, multipliers: MULTIPLIER,
        savedScores: readScores().length, hintPenalty: HINT_PENALTY, dailyBonus: DAILY_BONUS
      });
    }

    /* ---- TEST-ONLY endpoint: DISABLED unless the server is started with
            ALLOW_TEST_PEEK=1. It is never on in the hosted demo, so the answer
            can not be read from the browser or the network. ---- */
    if (process.env.ALLOW_TEST_PEEK === "1" && req.method === "GET" && p === "/api/test/peek") {
      const game = games.get(url.searchParams.get("gameId"));
      if (!game) return sendJSON(res, 404, { error: "Game not found." });
      return sendJSON(res, 200, { word: game.word });
    }

    if (p.startsWith("/api/")) return sendJSON(res, 404, { error: "Unknown endpoint" });
    return serveStatic(req, res, p);

  } catch (e) {
    return sendJSON(res, 400, { error: e.message || "Bad request" });
  }
});

loadWords();
server.listen(PORT, () => {
  console.log(`Hangman server running -> http://localhost:${PORT}`);
  console.log(`Open that URL in your browser. Press Ctrl+C to stop.`);
});

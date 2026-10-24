/* EF101-P01 automated test script  ->  run:  node test.js
   Covers the assignment's "Minimum Testing Evidence" list.
   The server must already be running in another terminal (node server.js). */

const BASE = process.env.BASE || "http://localhost:3000";
let pass = 0, fail = 0;

function check(name, ok, detail = "") {
  if (ok) { pass++; console.log(`  PASS  ${name}`); }
  else    { fail++; console.log(`  FAIL  ${name} ${detail}`); }
}
const api = async (p, m = "GET", b) => {
  const r = await fetch(BASE + p, {
    method: m,
    headers: b ? { "Content-Type": "application/json" } : undefined,
    body: b ? JSON.stringify(b) : undefined
  });
  return { status: r.status, body: await r.json() };
};
const peek = async id => (await api(`/api/test/peek?gameId=${id}`)).body.word;

(async () => {
  console.log(`Testing ${BASE}\n`);

  /* 1. word database size */
  const stats = (await api("/api/stats")).body;
  check("Database holds at least 5000 words", stats.totalWords >= 5000, `(${stats.totalWords})`);

  /* 2. all three difficulties start a game */
  for (const d of ["easy", "medium", "hard"]) {
    const g = (await api("/api/game/new", "POST", { difficulty: d })).body;
    check(`Difficulty "${d}" starts a game`, g.difficulty === d && g.masked.includes("_"));
  }

  /* 3. single correct letter reveals ALL its occurrences, no attempt lost */
  let g = (await api("/api/game/new", "POST", { difficulty: "easy" })).body;
  let word = await peek(g.gameId);
  const letter = word[0];
  const occurrences = word.split("").filter(c => c === letter).length;
  let r = (await api("/api/game/guess", "POST", { gameId: g.gameId, letter })).body;
  check("Correct letter does not cost an attempt", r.attemptsLeft === g.attemptsLeft);
  check("Correct letter reveals every occurrence",
        r.masked.split("").filter(c => c === letter).length === occurrences,
        `(${word} -> ${r.masked})`);

  /* 4. repeated letter inside a word (word containing a doubled letter) */
  let rep = null;
  for (let i = 0; i < 60 && !rep; i++) {
    const t = (await api("/api/game/new", "POST", { difficulty: "hard" })).body;
    const w = await peek(t.gameId);
    const dup = w.split("").find((c, idx) => w.indexOf(c) !== idx);
    if (dup) rep = { g: t, w, dup };
  }
  if (rep) {
    const out = (await api("/api/game/guess", "POST", { gameId: rep.g.gameId, letter: rep.dup })).body;
    const n = rep.w.split("").filter(c => c === rep.dup).length;
    check("Repeated letter revealed in all positions",
          out.masked.split("").filter(c => c === rep.dup).length === n, `(${rep.w})`);
  }

  /* 5. wrong letter costs exactly one attempt */
  g = (await api("/api/game/new", "POST", { difficulty: "easy" })).body;
  word = await peek(g.gameId);
  const wrong = "abcdefghijklmnopqrstuvwxyz".split("").find(c => !word.includes(c));
  r = (await api("/api/game/guess", "POST", { gameId: g.gameId, letter: wrong })).body;
  check("Wrong letter costs one attempt", r.attemptsLeft === g.attemptsLeft - 1);

  /* 6. duplicate guess does not reduce attempts */
  const dupRes = (await api("/api/game/guess", "POST", { gameId: g.gameId, letter: wrong })).body;
  check("Duplicate guess costs no attempt", dupRes.attemptsLeft === r.attemptsLeft && dupRes.duplicate === true);

  /* 7. invalid guess rejected */
  const bad = await api("/api/game/guess", "POST", { gameId: g.gameId, letter: "5" });
  check("Invalid guess rejected", bad.status === 400);

  /* 8. complete WIN */
  g = (await api("/api/game/new", "POST", { difficulty: "medium" })).body;
  word = await peek(g.gameId);
  let win = g;
  for (const l of new Set(word)) win = (await api("/api/game/guess", "POST", { gameId: g.gameId, letter: l })).body;
  check("Complete win detected", win.status === "won", `(${word})`);
  check("Win produces a positive score", win.score > 0, `(${win.score})`);

  /* 9. complete LOSS */
  g = (await api("/api/game/new", "POST", { difficulty: "hard" })).body;
  word = await peek(g.gameId);
  const misses = "abcdefghijklmnopqrstuvwxyz".split("").filter(c => !word.includes(c));
  let lose = g;
  for (let i = 0; i < g.maxAttempts; i++)
    lose = (await api("/api/game/guess", "POST", { gameId: g.gameId, letter: misses[i] })).body;
  check("Complete loss detected", lose.status === "lost", `(${word})`);
  check("Answer revealed only after the game ends", typeof lose.word === "string");

  /* 10. blank / invalid player name rejected */
  const blank = await api("/api/scores", "POST", { gameId: win.gameId, playerName: "   " });
  check("Blank player name rejected", blank.status === 400);

  /* 11. leaderboard insertion + equal scores handled */
  const before = (await api("/api/scores?limit=50")).body.length;
  await api("/api/scores", "POST", { gameId: win.gameId,  playerName: "TestWinner" });
  await api("/api/scores", "POST", { gameId: lose.gameId, playerName: "TestLoser" });
  const board = (await api("/api/scores?limit=50")).body;
  check("Scores inserted into leaderboard", board.length === before + 2);
  check("Leaderboard sorted highest first",
        board.every((r2, i) => i === 0 || board[i - 1].score >= r2.score));
  check("Leaderboard returns at most 50 rows", board.length <= 50);
  const tie = board.filter(x => x.score === board[0].score);
  check("Equal scores both listed with distinct ranks",
        new Set(tie.map(x => x.rank)).size === tie.length);

  /* 13. hint: reveals a letter, costs no attempt, only one per game */
  g = (await api("/api/game/new", "POST", { difficulty: "hard" })).body;
  word = await peek(g.gameId);
  const h1 = await api("/api/game/hint", "POST", { gameId: g.gameId });
  check("Hint reveals a letter without costing an attempt",
        h1.status === 200 && h1.body.attemptsLeft === g.attemptsLeft && word.includes(h1.body.hintLetter) && h1.body.hintsUsed === 1);
  const h2 = await api("/api/game/hint", "POST", { gameId: g.gameId });
  check("Second hint in the same game is refused", h2.status === 400);

  /* 14. a win with a hint scores less than the same word without one */
  const g1 = (await api("/api/game/new", "POST", { difficulty: "easy" })).body;
  const w1 = await peek(g1.gameId);
  let r1 = g1; for (const l of new Set(w1)) r1 = (await api("/api/game/guess", "POST", { gameId: g1.gameId, letter: l })).body;
  const g2 = (await api("/api/game/new", "POST", { difficulty: "easy" })).body;
  const w2 = await peek(g2.gameId);
  if (new Set(w2).size > 2) {
    await api("/api/game/hint", "POST", { gameId: g2.gameId });
    let r2 = g2; for (const l of new Set(w2)) r2 = (await api("/api/game/guess", "POST", { gameId: g2.gameId, letter: l })).body;
    const expected = Math.max(10, (100 + 10 * new Set(w2).size + 12 * r2.attemptsLeft) - 25);
    check("Win with a hint is charged the hint penalty", r2.status === "won" && r2.score === expected, `(${r2.score} vs ${expected})`);
  }

  /* 15. daily challenge: same word for everyone, bonus applied, flagged as daily */
  const d1 = (await api("/api/game/new", "POST", { mode: "daily" })).body;
  const d2 = (await api("/api/game/new", "POST", { mode: "daily" })).body;
  check("Daily challenge gives the same word to every player",
        (await peek(d1.gameId)) === (await peek(d2.gameId)) && d1.mode === "daily");
  const dw = await peek(d1.gameId);
  let dr = d1; for (const l of new Set(dw)) dr = (await api("/api/game/guess", "POST", { gameId: d1.gameId, letter: l })).body;
  const dm = { easy: 1, medium: 1.5, hard: 2 }[d1.difficulty] * 1.25;
  check("Daily win applies the x1.25 bonus",
        dr.score === Math.round((100 + 10 * new Set(dw).size + 12 * dr.attemptsLeft) * dm), `(${dr.score})`);

  /* 12. saving the same game twice is refused */
  const again = await api("/api/scores", "POST", { gameId: win.gameId, playerName: "TestWinner" });
  check("Same game cannot be saved twice", again.status === 400);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();

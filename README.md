# EF101-P01 — Web-Based Hangman Game with Leaderboard

Node.js server + browser client. **No npm install, no external libraries** — only Node's
built-in modules, so it runs on any machine with Node 18 or newer.

```
hangman/
├── server.js          game logic, word database, scoring, leaderboard API
├── test.js            automated tests for the required test cases
├── package.json       needed only for online hosting
├── data/
│   ├── words.txt      7,800 words with difficulty tags  (word,difficulty)
│   └── scores.json    created automatically, holds saved scores
└── public/
    ├── index.html     page structure
    ├── styles.css     styling
    └── app.js         browser logic (never sees the answer while playing)
```

---

## 1. Run it (copy-paste)

Install Node.js from https://nodejs.org (LTS) if you don't have it, then:

**Windows (PowerShell or CMD):**
```
cd path\to\hangman
node --version
node server.js
```

**macOS / Linux:**
```
cd path/to/hangman
node --version
node server.js
```

You should see:
```
Word database loaded: 7800 words (easy 2600, medium 2600, hard 2600)
Hangman server running -> http://localhost:3000
```

Open **http://localhost:3000** in your browser. Stop the server with `Ctrl + C`.

If port 3000 is busy: `PORT=4000 node server.js` (macOS/Linux) or
`set PORT=4000 && node server.js` (Windows CMD).

---

## 2. Check that it works

### a) Automated tests — one command
Leave the server running in the first terminal. Open a **second** terminal:

```
cd path/to/hangman
node test.js
```

Expected final line: `20 passed, 0 failed`. This script covers correct single letter,
repeated letter, wrong letter, duplicate guess, complete win, complete loss, all three
difficulties, leaderboard insertion, equal scores and a blank player name.

### b) Quick API checks in the terminal
```
curl http://localhost:3000/api/stats
curl http://localhost:3000/api/scores
```
(Windows PowerShell: use `curl.exe` instead of `curl`.)

### c) Manual checks in the browser
1. Click **Easy / Medium / Hard** — a new word starts each time, attempts change to 8 / 6 / 5.
2. Guess a letter that appears twice — **both** positions appear at once.
3. Guess the same letter again — attempts do **not** drop, message says it was already guessed.
4. Guess wrong letters until you lose — the word is revealed and the game stops accepting guesses.
5. Win a game, type a name, click **Save score** — it appears on the leaderboard immediately.
6. Try saving with an empty name — it is refused.
7. Close the browser completely, reopen http://localhost:3000 — the leaderboard is still there.
8. Stop the server, run `node server.js` again — scores are still there (`data/scores.json`).
9. Right-click the page → **View page source** while playing — the answer is **not** in the page.
10. Click **New game** — a fresh word loads with no reload and no file editing.

---

## 3. Put it on a URL for the demo

**Option A — same Wi-Fi (works in a classroom, takes 1 minute).**
Find your computer's IP: `ipconfig` (Windows) or `ifconfig | grep inet` (macOS/Linux),
then on the other device open `http://YOUR-IP:3000`, for example `http://192.168.1.14:3000`.
Allow Node through the firewall if Windows asks.

**Option B — public URL (free, needed if the demo is not on one network).**
1. Push this folder to a GitHub repository.
2. Go to https://render.com → New → Web Service → connect the repo.
3. Environment **Node**, Build command `npm install`, Start command `node server.js`.
4. Render gives you a URL such as `https://ef101-hangman.onrender.com`.

Note for Option B: Render's free plan wipes the file system on redeploy, so the leaderboard
resets when you redeploy. For a graded demo that is fine; to keep it permanently, add a Render
persistent disk mounted at `/data` and change `SCORES_FILE` in `server.js` to `/data/scores.json`.

---

## 4. Things you must be able to explain (System Understanding section)

**Browser vs server.** The browser only draws what it is told: masked word, guessed letters,
attempts, score, leaderboard. All rules live in `server.js`.

**How the word is requested.** The browser sends `POST /api/game/new` with a difficulty. The
server picks a random word of that difficulty from the word database, stores it in a server-side
session object with a random `gameId`, and returns only the masked version (`_ _ _ _`).

**Where the answer is stored.** In the `games` Map inside the server process, keyed by `gameId`.
It is added to the response **only** after the game is won or lost. This is why the answer cannot
be found in the page source — that is the bonus "secure server-side session" requirement.

**How guesses are checked.** `POST /api/game/guess` sends `{gameId, letter}`. The server looks up
the session, rejects anything that is not a single a–z letter, ignores letters already guessed
(no attempt lost), subtracts one attempt only for a letter not in the word, then re-checks win
(every letter revealed) and loss (attempts reached 0).

**How scores reach the database.** When the game ends the server computes the score. The player
types a name and the browser sends `POST /api/scores`; the server validates the name, appends a
record to `data/scores.json` and marks the session as saved so the same game cannot be saved twice.

**How the leaderboard is retrieved.** `GET /api/scores?limit=50` reads the file, sorts by score
(earliest play wins a tie), slices the top 50 and adds a rank number. Ranks 1–3 get a badge and a
larger name in the page.

### Difficulty rule (documented, as required)
Each word is tagged when the database is built, from three properties: length `L`, number of
distinct letters `U`, and how many uncommon letters (`j q x z k v w y`) it contains, `X`.

```
s = L + 0.6*U + 2.5*X
easy    : L <= 6 and X == 0, or s <= 9.6
medium  : 9.6 < s <= 13.0
hard    : s > 13.0
```
Longer words, more distinct letters and rare letters all make a word harder to guess. Difficulty
also changes the allowed wrong guesses: **easy 8, medium 6, hard 5**.

### Scoring formula (documented, as required)
```
multiplier: easy 1, medium 1.5, hard 2

win  : score = round( (100 + 10 * distinctLetters + 12 * attemptsLeft) * multiplier )
loss : score = round( (5 * correctGuesses) * multiplier )
```
It rewards winning (flat 100), harder words (distinct letters), efficient play (attempts left)
and difficulty (multiplier), and still gives partial credit for a good attempt that fails.

### Data model
| Record | Fields |
|---|---|
| Word | `id`, `word`, `difficulty` |
| Game session | `gameId`, `wordId`, `word`, `difficulty`, `guessed[]`, `attemptsLeft`, `status`, `score`, `startedAt` |
| Score | `id`, `playerName`, `score`, `difficulty`, `word`, `result`, `playedAt` |

---

## 5. Before you submit

`server.js` contains a test-only endpoint, `GET /api/test/peek`, which reveals the answer so
`test.js` can play full games automatically. **Delete that block** (it is clearly commented) before
the live demo, or a marker could use it to argue the answer is reachable from the browser.

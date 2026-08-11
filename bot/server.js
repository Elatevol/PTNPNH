/**
 * PTN-PNH Telegram Mini App backend
 * ----------------------------------
 * Implements a real Telegram Mini App (not the classic "Games" platform):
 *  - Sets a persistent "Play" menu button (web_app) next to the message box.
 *  - Responds to /start or /play with an inline "Play" button that opens
 *    the game as a Mini App (a proper WebView, not the restrictive classic
 *    Games iframe - share sheets, links, everything works normally there).
 *  - Exposes POST /api/score, called by the game's JS when a run ends.
 *    It verifies the request using Telegram's official initData signature
 *    (HMAC-SHA256 with a key derived from the bot token) - NOT a bot-issued
 *    per-message signature, since Mini Apps aren't launched via callback_query
 *    the way classic Games are. Scores are kept in a small local JSON file
 *    and exposed via GET /api/leaderboard - there's no Telegram-native
 *    leaderboard for Mini Apps the way there is for classic Games.
 *
 * The bot token NEVER goes to the browser - only this server holds it.
 */

const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const {
  BOT_TOKEN,      // from @BotFather
  GAME_URL,        // public HTTPS URL of game/index.html (e.g. GitHub/GitLab Pages)
  PORT = 3000
} = process.env;

if (!BOT_TOKEN || !GAME_URL) {
  console.error('Missing required env vars. See .env.example');
  process.exit(1);
}

const API = `https://api.telegram.org/bot${BOT_TOKEN}`;
const LEADERBOARD_FILE = path.join(__dirname, 'leaderboard.json');

const app = express();
app.use(express.json());

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------
async function tg(method, payload) {
  const res = await fetch(`${API}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await res.json();
  if (!data.ok) console.error(method, 'failed:', data);
  return data;
}

// Official Telegram Mini App initData verification.
// https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
function verifyInitData(initData) {
  if (!initData || typeof initData !== 'string') return null;

  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;
  params.delete('hash');

  const pairs = [];
  for (const [key, value] of params.entries()) pairs.push(`${key}=${value}`);
  pairs.sort();
  const dataCheckString = pairs.join('\n');

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
  const computedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  if (computedHash !== hash) return null;

  // Optional: reject stale initData (older than 24h) to limit replay window
  const authDate = Number(params.get('auth_date') || 0);
  if (authDate && Date.now()/1000 - authDate > 86400) return null;

  const userJson = params.get('user');
  if (!userJson) return null;
  try {
    return JSON.parse(userJson); // { id, first_name, username, ... }
  } catch {
    return null;
  }
}

function loadLeaderboard() {
  try {
    return JSON.parse(fs.readFileSync(LEADERBOARD_FILE, 'utf8'));
  } catch {
    return {};
  }
}
function saveLeaderboard(data) {
  fs.writeFileSync(LEADERBOARD_FILE, JSON.stringify(data));
}

// ---------------------------------------------------------------------
// One-time-ish setup: persistent menu button (safe to call on every boot)
// ---------------------------------------------------------------------
async function setupMenuButton() {
  await tg('setChatMenuButton', {
    menu_button: { type: 'web_app', text: 'Play', web_app: { url: GAME_URL } }
  });
}

// ---------------------------------------------------------------------
// Telegram webhook
// ---------------------------------------------------------------------
app.post('/webhook', async (req, res) => {
  const update = req.body;
  try {
    if (update.message && update.message.text && /^\/(play|start)/.test(update.message.text)) {
      await tg('sendMessage', {
        chat_id: update.message.chat.id,
        text: 'Defend the sky. Tap below to play.',
        reply_markup: {
          inline_keyboard: [[{ text: '▶ Play PTN PNH', web_app: { url: GAME_URL } }]]
        }
      });
    }

  } catch (e) {
    console.error('webhook error', e);
  }
  res.sendStatus(200);
});

// ---------------------------------------------------------------------
// Score submission from the game's JS (see SCORE_ENDPOINT in index.html)
// ---------------------------------------------------------------------
app.post('/api/score', (req, res) => {
  const { initData, score } = req.body || {};

  const user = verifyInitData(initData);
  if (!user) {
    return res.status(403).json({ ok: false, error: 'bad initData' });
  }
  if (typeof score !== 'number' || score < 0 || score > 100000) {
    return res.status(400).json({ ok: false, error: 'bad score' });
  }

  const board = loadLeaderboard();
  const uid = String(user.id);
  const prevBest = board[uid] ? board[uid].score : 0;
  if (score > prevBest) {
    board[uid] = {
      score: Math.floor(score),
      name: user.username || user.first_name || 'Player',
      updated: Date.now()
    };
    saveLeaderboard(board);
  }

  res.json({ ok: true, best: Math.max(score, prevBest) });
});

// Simple top-N leaderboard, since Mini Apps don't get Telegram's native one.
app.get('/api/leaderboard', (_req, res) => {
  const board = loadLeaderboard();
  const top = Object.values(board)
    .sort((a, b) => b.score - a.score)
    .slice(0, 20)
    .map(({ name, score }) => ({ name, score }));
  res.json({ ok: true, top });
});

app.get('/health', (_req, res) => res.json({ ok: true }));

app.listen(PORT, async () => {
  console.log(`PTN-PNH Mini App bot server listening on :${PORT}`);
  try { await setupMenuButton(); } catch (e) { console.error('setupMenuButton failed', e); }
});

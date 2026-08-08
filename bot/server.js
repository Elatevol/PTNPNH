/**
 * PTN-PNH Telegram Game backend
 * ------------------------------
 * Implements the classic Telegram "Games" platform (not a Mini App):
 *  - Responds to /play with a sendGame message (a "Play" button).
 *  - Handles the callback_query that button generates and answers it
 *    with the URL of the HTML5 game, embedding signed player context
 *    in the query string so the game can report the score back to us.
 *  - Exposes POST /api/score, called by the game's JS when the run ends,
 *    verifies the signature, then calls Telegram's setGameScore so the
 *    score shows up in the chat's game leaderboard (getGameHighScores).
 *
 * The bot token NEVER goes to the browser - only this server holds it.
 */

const express = require('express');
const crypto = require('crypto');

const {
  BOT_TOKEN,           // from @BotFather
  GAME_SHORT_NAME,     // the short_name you set with /newgame
  GAME_URL,            // public HTTPS URL of game/index.html (e.g. GitHub Pages)
  SIGNING_SECRET,      // any random long string, used to sign context params
  PORT = 3000
} = process.env;

if (!BOT_TOKEN || !GAME_SHORT_NAME || !GAME_URL || !SIGNING_SECRET) {
  console.error('Missing required env vars. See .env.example');
  process.exit(1);
}

const API = `https://api.telegram.org/bot${BOT_TOKEN}`;

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

// Sign (user_id, chat_id, message_id/inline_message_id) so the game's
// call to /api/score can't be forged with an arbitrary score for a
// different user or chat.
function sign(ctx) {
  const base = [ctx.user_id, ctx.chat_id || '', ctx.message_id || '', ctx.inline_message_id || ''].join(':');
  return crypto.createHmac('sha256', SIGNING_SECRET).update(base).digest('hex').slice(0, 24);
}
function verify(ctx) {
  return ctx.sig && sign(ctx) === ctx.sig;
}

function buildGameUrl(ctx) {
  const sig = sign(ctx);
  const qs = new URLSearchParams({
    user_id: String(ctx.user_id),
    ...(ctx.chat_id ? { chat_id: String(ctx.chat_id) } : {}),
    ...(ctx.message_id ? { message_id: String(ctx.message_id) } : {}),
    ...(ctx.inline_message_id ? { inline_message_id: ctx.inline_message_id } : {}),
    sig
  });
  return `${GAME_URL}?${qs.toString()}`;
}

// ---------------------------------------------------------------------
// Telegram webhook
// ---------------------------------------------------------------------
app.post('/webhook', async (req, res) => {
  const update = req.body;
  try {
    if (update.message && update.message.text && /^\/(play|start)/.test(update.message.text)) {
      await tg('sendGame', {
        chat_id: update.message.chat.id,
        game_short_name: GAME_SHORT_NAME
      });
    }

    if (update.callback_query && update.callback_query.game_short_name === GAME_SHORT_NAME) {
      const cq = update.callback_query;
      const ctx = {
        user_id: cq.from.id,
        chat_id: cq.message ? cq.message.chat.id : undefined,
        message_id: cq.message ? cq.message.message_id : undefined,
        inline_message_id: cq.inline_message_id || undefined
      };
      await tg('answerCallbackQuery', {
        callback_query_id: cq.id,
        url: buildGameUrl(ctx)
      });
    }

    // Optional: handle inline queries so the game can be shared via @yourbot in any chat
    if (update.inline_query) {
      await tg('answerInlineQuery', {
        inline_query_id: update.inline_query.id,
        results: [{ type: 'game', id: 'ptn-pnh-1', game_short_name: GAME_SHORT_NAME }]
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
app.post('/api/score', async (req, res) => {
  const { user_id, chat_id, message_id, inline_message_id, score, sig } = req.body || {};

  if (!verify({ user_id, chat_id, message_id, inline_message_id, sig })) {
    return res.status(403).json({ ok: false, error: 'bad signature' });
  }
  if (typeof score !== 'number' || score < 0 || score > 100000) {
    return res.status(400).json({ ok: false, error: 'bad score' });
  }

  const payload = {
    user_id: Number(user_id),
    score: Math.floor(score),
    force: false // don't overwrite a higher existing score
  };
  if (inline_message_id) {
    payload.inline_message_id = inline_message_id;
  } else {
    payload.chat_id = Number(chat_id);
    payload.message_id = Number(message_id);
  }

  const result = await tg('setGameScore', payload);
  res.json({ ok: !!result.ok });
});

app.get('/health', (_req, res) => res.json({ ok: true }));

app.listen(PORT, () => console.log(`PTN-PNH bot server listening on :${PORT}`));

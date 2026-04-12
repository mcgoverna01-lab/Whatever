/**
 * AI analysis routes.
 *
 * /team         — full roster breakdown (strengths, weaknesses, timeline, trade ideas)
 * /trade        — "help me trade Player X" — returns 3-5 trade packages
 * /draft        — rookie draft strategy given the user's picks + roster
 *
 * All three are thin shells around a prompt builder + Claude call. The team
 * endpoint supports streaming so the UI can render cards as the JSON arrives.
 */
import { Router } from 'express';
import { callClaudeJson, extractJson, streamClaude } from '../services/claude.js';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const router = Router();

const SYSTEM_PROMPT = `You are an elite dynasty fantasy football analyst. You provide specific, actionable, opinionated advice — not generic hedged takes. When you recommend a trade target, name the player and explain why. When you say sell, commit to it. You understand PPR scoring, TEP formats, Superflex vs 1QB, and how age curves affect dynasty value. Respond ONLY in valid JSON matching the provided schema. No markdown, no preamble.`;

function rosterSummary({ league, roster }) {
  const flat = (arr) =>
    (arr || []).map((p) => ({
      name: p.name,
      pos: p.position,
      team: p.team,
      age: p.age,
      exp: p.experience
    }));
  return {
    league: {
      name: league.name,
      scoring: league.ppr,
      superflex: league.is_superflex,
      te_premium: league.te_premium,
      roster_positions: league.roster_positions,
      teams: league.total_rosters
    },
    roster: {
      starters: flat(roster.starters),
      bench: flat(roster.bench),
      taxi: flat(roster.taxi),
      ir: flat(roster.ir)
    }
  };
}

const TEAM_SCHEMA = `{
  "overall_grade": "A+|A|A-|B+|B|B-|C+|C|C-|D+|D|D-|F",
  "contention_window": "win-now|retool|rebuild",
  "window_summary": "1-2 sentences",
  "strengths": ["short bullet", "..."],
  "weaknesses": ["short bullet", "..."],
  "position_breakdown": {
    "QB": { "grade": "A-F letter", "starters": "...", "depth": "...", "aging": "...", "action": "..." },
    "RB": { "grade": "...", "starters": "...", "depth": "...", "aging": "...", "action": "..." },
    "WR": { "grade": "...", "starters": "...", "depth": "...", "aging": "...", "action": "..." },
    "TE": { "grade": "...", "starters": "...", "depth": "...", "aging": "...", "action": "..." }
  },
  "buy_targets": [{ "player": "Name", "position": "RB", "rationale": "..." }],
  "sell_candidates": [{ "player": "Name", "position": "RB", "rationale": "..." }],
  "draft_strategy": "2-3 sentence plan"
}`;

router.post('/team', async (req, res, next) => {
  try {
    const { league, roster } = req.body || {};
    if (!league || !roster) return res.status(400).json({ error: 'league and roster are required' });

    const user = `Analyze this dynasty roster. Be direct and opinionated.

LEAGUE + ROSTER:
${JSON.stringify(rosterSummary({ league, roster }), null, 2)}

Respond with a JSON object matching EXACTLY this schema (no extra keys, no markdown):
${TEAM_SCHEMA}`;

    const { json } = await callClaudeJson({ system: SYSTEM_PROMPT, user, maxTokens: 3500 });
    res.json(json);
  } catch (err) {
    next(err);
  }
});

/**
 * Streaming variant — sends text deltas as SSE so the client can start
 * rendering the JSON before it's complete.
 */
router.post('/team/stream', async (req, res) => {
  const { league, roster } = req.body || {};
  if (!league || !roster) {
    res.status(400).json({ error: 'league and roster are required' });
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const user = `Analyze this dynasty roster. Be direct and opinionated.

LEAGUE + ROSTER:
${JSON.stringify(rosterSummary({ league, roster }), null, 2)}

Respond with a JSON object matching EXACTLY this schema (no extra keys, no markdown):
${TEAM_SCHEMA}`;

  let buffer = '';
  await streamClaude({
    system: SYSTEM_PROMPT,
    user,
    maxTokens: 3500,
    onText: (delta) => {
      buffer += delta;
      res.write(`event: delta\ndata: ${JSON.stringify({ text: delta })}\n\n`);
    },
    onDone: () => {
      try {
        const parsed = extractJson(buffer);
        res.write(`event: done\ndata: ${JSON.stringify(parsed)}\n\n`);
      } catch (err) {
        res.write(`event: error\ndata: ${JSON.stringify({ error: err.message })}\n\n`);
      }
      res.end();
    },
    onError: (err) => {
      res.write(`event: error\ndata: ${JSON.stringify({ error: err.message })}\n\n`);
      res.end();
    }
  });
});

router.post('/trade', async (req, res, next) => {
  try {
    const { league, roster, playerToTrade } = req.body || {};
    if (!league || !roster || !playerToTrade) {
      return res.status(400).json({ error: 'league, roster and playerToTrade are required' });
    }

    const schema = `{
  "packages": [
    {
      "send": ["Player A", "2026 1st"],
      "receive": ["Player X", "Player Y"],
      "rationale": "why this fits the user's roster",
      "likelihood": "Low|Medium|High"
    }
  ]
}`;

    const user = `The user wants to trade AWAY: ${JSON.stringify(playerToTrade)}

CONTEXT:
${JSON.stringify(rosterSummary({ league, roster }), null, 2)}

Propose 3-5 realistic trade packages that other managers in this league might accept. Consider positional scarcity, age, league format. Respond as JSON matching:
${schema}`;

    const { json } = await callClaudeJson({
      system: SYSTEM_PROMPT,
      user,
      maxTokens: 2500
    });
    res.json(json);
  } catch (err) {
    next(err);
  }
});

router.post('/draft', async (req, res, next) => {
  try {
    const { league, roster, picks } = req.body || {};
    if (!league || !roster || !Array.isArray(picks) || picks.length === 0) {
      return res.status(400).json({ error: 'league, roster and picks[] are required' });
    }

    const rookies = JSON.parse(
      await readFile(join(__dirname, '..', 'data', 'rookies2026.json'), 'utf-8')
    );

    const schema = `{
  "strategy": "2-3 sentences on overall approach",
  "pick_plan": [
    {
      "pick": "1.04",
      "target": "Player name",
      "position": "RB",
      "rationale": "why",
      "fallbacks": ["Player B", "Player C"]
    }
  ],
  "trade_back_candidates": ["pick labels where trading back makes sense"]
}`;

    const user = `The user holds these rookie draft picks: ${picks.join(', ')}.

2026 rookie consensus rankings (top prospects):
${JSON.stringify(rookies, null, 2)}

Roster + league context:
${JSON.stringify(rosterSummary({ league, roster }), null, 2)}

Recommend a draft plan. For each pick the user holds, name a primary target and 2 fallbacks who should be available. Respond as JSON matching:
${schema}`;

    const { json } = await callClaudeJson({
      system: SYSTEM_PROMPT,
      user,
      maxTokens: 3000
    });
    res.json(json);
  } catch (err) {
    next(err);
  }
});

export default router;

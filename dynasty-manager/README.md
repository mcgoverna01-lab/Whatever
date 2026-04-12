# Dynasty Portfolio Manager

A personalized dynasty fantasy football roster analysis tool. Pull any public
Sleeper league, grade your roster, and get an opinionated AI breakdown — trade
targets, sell candidates, contention window, rookie draft plan — in under 30
seconds.

This is a **portfolio / demo project**, not a production SaaS. No auth, no user
accounts. Drop in your Sleeper username and go.

---

## Stack

- **Frontend**: React (Vite) + Tailwind CSS
- **Backend**: Node.js + Express (ESM)
- **AI**: Anthropic Claude Sonnet 4 (`claude-sonnet-4-20250514`)
- **Data**: [Sleeper API](https://docs.sleeper.com/) (public, no auth)
- **Cache**: SQLite via `better-sqlite3` (players snapshot, ~10MB, refreshed daily)

## Features

1. **League import via Sleeper username** — picks up all your 2025 leagues, you choose one.
2. **Roster dashboard** — starters / bench / taxi / IR, heuristic position grades, league settings summary.
3. **AI analysis engine** — strengths, weaknesses, contention window, position-by-position breakdown, buy/sell targets, draft strategy. Structured JSON response rendered as cards.
4. **Trade Finder** — pick a player to move, get 3-5 realistic packages with acceptance odds.
5. **Rookie Draft Simulator** — enter your picks (`1.04, 2.07, …`), get a targeted board with primary targets + fallbacks.

## Directory Layout

```
dynasty-manager/
├── client/           # Vite + React + Tailwind
│   ├── src/
│   │   ├── components/   # LeagueImport, RosterDashboard, PlayerCard, AnalysisPanel, TradeFinder, DraftSimulator, GradeBadge, LoadingState
│   │   ├── hooks/        # useSleeper, useAnalysis
│   │   └── utils/        # scoring, grading
│   └── vite.config.js    # dev proxy → :3001
└── server/           # Express + Claude + Sleeper
    ├── routes/       # sleeper.js, analysis.js
    ├── services/     # sleeper.js, players.js (SQLite cache), claude.js
    └── data/         # rookies2026.json (hardcoded top 36), players.db (cache)
```

## Running it

```bash
# from dynasty-manager/
cp .env.example .env   # then paste your ANTHROPIC_API_KEY
npm install
npm run dev
```

- Server: http://localhost:3001
- Client: http://localhost:5173

Client uses a Vite proxy for `/api`, so the browser only ever talks to the
Vite dev server — the Claude API key never leaves the backend.

## API

All routes are under `/api`.

### Sleeper proxy
| Route | Purpose |
|---|---|
| `GET /api/sleeper/user/:username` | Look up Sleeper user |
| `GET /api/sleeper/user/:userId/leagues?season=2025` | List user's leagues |
| `GET /api/sleeper/league/:leagueId/dossier?user_id=...` | Full roster + league settings, pre-joined with player metadata |

### Claude analysis
| Route | Body | Returns |
|---|---|---|
| `POST /api/analysis/team` | `{ league, roster }` | Full team breakdown JSON |
| `POST /api/analysis/team/stream` | same | SSE stream of deltas then `done` event |
| `POST /api/analysis/trade` | `{ league, roster, playerToTrade }` | `{ packages: [...] }` |
| `POST /api/analysis/draft` | `{ league, roster, picks: ['1.04', ...] }` | `{ strategy, pick_plan, trade_back_candidates }` |

## Design notes

- **Dark editorial theme** — `#0D0D0D` ink background, position accents
  (QB blue, RB emerald, WR amber, TE coral, picks purple), Clash Display
  headings over Inter body.
- **Heuristic grades first, AI grades second** — position grades render
  instantly from local logic in `utils/grading.js` so the dashboard isn't
  blank while Claude thinks. The AI produces a separate, opinionated grade.
- **Prompt engineering** — system prompt tells Claude to skip hedging and
  return JSON only. Each analysis route ships its schema inline with the
  user message so the model stays faithful to shape.
- **Caching** — Sleeper's `/players/nfl` is ~10MB. It's persisted in
  `server/data/players.db` and refreshed at most once per 24 hours.

## Known limitations

- Rookie rankings are hardcoded for the 2026 class (top 36). They're a
  prototype stand-in for what would otherwise be a live data feed.
- No auth / no persistence of user analyses across sessions.
- Player ages come from Sleeper `birth_date`; for a handful of players
  without one, age will show as `—`.
- The Trade Finder assumes the other managers in the league use roughly
  industry-consensus values — it doesn't yet scrape individual team
  tendencies.

## Stretch ideas (not yet built)

- Historical team-value tracking
- League-wide power rankings
- Trade alerts when a target dips in value
- Shareable PNG/PDF export of the analysis card

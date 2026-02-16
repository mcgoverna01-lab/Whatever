BEGIN;

-- ══════════════════════════════════════════════════════════════════
-- Auth: session tokens (stateless JWT is fine for API, but we track
-- refresh tokens server-side for revocation)
-- ══════════════════════════════════════════════════════════════════

CREATE TABLE refresh_tokens (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash  TEXT NOT NULL UNIQUE,
    expires_at  TIMESTAMPTZ NOT NULL,
    revoked     BOOLEAN NOT NULL DEFAULT false,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_refresh_tokens_user ON refresh_tokens (user_id);
CREATE INDEX idx_refresh_tokens_hash ON refresh_tokens (token_hash) WHERE NOT revoked;

-- ══════════════════════════════════════════════════════════════════
-- Trades
-- ══════════════════════════════════════════════════════════════════

CREATE TYPE trade_status AS ENUM ('proposed', 'accepted', 'vetoed', 'rejected', 'cancelled', 'completed');

CREATE TABLE trades (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    league_id       UUID NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
    proposer_id     UUID NOT NULL REFERENCES league_members(id),
    recipient_id    UUID NOT NULL REFERENCES league_members(id),
    status          trade_status NOT NULL DEFAULT 'proposed',
    /** Commissioner can veto within this window */
    veto_deadline   TIMESTAMPTZ,
    message         TEXT,
    proposed_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at     TIMESTAMPTZ,

    CHECK (proposer_id != recipient_id)
);

CREATE INDEX idx_trades_league ON trades (league_id);
CREATE INDEX idx_trades_pending ON trades (league_id, status) WHERE status IN ('proposed', 'accepted');

-- Players involved in a trade (many-to-many: each side offers players)
CREATE TABLE trade_players (
    trade_id    UUID NOT NULL REFERENCES trades(id) ON DELETE CASCADE,
    player_id   INT NOT NULL REFERENCES players(id),
    /** Which side is giving up this player */
    from_member_id UUID NOT NULL REFERENCES league_members(id),
    /** Which side is receiving this player */
    to_member_id   UUID NOT NULL REFERENCES league_members(id),

    PRIMARY KEY (trade_id, player_id)
);

-- Commissioner trade votes (for league-vote veto systems)
CREATE TABLE trade_votes (
    trade_id    UUID NOT NULL REFERENCES trades(id) ON DELETE CASCADE,
    member_id   UUID NOT NULL REFERENCES league_members(id),
    approve     BOOLEAN NOT NULL,
    voted_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

    PRIMARY KEY (trade_id, member_id)
);

-- ══════════════════════════════════════════════════════════════════
-- H2H matchups
-- ══════════════════════════════════════════════════════════════════

CREATE TABLE h2h_schedule (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    league_id       UUID NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
    gameweek        INT NOT NULL,
    home_member_id  UUID NOT NULL REFERENCES league_members(id),
    away_member_id  UUID NOT NULL REFERENCES league_members(id),

    UNIQUE (league_id, gameweek, home_member_id),
    UNIQUE (league_id, gameweek, away_member_id),
    CHECK (home_member_id != away_member_id)
);

CREATE INDEX idx_h2h_schedule_gw ON h2h_schedule (league_id, gameweek);

CREATE TABLE h2h_results (
    schedule_id     UUID PRIMARY KEY REFERENCES h2h_schedule(id) ON DELETE CASCADE,
    home_points     INT NOT NULL DEFAULT 0,
    away_points     INT NOT NULL DEFAULT 0,
    /** 'home', 'away', or 'draw' */
    winner          TEXT NOT NULL CHECK (winner IN ('home', 'away', 'draw')),
    calculated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- H2H standings (wins/draws/losses/points)
CREATE TABLE h2h_standings (
    league_id   UUID NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
    member_id   UUID NOT NULL REFERENCES league_members(id),
    gameweek    INT NOT NULL,
    wins        INT NOT NULL DEFAULT 0,
    draws       INT NOT NULL DEFAULT 0,
    losses      INT NOT NULL DEFAULT 0,
    /** H2H points: 3 for win, 1 for draw */
    h2h_points  INT NOT NULL DEFAULT 0,
    /** Cumulative FPL total (tiebreaker) */
    total_score INT NOT NULL DEFAULT 0,
    rank        INT NOT NULL,

    PRIMARY KEY (league_id, member_id, gameweek)
);

-- ══════════════════════════════════════════════════════════════════
-- League config extension: H2H vs total points
-- ══════════════════════════════════════════════════════════════════

ALTER TABLE leagues ADD COLUMN scoring_mode TEXT NOT NULL DEFAULT 'total_points'
    CHECK (scoring_mode IN ('total_points', 'h2h', 'h2h_and_total'));

-- Trade review period (hours). NULL = commissioner veto only.
ALTER TABLE leagues ADD COLUMN trade_review_hours INT DEFAULT 24;

-- ══════════════════════════════════════════════════════════════════
-- FPL sync tracking
-- ══════════════════════════════════════════════════════════════════

CREATE TABLE fpl_sync_log (
    id              SERIAL PRIMARY KEY,
    sync_type       TEXT NOT NULL,  -- 'bootstrap', 'gameweek_stats', 'live'
    gameweek        INT,
    players_updated INT NOT NULL DEFAULT 0,
    started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at    TIMESTAMPTZ,
    error           TEXT
);

COMMIT;

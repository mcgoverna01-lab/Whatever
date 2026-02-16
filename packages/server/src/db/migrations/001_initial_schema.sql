-- Pitch Draft: Initial Schema
-- PostgreSQL 16+ required (for UUIDv7 via gen_random_uuid fallback)
-- All timestamps are timestamptz (UTC).

BEGIN;

-- ══════════════════════════════════════════════════════════════════
-- Extensions
-- ══════════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ══════════════════════════════════════════════════════════════════
-- ENUM types
-- ══════════════════════════════════════════════════════════════════

CREATE TYPE league_status AS ENUM ('pending', 'drafting', 'active', 'completed');
CREATE TYPE draft_type AS ENUM ('snake', 'linear', 'auction');
CREATE TYPE draft_status AS ENUM ('scheduled', 'in_progress', 'paused', 'completed');
CREATE TYPE position_type AS ENUM ('GKP', 'DEF', 'MID', 'FWD');
CREATE TYPE roster_slot AS ENUM ('GKP', 'DEF', 'MID', 'FWD', 'BENCH');
CREATE TYPE waiver_status AS ENUM ('pending', 'processing', 'approved', 'rejected', 'cancelled');
CREATE TYPE transaction_type AS ENUM ('draft', 'waiver', 'faab', 'free_agent', 'trade');

-- ══════════════════════════════════════════════════════════════════
-- Users
-- ══════════════════════════════════════════════════════════════════

CREATE TABLE users (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email       TEXT NOT NULL UNIQUE,
    username    TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_users_email ON users (email);

-- ══════════════════════════════════════════════════════════════════
-- Players (synced from FPL API)
-- ══════════════════════════════════════════════════════════════════

CREATE TABLE players (
    id              SERIAL PRIMARY KEY,
    fpl_id          INT NOT NULL UNIQUE,
    web_name        TEXT NOT NULL,
    first_name      TEXT NOT NULL,
    last_name       TEXT NOT NULL,
    position        position_type NOT NULL,
    club_code       TEXT NOT NULL,          -- 3-letter code
    club_name       TEXT NOT NULL,
    now_cost        INT NOT NULL,           -- tenths of millions
    total_points    INT NOT NULL DEFAULT 0,
    points_per_game NUMERIC(5,2) NOT NULL DEFAULT 0,
    minutes         INT NOT NULL DEFAULT 0,
    available       BOOLEAN NOT NULL DEFAULT true,
    news            TEXT,
    chance_of_playing_next_round INT,
    synced_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_players_fpl_id ON players (fpl_id);
CREATE INDEX idx_players_position ON players (position);
CREATE INDEX idx_players_club ON players (club_code);

-- ══════════════════════════════════════════════════════════════════
-- Leagues
-- ══════════════════════════════════════════════════════════════════

CREATE TABLE leagues (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name                TEXT NOT NULL,
    season              TEXT NOT NULL,           -- e.g. '2025-26'
    size                INT NOT NULL CHECK (size BETWEEN 4 AND 16),
    draft_type          draft_type NOT NULL DEFAULT 'snake',
    faab_budget         INT NOT NULL DEFAULT 100,
    status              league_status NOT NULL DEFAULT 'pending',
    waiver_deadline_day INT CHECK (waiver_deadline_day BETWEEN 1 AND 7),
    draft_scheduled_at  TIMESTAMPTZ,
    created_by          UUID NOT NULL REFERENCES users(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ══════════════════════════════════════════════════════════════════
-- League members
-- ══════════════════════════════════════════════════════════════════

CREATE TABLE league_members (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    league_id       UUID NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES users(id),
    team_name       TEXT NOT NULL,
    draft_seed      INT,                    -- set before draft, 1-indexed
    faab_remaining  INT NOT NULL DEFAULT 100,
    joined_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (league_id, user_id),
    UNIQUE (league_id, draft_seed)          -- no duplicate seeds
);

CREATE INDEX idx_league_members_league ON league_members (league_id);

-- ══════════════════════════════════════════════════════════════════
-- Drafts
-- ══════════════════════════════════════════════════════════════════

CREATE TABLE drafts (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    league_id           UUID NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
    status              draft_status NOT NULL DEFAULT 'scheduled',
    total_rounds        INT NOT NULL DEFAULT 15,
    current_round       INT NOT NULL DEFAULT 1,
    current_pick        INT NOT NULL DEFAULT 1,
    pick_timer_seconds  INT NOT NULL DEFAULT 120,
    pick_timer_started_at TIMESTAMPTZ,
    started_at          TIMESTAMPTZ,
    completed_at        TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (league_id)  -- one draft per league (for now)
);

-- ══════════════════════════════════════════════════════════════════
-- Draft queue: pre-computed pick order
-- This is the turn queue. Snake order is materialized here.
-- The pick operation is a single-row UPDATE on this table.
-- ══════════════════════════════════════════════════════════════════

CREATE TABLE draft_queue (
    draft_id        UUID NOT NULL REFERENCES drafts(id) ON DELETE CASCADE,
    overall_pick    INT NOT NULL,           -- 1-indexed, globally unique per draft
    round           INT NOT NULL,
    pick_in_round   INT NOT NULL,
    member_id       UUID NOT NULL REFERENCES league_members(id),
    player_id       INT REFERENCES players(id),  -- NULL until picked
    picked_at       TIMESTAMPTZ,
    auto_pick       BOOLEAN NOT NULL DEFAULT false,

    PRIMARY KEY (draft_id, overall_pick)
);

-- Fast lookup: "is this player already drafted in this draft?"
CREATE UNIQUE INDEX idx_draft_queue_player
    ON draft_queue (draft_id, player_id)
    WHERE player_id IS NOT NULL;

-- Fast lookup: "whose turn is it?" (first unpicked entry)
CREATE INDEX idx_draft_queue_current
    ON draft_queue (draft_id, overall_pick)
    WHERE player_id IS NULL;

-- ══════════════════════════════════════════════════════════════════
-- Draft picks: immutable event log
-- Source of truth. draft_queue is the materialized view.
-- ══════════════════════════════════════════════════════════════════

CREATE TABLE draft_picks (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    draft_id        UUID NOT NULL REFERENCES drafts(id) ON DELETE CASCADE,
    overall_pick    INT NOT NULL,
    member_id       UUID NOT NULL REFERENCES league_members(id),
    player_id       INT NOT NULL REFERENCES players(id),
    auto_pick       BOOLEAN NOT NULL DEFAULT false,
    picked_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (draft_id, overall_pick),
    UNIQUE (draft_id, player_id)            -- can't draft same player twice
);

CREATE INDEX idx_draft_picks_member ON draft_picks (member_id);

-- ══════════════════════════════════════════════════════════════════
-- Rosters
-- ══════════════════════════════════════════════════════════════════

CREATE TABLE rosters (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    member_id       UUID NOT NULL REFERENCES league_members(id) ON DELETE CASCADE,
    player_id       INT NOT NULL REFERENCES players(id),
    slot            roster_slot NOT NULL DEFAULT 'BENCH',
    bench_order     INT,                    -- 0-3 for bench, NULL for starters
    gameweek        INT,                    -- NULL = current/default

    UNIQUE (member_id, player_id),          -- can't roster same player twice
    UNIQUE (member_id, bench_order, gameweek) -- no duplicate bench positions
        -- Note: NULLs are distinct in UNIQUE, so starters don't conflict
);

CREATE INDEX idx_rosters_member ON rosters (member_id);

-- ══════════════════════════════════════════════════════════════════
-- Waiver claims (priority-based)
-- ══════════════════════════════════════════════════════════════════

CREATE TABLE waiver_claims (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    league_id       UUID NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
    member_id       UUID NOT NULL REFERENCES league_members(id),
    gameweek        INT NOT NULL,
    player_in_id    INT NOT NULL REFERENCES players(id),
    player_out_id   INT NOT NULL REFERENCES players(id),
    priority        INT NOT NULL,           -- within member's claims
    status          waiver_status NOT NULL DEFAULT 'pending',
    rejection_reason TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    processed_at    TIMESTAMPTZ
);

CREATE INDEX idx_waiver_claims_pending
    ON waiver_claims (league_id, gameweek, status)
    WHERE status = 'pending';

-- ══════════════════════════════════════════════════════════════════
-- FAAB bids (sealed blind auction)
-- ══════════════════════════════════════════════════════════════════

CREATE TABLE faab_bids (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    league_id       UUID NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
    member_id       UUID NOT NULL REFERENCES league_members(id),
    gameweek        INT NOT NULL,
    player_in_id    INT NOT NULL REFERENCES players(id),
    player_out_id   INT NOT NULL REFERENCES players(id),
    amount          INT NOT NULL CHECK (amount >= 0),
    status          waiver_status NOT NULL DEFAULT 'pending',
    winning_amount  INT,
    rejection_reason TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    processed_at    TIMESTAMPTZ
);

CREATE INDEX idx_faab_bids_pending
    ON faab_bids (league_id, gameweek, status)
    WHERE status = 'pending';

-- ══════════════════════════════════════════════════════════════════
-- Waiver priority (rolling waivers)
-- ══════════════════════════════════════════════════════════════════

CREATE TABLE waiver_priority (
    league_id   UUID NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
    member_id   UUID NOT NULL REFERENCES league_members(id),
    priority    INT NOT NULL,

    PRIMARY KEY (league_id, member_id),
    UNIQUE (league_id, priority)
);

-- ══════════════════════════════════════════════════════════════════
-- Transaction log (immutable audit trail)
-- ══════════════════════════════════════════════════════════════════

CREATE TABLE transactions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    league_id       UUID NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
    member_id       UUID NOT NULL REFERENCES league_members(id),
    type            transaction_type NOT NULL,
    player_in_id    INT NOT NULL REFERENCES players(id),
    player_out_id   INT REFERENCES players(id),
    gameweek        INT,
    faab_spent      INT,
    source_id       UUID NOT NULL,          -- polymorphic FK to claim/bid/trade/pick
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_transactions_league_gw ON transactions (league_id, gameweek);
CREATE INDEX idx_transactions_member ON transactions (member_id);

-- ══════════════════════════════════════════════════════════════════
-- Gameweek player stats (synced from FPL API after each GW)
-- ══════════════════════════════════════════════════════════════════

CREATE TABLE gameweek_stats (
    player_id       INT NOT NULL REFERENCES players(id),
    gameweek        INT NOT NULL,
    minutes         INT NOT NULL DEFAULT 0,
    goals           INT NOT NULL DEFAULT 0,
    assists         INT NOT NULL DEFAULT 0,
    clean_sheet     BOOLEAN NOT NULL DEFAULT false,
    goals_conceded  INT NOT NULL DEFAULT 0,
    saves           INT NOT NULL DEFAULT 0,
    penalties_saved INT NOT NULL DEFAULT 0,
    penalties_missed INT NOT NULL DEFAULT 0,
    yellow_cards    INT NOT NULL DEFAULT 0,
    red_cards       INT NOT NULL DEFAULT 0,
    own_goals       INT NOT NULL DEFAULT 0,
    bonus           INT NOT NULL DEFAULT 0,
    total_points    INT NOT NULL DEFAULT 0,
    synced_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

    PRIMARY KEY (player_id, gameweek)
);

-- ══════════════════════════════════════════════════════════════════
-- Gameweek team scores (materialized after scoring runs)
-- ══════════════════════════════════════════════════════════════════

CREATE TABLE gameweek_team_scores (
    member_id       UUID NOT NULL REFERENCES league_members(id),
    gameweek        INT NOT NULL,
    starting_points INT NOT NULL DEFAULT 0,
    bench_points    INT NOT NULL DEFAULT 0,
    total_points    INT NOT NULL DEFAULT 0,
    auto_subs       JSONB NOT NULL DEFAULT '[]',
    calculated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

    PRIMARY KEY (member_id, gameweek)
);

-- ══════════════════════════════════════════════════════════════════
-- League standings (materialized, recalculated after each GW)
-- ══════════════════════════════════════════════════════════════════

CREATE TABLE league_standings (
    league_id       UUID NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
    member_id       UUID NOT NULL REFERENCES league_members(id),
    gameweek        INT NOT NULL,
    total_points    INT NOT NULL DEFAULT 0,
    rank            INT NOT NULL,

    PRIMARY KEY (league_id, member_id, gameweek)
);

CREATE INDEX idx_standings_rank ON league_standings (league_id, gameweek, rank);

COMMIT;

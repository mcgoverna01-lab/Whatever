BEGIN;

-- ══════════════════════════════════════════════════════════════════
-- Sleeper integration columns on league_members
-- ══════════════════════════════════════════════════════════════════

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'league_members' AND column_name = 'sleeper_user_id'
    ) THEN
        ALTER TABLE league_members ADD COLUMN sleeper_user_id TEXT;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'league_members' AND column_name = 'sleeper_roster_id'
    ) THEN
        ALTER TABLE league_members ADD COLUMN sleeper_roster_id INT;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'leagues' AND column_name = 'sleeper_league_id'
    ) THEN
        ALTER TABLE leagues ADD COLUMN sleeper_league_id TEXT;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_league_members_sleeper
    ON league_members (sleeper_user_id)
    WHERE sleeper_user_id IS NOT NULL;

-- ══════════════════════════════════════════════════════════════════
-- Projection accuracy snapshots
--
-- Records every projection made before each gameweek, then stores
-- the actual points after the GW is complete. Used to measure how
-- accurate each engine is over time.
-- ══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS projection_snapshots (
    id          SERIAL PRIMARY KEY,
    engine      TEXT        NOT NULL,         -- 'heuristic' | 'ai'
    gameweek    INT         NOT NULL,
    player_id   INT         NOT NULL,         -- FPL player ID
    projected   FLOAT       NOT NULL,         -- projected points for GW
    actual      FLOAT,                        -- filled after GW completes (NULL = pending)
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (engine, gameweek, player_id)
);

CREATE INDEX IF NOT EXISTS projection_snapshots_gw_idx
    ON projection_snapshots (gameweek DESC, engine);

CREATE INDEX IF NOT EXISTS projection_snapshots_engine_idx
    ON projection_snapshots (engine, actual)
    WHERE actual IS NOT NULL;

COMMIT;

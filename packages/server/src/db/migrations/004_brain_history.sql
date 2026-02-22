BEGIN;

-- ══════════════════════════════════════════════════════════════════
-- Brain: projection + recommendation history
--
-- Stores brain analysis results so users can review past advice,
-- track accuracy over time, and enable the AI engine to learn.
-- ══════════════════════════════════════════════════════════════════

CREATE TABLE brain_results (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    league_id       UUID NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
    member_id       UUID NOT NULL REFERENCES league_members(id) ON DELETE CASCADE,
    result_type     TEXT NOT NULL CHECK (result_type IN ('waiver', 'faab', 'trade')),
    gameweek        INT NOT NULL,
    result          JSONB NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_brain_results_lookup
    ON brain_results (league_id, member_id, result_type, created_at DESC);

CREATE INDEX idx_brain_results_gameweek
    ON brain_results (league_id, gameweek);

-- ══════════════════════════════════════════════════════════════════
-- Player projection snapshots — track how projections change weekly
-- ══════════════════════════════════════════════════════════════════

CREATE TABLE brain_projections (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    league_id       UUID NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
    player_id       INT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    gameweek        INT NOT NULL,
    engine          TEXT NOT NULL,        -- 'heuristic' or 'ai'
    projected_ros   NUMERIC(8,2) NOT NULL,
    projected_ppg   NUMERIC(6,2) NOT NULL,
    confidence      NUMERIC(4,2) NOT NULL,
    breakdown       JSONB,                -- weekly breakdown if available
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (league_id, player_id, gameweek, engine)
);

CREATE INDEX idx_brain_projections_player
    ON brain_projections (player_id, gameweek DESC);

-- ══════════════════════════════════════════════════════════════════
-- FAAB remaining tracking on league_members
-- ══════════════════════════════════════════════════════════════════

-- Add faab_remaining to league_members if not present
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'league_members' AND column_name = 'faab_remaining'
    ) THEN
        ALTER TABLE league_members ADD COLUMN faab_remaining INT NOT NULL DEFAULT 100;
    END IF;
END $$;

COMMIT;

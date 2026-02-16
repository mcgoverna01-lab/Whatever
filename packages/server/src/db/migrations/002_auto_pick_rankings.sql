BEGIN;

-- Pre-draft player rankings for auto-pick fallback.
-- Managers can rank players before/during the draft.
-- When their timer expires, auto-pick uses this list.
CREATE TABLE auto_pick_rankings (
    draft_id    UUID NOT NULL REFERENCES drafts(id) ON DELETE CASCADE,
    member_id   UUID NOT NULL REFERENCES league_members(id),
    player_id   INT NOT NULL REFERENCES players(id),
    rank        INT NOT NULL,

    PRIMARY KEY (draft_id, member_id, player_id),
    UNIQUE (draft_id, member_id, rank)
);

COMMIT;

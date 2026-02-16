import type { DraftPick } from '@pitch-draft/shared';

interface PickHistoryProps {
  picks: DraftPick[];
}

export function PickHistory({ picks }: PickHistoryProps) {
  return (
    <div className="pick-history">
      <h3>Pick History</h3>
      {picks.length === 0 ? (
        <p className="no-picks">No picks yet</p>
      ) : (
        <ul className="pick-list">
          {[...picks].reverse().map((pick) => (
            <li key={pick.id} className={`pick-item ${pick.autoPick ? 'auto' : ''}`}>
              <span className="pick-number">#{pick.overallPick}</span>
              <span className="pick-player">Player #{pick.playerId}</span>
              {pick.autoPick && <span className="auto-badge">AUTO</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

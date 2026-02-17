import type { MockPlayer } from '../mock/players.js';

interface Props {
  roster: MockPlayer[];
  teamName: string;
  faabRemaining: number;
}

const SLOT_ORDER: Record<string, number> = { GKP: 0, DEF: 1, MID: 2, FWD: 3 };

export function RosterView({ roster, teamName, faabRemaining }: Props) {
  const sorted = [...roster].sort(
    (a, b) => (SLOT_ORDER[a.position] ?? 99) - (SLOT_ORDER[b.position] ?? 99),
  );

  // Split into starters / bench (first 11 starters, last assigned to bench)
  const starters = sorted.slice(0, Math.min(11, sorted.length));
  const bench = sorted.slice(11);

  const posCount: Record<string, number> = {};
  for (const p of roster) {
    posCount[p.position] = (posCount[p.position] ?? 0) + 1;
  }

  return (
    <div className="roster-page">
      {/* Roster Header */}
      <div className="roster-header">
        <div>
          <h2 className="roster-team-name">{teamName}</h2>
          <span className="roster-subtitle">{roster.length}/15 players</span>
        </div>
        <div className="roster-meta">
          <div className="meta-item">
            <span className="meta-value">{faabRemaining}</span>
            <span className="meta-label">FAAB</span>
          </div>
          <div className="meta-item">
            <span className="meta-value">{posCount['GKP'] ?? 0}</span>
            <span className="meta-label">GKP</span>
          </div>
          <div className="meta-item">
            <span className="meta-value">{posCount['DEF'] ?? 0}</span>
            <span className="meta-label">DEF</span>
          </div>
          <div className="meta-item">
            <span className="meta-value">{posCount['MID'] ?? 0}</span>
            <span className="meta-label">MID</span>
          </div>
          <div className="meta-item">
            <span className="meta-value">{posCount['FWD'] ?? 0}</span>
            <span className="meta-label">FWD</span>
          </div>
        </div>
      </div>

      {/* Pitch View */}
      <div className="pitch">
        <div className="pitch-bg">
          <div className="pitch-line center-circle" />
          <div className="pitch-line halfway" />

          {/* GKP Row */}
          <div className="pitch-row gkp-row">
            {starters.filter((p) => p.position === 'GKP').map((p) => (
              <PlayerCard key={p.id} player={p} />
            ))}
          </div>

          {/* DEF Row */}
          <div className="pitch-row def-row">
            {starters.filter((p) => p.position === 'DEF').map((p) => (
              <PlayerCard key={p.id} player={p} />
            ))}
          </div>

          {/* MID Row */}
          <div className="pitch-row mid-row">
            {starters.filter((p) => p.position === 'MID').map((p) => (
              <PlayerCard key={p.id} player={p} />
            ))}
          </div>

          {/* FWD Row */}
          <div className="pitch-row fwd-row">
            {starters.filter((p) => p.position === 'FWD').map((p) => (
              <PlayerCard key={p.id} player={p} />
            ))}
          </div>
        </div>
      </div>

      {/* Bench */}
      {bench.length > 0 && (
        <div className="bench-section">
          <h3 className="bench-title">Bench</h3>
          <div className="bench-row">
            {bench.map((p) => (
              <PlayerCard key={p.id} player={p} isBench />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function PlayerCard({ player, isBench }: { player: MockPlayer; isBench?: boolean }) {
  return (
    <div className={`player-card ${isBench ? 'bench' : ''}`}>
      <div className={`player-card-pos pos-${player.position.toLowerCase()}`}>
        {player.position}
      </div>
      <div className="player-card-name">{player.webName}</div>
      <div className="player-card-club">{player.clubCode}</div>
      <div className="player-card-pts">{player.totalPoints} pts</div>
      {player.news && (
        <div className="player-card-injury" title={player.news}>!</div>
      )}
    </div>
  );
}

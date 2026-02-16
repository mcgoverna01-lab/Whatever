import { useState, useEffect } from 'react';
import type { Player, Position } from '@pitch-draft/shared';

interface PlayerBoardProps {
  draftedPlayerIds: Set<number>;
  isMyTurn: boolean;
  onPick: (playerId: number) => void;
}

type SortField = 'totalPoints' | 'nowCost' | 'pointsPerGame' | 'webName';

export function PlayerBoard({
  draftedPlayerIds,
  isMyTurn,
  onPick,
}: PlayerBoardProps) {
  const [players, setPlayers] = useState<Player[]>([]);
  const [positionFilter, setPositionFilter] = useState<Position | 'ALL'>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortField, setSortField] = useState<SortField>('totalPoints');
  const [sortAsc, setSortAsc] = useState(false);

  // Fetch players on mount
  useEffect(() => {
    fetch('/api/players')
      .then((r) => r.json())
      .then(setPlayers)
      .catch(console.error);
  }, []);

  const filteredPlayers = players
    .filter((p) => {
      if (draftedPlayerIds.has(p.id)) return false;
      if (positionFilter !== 'ALL' && p.position !== positionFilter) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        return (
          p.webName.toLowerCase().includes(q) ||
          p.clubCode.toLowerCase().includes(q)
        );
      }
      return true;
    })
    .sort((a, b) => {
      const aVal = a[sortField];
      const bVal = b[sortField];
      if (typeof aVal === 'string' && typeof bVal === 'string') {
        return sortAsc ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      }
      return sortAsc
        ? (aVal as number) - (bVal as number)
        : (bVal as number) - (aVal as number);
    });

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortAsc(!sortAsc);
    } else {
      setSortField(field);
      setSortAsc(false);
    }
  };

  return (
    <div className="player-board">
      <div className="board-controls">
        <input
          type="text"
          placeholder="Search players..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="search-input"
        />
        <div className="position-filters">
          {(['ALL', 'GKP', 'DEF', 'MID', 'FWD'] as const).map((pos) => (
            <button
              key={pos}
              className={`filter-btn ${positionFilter === pos ? 'active' : ''}`}
              onClick={() => setPositionFilter(pos)}
            >
              {pos}
            </button>
          ))}
        </div>
      </div>

      <table className="player-table">
        <thead>
          <tr>
            <th onClick={() => handleSort('webName')}>Player</th>
            <th>Pos</th>
            <th>Club</th>
            <th onClick={() => handleSort('totalPoints')}>Pts</th>
            <th onClick={() => handleSort('pointsPerGame')}>PPG</th>
            <th onClick={() => handleSort('nowCost')}>Price</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {filteredPlayers.map((player) => (
            <tr key={player.id} className={`position-${player.position.toLowerCase()}`}>
              <td className="player-name">
                {player.webName}
                {player.news && <span className="injury-flag" title={player.news}>!</span>}
              </td>
              <td className="player-pos">{player.position}</td>
              <td className="player-club">{player.clubCode}</td>
              <td className="player-pts">{player.totalPoints}</td>
              <td className="player-ppg">{player.pointsPerGame}</td>
              <td className="player-cost">{(player.nowCost / 10).toFixed(1)}</td>
              <td>
                <button
                  className="pick-btn"
                  disabled={!isMyTurn}
                  onClick={() => onPick(player.id)}
                >
                  Draft
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

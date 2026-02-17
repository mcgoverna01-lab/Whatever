import { useState } from 'react';
import type { MockPlayer } from '../mock/players.js';

interface Props {
  availablePlayers: MockPlayer[];
  roster: MockPlayer[];
  faabRemaining: number;
}

interface WaiverClaim {
  playerIn: MockPlayer;
  playerOut: MockPlayer;
  faabBid: number | null;
  priority: number;
}

export function WaiverView({ availablePlayers, roster, faabRemaining }: Props) {
  const [mode, setMode] = useState<'waiver' | 'faab'>('waiver');
  const [claims, setClaims] = useState<WaiverClaim[]>([]);
  const [selectedIn, setSelectedIn] = useState<MockPlayer | null>(null);
  const [selectedOut, setSelectedOut] = useState<MockPlayer | null>(null);
  const [bidAmount, setBidAmount] = useState(0);
  const [search, setSearch] = useState('');
  const [posFilter, setPosFilter] = useState<string>('ALL');

  const filtered = availablePlayers
    .filter((p) => posFilter === 'ALL' || p.position === posFilter)
    .filter((p) => {
      if (!search) return true;
      return p.webName.toLowerCase().includes(search.toLowerCase());
    })
    .sort((a, b) => b.totalPoints - a.totalPoints);

  const addClaim = () => {
    if (!selectedIn || !selectedOut) return;
    setClaims((prev) => [
      ...prev,
      {
        playerIn: selectedIn,
        playerOut: selectedOut,
        faabBid: mode === 'faab' ? bidAmount : null,
        priority: prev.length + 1,
      },
    ]);
    setSelectedIn(null);
    setSelectedOut(null);
    setBidAmount(0);
  };

  const removeClaim = (idx: number) => {
    setClaims((prev) => prev.filter((_, i) => i !== idx).map((c, i) => ({ ...c, priority: i + 1 })));
  };

  return (
    <div className="waiver-page">
      <div className="waiver-header">
        <div>
          <h2>Waiver Wire</h2>
          <span className="waiver-subtitle">
            Deadline: Tuesday 11:00 AM &middot; FAAB: {faabRemaining} remaining
          </span>
        </div>
        <div className="standings-toggle">
          <button className={`toggle-btn ${mode === 'waiver' ? 'active' : ''}`} onClick={() => setMode('waiver')}>
            Priority Waiver
          </button>
          <button className={`toggle-btn ${mode === 'faab' ? 'active' : ''}`} onClick={() => setMode('faab')}>
            FAAB Bid
          </button>
        </div>
      </div>

      <div className="waiver-layout">
        {/* Pending Claims */}
        <div className="waiver-claims">
          <h3 className="section-label">
            {mode === 'waiver' ? 'Pending Claims' : 'Pending Bids'} ({claims.length})
          </h3>
          {claims.length === 0 ? (
            <p className="empty-text">No pending claims. Select a player to add below.</p>
          ) : (
            <div className="claim-list">
              {claims.map((c, i) => (
                <div key={i} className="claim-card">
                  <span className="claim-priority">#{c.priority}</span>
                  <div className="claim-swap">
                    <div className="claim-in">
                      <span className={`pos-badge pos-${c.playerIn.position.toLowerCase()}`}>
                        {c.playerIn.position}
                      </span>
                      <span>{c.playerIn.webName}</span>
                      <span className="claim-club">{c.playerIn.clubCode}</span>
                    </div>
                    <span className="swap-arrow">for</span>
                    <div className="claim-out">
                      <span>{c.playerOut.webName}</span>
                      <span className="claim-club">{c.playerOut.clubCode}</span>
                    </div>
                  </div>
                  {c.faabBid !== null && (
                    <span className="claim-bid">{c.faabBid} FAAB</span>
                  )}
                  <button className="remove-btn" onClick={() => removeClaim(i)}>X</button>
                </div>
              ))}
              <button className="submit-claims-btn">
                Submit {claims.length} {mode === 'waiver' ? 'Claim' : 'Bid'}{claims.length > 1 ? 's' : ''}
              </button>
            </div>
          )}

          {/* Add Claim Form */}
          {selectedIn && (
            <div className="add-claim-form">
              <h4>Adding: {selectedIn.webName} ({selectedIn.position})</h4>
              <div className="form-field">
                <label>Drop player:</label>
                <select
                  value={selectedOut?.id ?? ''}
                  onChange={(e) => setSelectedOut(roster.find((p) => p.id === Number(e.target.value)) ?? null)}
                >
                  <option value="">Select player to drop...</option>
                  {roster.map((p) => (
                    <option key={p.id} value={p.id}>{p.webName} ({p.position} - {p.clubCode})</option>
                  ))}
                </select>
              </div>
              {mode === 'faab' && (
                <div className="form-field">
                  <label>Bid amount:</label>
                  <input
                    type="number"
                    min={0}
                    max={faabRemaining}
                    value={bidAmount}
                    onChange={(e) => setBidAmount(Number(e.target.value))}
                  />
                  <span className="form-hint">of {faabRemaining} FAAB</span>
                </div>
              )}
              <div className="form-actions">
                <button className="confirm-btn" onClick={addClaim} disabled={!selectedOut}>
                  Add {mode === 'waiver' ? 'Claim' : 'Bid'}
                </button>
                <button className="cancel-btn" onClick={() => setSelectedIn(null)}>Cancel</button>
              </div>
            </div>
          )}
        </div>

        {/* Free Agent List */}
        <div className="free-agents">
          <div className="board-controls">
            <input
              type="text"
              placeholder="Search free agents..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="search-input"
            />
            <div className="position-filters">
              {['ALL', 'GKP', 'DEF', 'MID', 'FWD'].map((pos) => (
                <button
                  key={pos}
                  className={`filter-btn ${posFilter === pos ? 'active' : ''}`}
                  onClick={() => setPosFilter(pos)}
                >
                  {pos}
                </button>
              ))}
            </div>
          </div>

          <div className="player-table-wrapper">
            <table className="player-table">
              <thead>
                <tr>
                  <th>Player</th>
                  <th>Pos</th>
                  <th>Club</th>
                  <th>Pts</th>
                  <th>PPG</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, 30).map((player) => (
                  <tr key={player.id} className={`position-${player.position.toLowerCase()}`}>
                    <td className="player-name">
                      {player.webName}
                      {player.news && <span className="injury-flag" title={player.news}>!</span>}
                    </td>
                    <td className="player-pos">{player.position}</td>
                    <td className="player-club">{player.clubCode}</td>
                    <td className="player-pts">{player.totalPoints}</td>
                    <td className="player-ppg">{player.pointsPerGame.toFixed(1)}</td>
                    <td>
                      <button
                        className="pick-btn"
                        onClick={() => setSelectedIn(player)}
                        disabled={!!selectedIn}
                      >
                        {mode === 'waiver' ? 'Claim' : 'Bid'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

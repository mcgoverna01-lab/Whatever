import { useState, useEffect } from 'react';
import type { MockPlayer } from '../mock/players.js';
import type { MockDraftPick, MockMember } from '../mock/league.js';

interface Props {
  picks: MockDraftPick[];
  availablePlayers: MockPlayer[];
  members: MockMember[];
  currentMemberId: string;
}

export function DraftRoomDemo({ picks, availablePlayers, members, currentMemberId }: Props) {
  const [visiblePicks, setVisiblePicks] = useState(0);
  const [timerValue, setTimerValue] = useState(87);
  const [posFilter, setPosFilter] = useState<string>('ALL');
  const [search, setSearch] = useState('');
  const [isLive, setIsLive] = useState(false);

  // Animate picks flowing in
  useEffect(() => {
    if (!isLive) {
      setVisiblePicks(picks.length);
      return;
    }
    setVisiblePicks(0);
    const interval = setInterval(() => {
      setVisiblePicks((v) => {
        if (v >= picks.length) {
          clearInterval(interval);
          return v;
        }
        return v + 1;
      });
    }, 800);
    return () => clearInterval(interval);
  }, [isLive, picks.length]);

  // Timer countdown
  useEffect(() => {
    if (!isLive) return;
    const interval = setInterval(() => {
      setTimerValue((v) => {
        if (v <= 0) return 120;
        return v - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [isLive]);

  const currentPick = picks[visiblePicks];
  const draftedIds = new Set(picks.slice(0, visiblePicks).map((p) => p.player.id));

  const filteredAvailable = availablePlayers
    .concat(picks.slice(visiblePicks).map((p) => p.player))
    .filter((p) => !draftedIds.has(p.id))
    .filter((p) => posFilter === 'ALL' || p.position === posFilter)
    .filter((p) => {
      if (!search) return true;
      return p.webName.toLowerCase().includes(search.toLowerCase()) ||
             p.clubCode.toLowerCase().includes(search.toLowerCase());
    })
    .sort((a, b) => b.totalPoints - a.totalPoints);

  const minutes = Math.floor(timerValue / 60);
  const seconds = timerValue % 60;
  const urgency = timerValue <= 10 ? 'critical' : timerValue <= 30 ? 'warning' : 'normal';
  const isMyTurn = currentPick?.memberId === currentMemberId;

  return (
    <div className="draft-room">
      {/* Draft status bar */}
      <div className="draft-status-bar">
        <div className="draft-progress">
          <span className="draft-progress-text">
            Round {Math.ceil((visiblePicks + 1) / members.length)} &middot;
            Pick {visiblePicks + 1} of {picks.length}
          </span>
          <div className="progress-bar">
            <div
              className="progress-fill"
              style={{ width: `${(visiblePicks / picks.length) * 100}%` }}
            />
          </div>
        </div>
        <button
          className={`sim-btn ${isLive ? 'active' : ''}`}
          onClick={() => setIsLive(!isLive)}
        >
          {isLive ? 'Pause Sim' : 'Simulate Draft'}
        </button>
      </div>

      <div className="draft-layout">
        {/* Left: Team Rosters */}
        <div className="draft-sidebar">
          <h3 className="sidebar-title">Draft Board</h3>
          {members.map((m) => {
            const memberPicks = picks
              .slice(0, visiblePicks)
              .filter((p) => p.memberId === m.id);
            const isCurrent = currentPick?.memberId === m.id;
            return (
              <div key={m.id} className={`draft-team-card ${isCurrent ? 'on-clock' : ''}`}>
                <div className="draft-team-header">
                  <span className="draft-team-name">{m.teamName}</span>
                  <span className="draft-team-count">{memberPicks.length}</span>
                </div>
                <div className="draft-team-picks">
                  {memberPicks.map((p) => (
                    <span key={p.overallPick} className={`mini-pick pos-${p.player.position.toLowerCase()}`}>
                      {p.player.webName}
                    </span>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        {/* Center: Clock + Player Board */}
        <div className="draft-center">
          {/* Timer */}
          <div className={`timer-container ${urgency}`}>
            {visiblePicks < picks.length ? (
              <>
                <div className="timer-display">
                  {minutes}:{seconds.toString().padStart(2, '0')}
                </div>
                <div className="timer-label">
                  {isMyTurn ? 'Your Pick!' : `${currentPick?.teamName ?? 'Waiting...'} is on the clock`}
                </div>
              </>
            ) : (
              <div className="timer-label" style={{ fontSize: '1.25rem' }}>Draft Complete</div>
            )}
          </div>

          {/* Player Board */}
          <div className="player-board">
            <div className="board-controls">
              <input
                type="text"
                placeholder="Search players..."
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
                    <th>Price</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredAvailable.slice(0, 50).map((player) => (
                    <tr key={player.id} className={`position-${player.position.toLowerCase()}`}>
                      <td className="player-name">
                        {player.webName}
                        {player.news && <span className="injury-flag" title={player.news}>!</span>}
                      </td>
                      <td className="player-pos">{player.position}</td>
                      <td className="player-club">{player.clubCode}</td>
                      <td className="player-pts">{player.totalPoints}</td>
                      <td className="player-ppg">{player.pointsPerGame.toFixed(1)}</td>
                      <td className="player-cost">{(player.nowCost / 10).toFixed(1)}</td>
                      <td>
                        <button className="pick-btn" disabled={!isMyTurn || visiblePicks >= picks.length}>
                          Draft
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Right: Pick History */}
        <div className="draft-history">
          <h3 className="sidebar-title">Pick History</h3>
          <div className="pick-list">
            {picks.slice(0, visiblePicks).reverse().map((pick) => (
              <div key={pick.overallPick} className={`pick-item ${pick.memberId === currentMemberId ? 'my-pick' : ''}`}>
                <div className="pick-item-top">
                  <span className="pick-number">#{pick.overallPick}</span>
                  <span className="pick-round">R{pick.round}</span>
                  {pick.autoPick && <span className="auto-badge">AUTO</span>}
                </div>
                <div className="pick-item-player">
                  <span className={`pos-badge pos-${pick.player.position.toLowerCase()}`}>
                    {pick.player.position}
                  </span>
                  <span className="pick-player-name">{pick.player.webName}</span>
                </div>
                <div className="pick-item-team">{pick.teamName}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

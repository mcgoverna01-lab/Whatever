import { useState } from 'react';
import type { MockMember, MockGameweekScore, MockH2HFixture } from '../mock/league.js';

interface Props {
  allGameweeks: MockGameweekScore[][];
  members: MockMember[];
  h2hFixtures: MockH2HFixture[];
}

export function StandingsView({ allGameweeks, members, h2hFixtures }: Props) {
  const [mode, setMode] = useState<'total' | 'h2h'>('total');
  const latestGW = allGameweeks[allGameweeks.length - 1];

  return (
    <div className="standings-page">
      <div className="standings-header">
        <h2>League Standings</h2>
        <div className="standings-toggle">
          <button
            className={`toggle-btn ${mode === 'total' ? 'active' : ''}`}
            onClick={() => setMode('total')}
          >
            Total Points
          </button>
          <button
            className={`toggle-btn ${mode === 'h2h' ? 'active' : ''}`}
            onClick={() => setMode('h2h')}
          >
            Head-to-Head
          </button>
        </div>
      </div>

      {mode === 'total' ? (
        <div className="standings-table-wrapper">
          <table className="standings-table">
            <thead>
              <tr>
                <th className="rank-th">#</th>
                <th>Team</th>
                <th>GW Pts</th>
                <th>Total</th>
                <th className="trend-th">Form</th>
              </tr>
            </thead>
            <tbody>
              {latestGW.map((s, i) => {
                // Last 5 GW points for form
                const recentGWs = allGameweeks.slice(-5).map(
                  (gw) => gw.find((g) => g.memberId === s.memberId)?.points ?? 0,
                );
                const avgRecent = Math.round(recentGWs.reduce((a, b) => a + b, 0) / recentGWs.length);

                return (
                  <tr key={s.memberId} className={i < 1 ? 'top-row' : i >= latestGW.length - 1 ? 'bottom-row' : ''}>
                    <td className="rank-col">
                      <span className={`rank-badge rank-${Math.min(s.rank, 4)}`}>{s.rank}</span>
                    </td>
                    <td className="team-col">
                      <div className="team-cell">
                        <span className="team-name-main">{s.teamName}</span>
                        <span className="team-manager">@{members.find((m) => m.id === s.memberId)?.username}</span>
                      </div>
                    </td>
                    <td className="pts-col">{s.points}</td>
                    <td className="total-col"><strong>{s.totalPoints}</strong></td>
                    <td className="trend-col">
                      <div className="form-bar">
                        {recentGWs.map((pts, j) => (
                          <div
                            key={j}
                            className={`form-dot ${pts > avgRecent + 5 ? 'good' : pts < avgRecent - 5 ? 'bad' : 'avg'}`}
                            title={`GW${allGameweeks.length - 4 + j}: ${pts}pts`}
                          />
                        ))}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="h2h-view">
          <h3 className="section-label">GW24 Matchups</h3>
          <div className="h2h-grid">
            {h2hFixtures.map((f, i) => (
              <div key={i} className="h2h-card">
                <div className={`h2h-side ${f.winner === 'home' ? 'winner' : ''}`}>
                  <span className="h2h-team">{f.homeTeam}</span>
                  <span className="h2h-score">{f.homePoints}</span>
                </div>
                <div className="h2h-vs">vs</div>
                <div className={`h2h-side away ${f.winner === 'away' ? 'winner' : ''}`}>
                  <span className="h2h-score">{f.awayPoints}</span>
                  <span className="h2h-team">{f.awayTeam}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

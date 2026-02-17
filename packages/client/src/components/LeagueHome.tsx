import type { MockMember, MockGameweekScore, MockH2HFixture } from '../mock/league.js';

interface Props {
  members: MockMember[];
  standings: MockGameweekScore[];
  h2hFixtures: MockH2HFixture[];
  currentGameweek: number;
}

export function LeagueHome({ members, standings, h2hFixtures, currentGameweek }: Props) {
  return (
    <div className="home-grid">
      {/* League Overview Card */}
      <section className="card overview-card">
        <h2 className="card-title">League Overview</h2>
        <div className="overview-stats">
          <div className="stat-block">
            <span className="stat-value">{currentGameweek}</span>
            <span className="stat-label">Gameweek</span>
          </div>
          <div className="stat-block">
            <span className="stat-value">{members.length}</span>
            <span className="stat-label">Teams</span>
          </div>
          <div className="stat-block">
            <span className="stat-value">Snake</span>
            <span className="stat-label">Draft Type</span>
          </div>
          <div className="stat-block">
            <span className="stat-value">H2H</span>
            <span className="stat-label">Scoring</span>
          </div>
        </div>
      </section>

      {/* Mini Standings */}
      <section className="card">
        <h2 className="card-title">Standings</h2>
        <table className="mini-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Team</th>
              <th>GW{currentGameweek}</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {standings.map((s, i) => (
              <tr key={s.memberId} className={i === 0 ? 'highlight-row' : ''}>
                <td className="rank-col">{s.rank}</td>
                <td className="team-col">{s.teamName}</td>
                <td className="pts-col">{s.points}</td>
                <td className="total-col">{s.totalPoints}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* H2H Fixtures */}
      <section className="card">
        <h2 className="card-title">GW{currentGameweek} Matchups</h2>
        <div className="h2h-fixtures">
          {h2hFixtures.map((f, i) => (
            <div key={i} className="fixture-row">
              <div className={`fixture-team ${f.winner === 'home' ? 'winner' : ''}`}>
                {f.homeTeam}
              </div>
              <div className="fixture-score">
                <span className="fixture-pts">{f.homePoints}</span>
                <span className="fixture-dash">-</span>
                <span className="fixture-pts">{f.awayPoints}</span>
              </div>
              <div className={`fixture-team away ${f.winner === 'away' ? 'winner' : ''}`}>
                {f.awayTeam}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Recent Activity */}
      <section className="card">
        <h2 className="card-title">Recent Activity</h2>
        <div className="activity-feed">
          <div className="activity-item">
            <span className="activity-badge waiver">WAI</span>
            <span><strong>Gegenpressing XI</strong> claimed <strong>Mbeumo</strong>, dropped Bowen</span>
            <span className="activity-time">2h ago</span>
          </div>
          <div className="activity-item">
            <span className="activity-badge trade">TRD</span>
            <span><strong>VAR Victims</strong> traded Son for Palmer with <strong>xG Believers</strong></span>
            <span className="activity-time">6h ago</span>
          </div>
          <div className="activity-item">
            <span className="activity-badge faab">FAB</span>
            <span><strong>Park the Bus FC</strong> won Cunha for 18 FAAB</span>
            <span className="activity-time">1d ago</span>
          </div>
          <div className="activity-item">
            <span className="activity-badge waiver">WAI</span>
            <span><strong>Counter Attack Utd</strong> claimed Rogers, dropped Mount</span>
            <span className="activity-time">1d ago</span>
          </div>
        </div>
      </section>
    </div>
  );
}

import { useState, useMemo } from 'react';
import { DraftRoomDemo } from './components/DraftRoomDemo.js';
import { RosterView } from './components/RosterView.js';
import { StandingsView } from './components/StandingsView.js';
import { WaiverView } from './components/WaiverView.js';
import { TradeView } from './components/TradeView.js';
import { LeagueHome } from './components/LeagueHome.js';
import {
  MOCK_MEMBERS,
  generateMockDraft,
  generateMockStandings,
  generateMockH2HFixtures,
} from './mock/league.js';

type Tab = 'home' | 'draft' | 'roster' | 'standings' | 'waivers' | 'trades';

export function App() {
  const [activeTab, setActiveTab] = useState<Tab>('home');
  const [selectedMember] = useState(MOCK_MEMBERS[0]);

  const draftData = useMemo(() => generateMockDraft(), []);
  const standingsData = useMemo(() => generateMockStandings(MOCK_MEMBERS), []);
  const h2hFixtures = useMemo(() => generateMockH2HFixtures(MOCK_MEMBERS), []);

  const myRoster = draftData.rosters.get(selectedMember.id) ?? [];

  return (
    <div className="app">
      {/* Top Bar */}
      <header className="top-bar">
        <div className="top-bar-brand">
          <div className="logo">PD</div>
          <div>
            <h1 className="top-bar-title">Pitch Draft</h1>
            <span className="top-bar-subtitle">2025-26 Season</span>
          </div>
        </div>
        <div className="top-bar-league">
          <span className="league-name">Premier Draft League</span>
          <span className="league-meta">8 teams &middot; Snake &middot; GW24</span>
        </div>
        <div className="top-bar-user">
          <div className="user-avatar">{selectedMember.username[0].toUpperCase()}</div>
          <div>
            <div className="user-team">{selectedMember.teamName}</div>
            <div className="user-name">@{selectedMember.username}</div>
          </div>
        </div>
      </header>

      {/* Navigation */}
      <nav className="tab-nav">
        {([
          ['home', 'Home'],
          ['draft', 'Draft Room'],
          ['roster', 'My Roster'],
          ['standings', 'Standings'],
          ['waivers', 'Waivers'],
          ['trades', 'Trades'],
        ] as [Tab, string][]).map(([key, label]) => (
          <button
            key={key}
            className={`tab-btn ${activeTab === key ? 'active' : ''}`}
            onClick={() => setActiveTab(key)}
          >
            {label}
          </button>
        ))}
      </nav>

      {/* Content */}
      <main className="content">
        {activeTab === 'home' && (
          <LeagueHome
            members={MOCK_MEMBERS}
            standings={standingsData[standingsData.length - 1]}
            h2hFixtures={h2hFixtures}
            currentGameweek={24}
          />
        )}
        {activeTab === 'draft' && (
          <DraftRoomDemo
            picks={draftData.picks}
            availablePlayers={draftData.availablePlayers}
            members={MOCK_MEMBERS}
            currentMemberId={selectedMember.id}
          />
        )}
        {activeTab === 'roster' && (
          <RosterView
            roster={myRoster}
            teamName={selectedMember.teamName}
            faabRemaining={selectedMember.faabRemaining}
          />
        )}
        {activeTab === 'standings' && (
          <StandingsView
            allGameweeks={standingsData}
            members={MOCK_MEMBERS}
            h2hFixtures={h2hFixtures}
          />
        )}
        {activeTab === 'waivers' && (
          <WaiverView
            availablePlayers={draftData.availablePlayers}
            roster={myRoster}
            faabRemaining={selectedMember.faabRemaining}
          />
        )}
        {activeTab === 'trades' && (
          <TradeView
            members={MOCK_MEMBERS}
            currentMemberId={selectedMember.id}
            rosters={draftData.rosters}
          />
        )}
      </main>
    </div>
  );
}

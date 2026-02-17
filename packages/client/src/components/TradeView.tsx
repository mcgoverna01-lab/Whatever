import { useState } from 'react';
import type { MockPlayer } from '../mock/players.js';
import type { MockMember } from '../mock/league.js';

interface Props {
  members: MockMember[];
  currentMemberId: string;
  rosters: Map<string, MockPlayer[]>;
}

export function TradeView({ members, currentMemberId, rosters }: Props) {
  const [selectedPartner, setSelectedPartner] = useState<string | null>(null);
  const [myOffers, setMyOffers] = useState<Set<number>>(new Set());
  const [theirOffers, setTheirOffers] = useState<Set<number>>(new Set());

  const otherMembers = members.filter((m) => m.id !== currentMemberId);
  const myRoster = rosters.get(currentMemberId) ?? [];
  const theirRoster = selectedPartner ? (rosters.get(selectedPartner) ?? []) : [];
  const partner = members.find((m) => m.id === selectedPartner);

  const toggleMy = (id: number) => {
    setMyOffers((s) => {
      const next = new Set(s);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleTheir = (id: number) => {
    setTheirOffers((s) => {
      const next = new Set(s);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  // Mock pending trades
  const mockTrades = [
    {
      id: '1',
      status: 'proposed' as const,
      proposer: 'Gegenpressing XI',
      recipient: members.find((m) => m.id === currentMemberId)!.teamName,
      giving: ['Foden', 'Estupinan'],
      receiving: ['Saka'],
      vetoDeadline: '18h remaining',
    },
    {
      id: '2',
      status: 'accepted' as const,
      proposer: 'VAR Victims',
      recipient: 'xG Believers',
      giving: ['Son'],
      receiving: ['Palmer'],
      vetoDeadline: '6h remaining',
    },
  ];

  return (
    <div className="trade-page">
      <h2>Trade Center</h2>

      {/* Pending Trades */}
      <section className="trade-section">
        <h3 className="section-label">Pending Trades</h3>
        <div className="trade-list">
          {mockTrades.map((t) => (
            <div key={t.id} className="trade-card">
              <div className="trade-card-header">
                <span className={`trade-status-badge ${t.status}`}>{t.status}</span>
                <span className="trade-deadline">{t.vetoDeadline}</span>
              </div>
              <div className="trade-card-body">
                <div className="trade-side">
                  <span className="trade-side-team">{t.proposer}</span>
                  <span className="trade-side-label">sends</span>
                  <div className="trade-players">
                    {t.giving.map((p) => (
                      <span key={p} className="trade-player-chip">{p}</span>
                    ))}
                  </div>
                </div>
                <div className="trade-arrow-block">for</div>
                <div className="trade-side">
                  <span className="trade-side-team">{t.recipient}</span>
                  <span className="trade-side-label">sends</span>
                  <div className="trade-players">
                    {t.receiving.map((p) => (
                      <span key={p} className="trade-player-chip">{p}</span>
                    ))}
                  </div>
                </div>
              </div>
              {t.recipient === members.find((m) => m.id === currentMemberId)!.teamName && t.status === 'proposed' && (
                <div className="trade-card-actions">
                  <button className="confirm-btn">Accept</button>
                  <button className="cancel-btn">Reject</button>
                </div>
              )}
              {t.status === 'accepted' && (
                <div className="trade-card-actions">
                  <button className="cancel-btn">Vote to Veto</button>
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* Propose Trade */}
      <section className="trade-section">
        <h3 className="section-label">Propose Trade</h3>

        {/* Partner selection */}
        <div className="partner-select">
          <label>Trade with:</label>
          <div className="partner-chips">
            {otherMembers.map((m) => (
              <button
                key={m.id}
                className={`partner-chip ${selectedPartner === m.id ? 'active' : ''}`}
                onClick={() => {
                  setSelectedPartner(selectedPartner === m.id ? null : m.id);
                  setMyOffers(new Set());
                  setTheirOffers(new Set());
                }}
              >
                {m.teamName}
              </button>
            ))}
          </div>
        </div>

        {selectedPartner && (
          <div className="trade-builder">
            {/* My players */}
            <div className="trade-builder-side">
              <h4>Your Players</h4>
              <div className="trade-roster">
                {myRoster.map((p) => (
                  <div
                    key={p.id}
                    className={`trade-roster-item ${myOffers.has(p.id) ? 'selected' : ''}`}
                    onClick={() => toggleMy(p.id)}
                  >
                    <span className={`pos-badge pos-${p.position.toLowerCase()}`}>{p.position}</span>
                    <span className="trade-roster-name">{p.webName}</span>
                    <span className="trade-roster-club">{p.clubCode}</span>
                    <span className="trade-roster-pts">{p.totalPoints}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Summary */}
            <div className="trade-summary">
              <div className="trade-summary-arrows">
                {myOffers.size > 0 && (
                  <div className="summary-block sending">
                    <span className="summary-label">You send</span>
                    {[...myOffers].map((id) => {
                      const p = myRoster.find((r) => r.id === id)!;
                      return <span key={id} className="trade-player-chip">{p.webName}</span>;
                    })}
                  </div>
                )}
                {theirOffers.size > 0 && (
                  <div className="summary-block receiving">
                    <span className="summary-label">You receive</span>
                    {[...theirOffers].map((id) => {
                      const p = theirRoster.find((r) => r.id === id)!;
                      return <span key={id} className="trade-player-chip">{p.webName}</span>;
                    })}
                  </div>
                )}
              </div>
              <button
                className="submit-trade-btn"
                disabled={myOffers.size === 0 || theirOffers.size === 0}
              >
                Propose Trade
              </button>
            </div>

            {/* Their players */}
            <div className="trade-builder-side">
              <h4>{partner?.teamName}'s Players</h4>
              <div className="trade-roster">
                {theirRoster.map((p) => (
                  <div
                    key={p.id}
                    className={`trade-roster-item ${theirOffers.has(p.id) ? 'selected' : ''}`}
                    onClick={() => toggleTheir(p.id)}
                  >
                    <span className={`pos-badge pos-${p.position.toLowerCase()}`}>{p.position}</span>
                    <span className="trade-roster-name">{p.webName}</span>
                    <span className="trade-roster-club">{p.clubCode}</span>
                    <span className="trade-roster-pts">{p.totalPoints}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

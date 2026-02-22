import { useState } from 'react';
import type { MockPlayer } from '../mock/players.js';
import type { MockMember } from '../mock/league.js';

interface Props {
  members: MockMember[];
  currentMemberId: string;
  rosters: Map<string, MockPlayer[]>;
}

interface BrainTradeResult {
  valid: boolean;
  violations: Array<{ type: string; message: string; side: string }>;
  verdict: string;
  fairnessScore: number;
  summary: string;
  sideA: {
    teamName: string;
    totalRaw: number;
    totalAdjusted: number;
    rosterImpact: string;
    players: Array<{
      name: string;
      position: string;
      clubCode: string;
      projectedROS: number;
      scarcityAdjusted: number;
      fixtureRun: number;
    }>;
  };
  sideB: {
    teamName: string;
    totalRaw: number;
    totalAdjusted: number;
    rosterImpact: string;
    players: Array<{
      name: string;
      position: string;
      clubCode: string;
      projectedROS: number;
      scarcityAdjusted: number;
      fixtureRun: number;
    }>;
  };
  engine: string;
}

export function TradeView({ members, currentMemberId, rosters }: Props) {
  const [selectedPartner, setSelectedPartner] = useState<string | null>(null);
  const [myOffers, setMyOffers] = useState<Set<number>>(new Set());
  const [theirOffers, setTheirOffers] = useState<Set<number>>(new Set());
  const [brainResult, setBrainResult] = useState<BrainTradeResult | null>(null);
  const [brainLoading, setBrainLoading] = useState(false);
  const [brainError, setBrainError] = useState<string | null>(null);

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
    setBrainResult(null);
  };

  const toggleTheir = (id: number) => {
    setTheirOffers((s) => {
      const next = new Set(s);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
    setBrainResult(null);
  };

  const analyzeTrade = async () => {
    if (myOffers.size === 0 || theirOffers.size === 0 || !selectedPartner) return;

    setBrainLoading(true);
    setBrainError(null);
    setBrainResult(null);

    try {
      const res = await fetch('/api/brain/trade/evaluate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          leagueId: '00000000-0000-0000-0000-000000000000', // demo
          memberIdA: currentMemberId,
          memberIdB: selectedPartner,
          sendPlayerIds: [...myOffers],
          receivePlayerIds: [...theirOffers],
        }),
      });

      if (!res.ok) throw new Error(`Brain API error: ${res.status}`);
      const data = await res.json();
      setBrainResult(data);
    } catch (err: any) {
      setBrainError(err.message ?? 'Failed to analyze trade');
    } finally {
      setBrainLoading(false);
    }
  };

  const verdictColor = (verdict: string): string => {
    if (verdict === 'fair') return 'var(--green)';
    if (verdict.includes('slightly')) return 'var(--yellow)';
    return 'var(--red)';
  };

  const verdictLabel = (verdict: string): string => {
    return verdict.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
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
                  setBrainResult(null);
                  setBrainError(null);
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

            {/* Summary + Brain Analysis */}
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

              <div className="trade-actions-row">
                <button
                  className="submit-trade-btn"
                  disabled={myOffers.size === 0 || theirOffers.size === 0}
                >
                  Propose Trade
                </button>
                <button
                  className="analyze-trade-btn"
                  disabled={myOffers.size === 0 || theirOffers.size === 0 || brainLoading}
                  onClick={analyzeTrade}
                >
                  {brainLoading ? 'Analyzing...' : 'Brain Analysis'}
                </button>
              </div>

              {/* Brain Analysis Result */}
              {brainError && (
                <div className="brain-error">
                  Brain unavailable: {brainError}
                </div>
              )}

              {brainResult && (
                <div className="brain-analysis">
                  <div className="brain-header">
                    <span className="brain-label">Brain Analysis</span>
                    <span className="brain-engine">Engine: {brainResult.engine}</span>
                  </div>

                  {!brainResult.valid && (
                    <div className="brain-violations">
                      {brainResult.violations.map((v, i) => (
                        <div key={i} className="brain-violation">{v.message}</div>
                      ))}
                    </div>
                  )}

                  <div
                    className="brain-verdict"
                    style={{ borderLeftColor: verdictColor(brainResult.verdict) }}
                  >
                    <div className="verdict-title">{verdictLabel(brainResult.verdict)}</div>
                    <div className="verdict-score">
                      Fairness: {(brainResult.fairnessScore * 100).toFixed(0)}%
                    </div>
                    <div className="verdict-summary">{brainResult.summary}</div>
                  </div>

                  <div className="brain-sides">
                    {[brainResult.sideA, brainResult.sideB].map((side, i) => (
                      <div key={i} className="brain-side">
                        <div className="brain-side-team">{side.teamName}</div>
                        <div className="brain-side-total">
                          ROS: {side.totalAdjusted.toFixed(1)} pts (adj)
                        </div>
                        {side.players.map((p, j) => (
                          <div key={j} className="brain-player-row">
                            <span className={`pos-badge pos-${p.position.toLowerCase()}`}>{p.position}</span>
                            <span>{p.name}</span>
                            <span className="brain-player-stat">{p.projectedROS.toFixed(1)} ROS</span>
                            <span className="brain-player-stat">FDR {p.fixtureRun.toFixed(1)}</span>
                          </div>
                        ))}
                        <div className="brain-side-impact">{side.rosterImpact}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
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

import { useState, useEffect, useCallback } from 'react';
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

interface BrainRecommendation {
  player: {
    playerId: number;
    name: string;
    position: string;
    clubCode: string;
    form: number;
    fixtureRun: number;
  };
  projectedROS: number;
  netGain: number;
  reason: string;
  suggestedDrop: {
    playerId: number;
    name: string;
    position: string;
    clubCode: string;
  } | null;
  improvementOver: {
    playerId: number;
    name: string;
    position: string;
    projectedROS: number;
  } | null;
}

interface BrainWaiverResult {
  rosterNeeds: Array<{
    position: string;
    severity: 'low' | 'medium' | 'high';
    reason: string;
  }>;
  recommendations: BrainRecommendation[];
  engine: string;
}

interface FaabBidSuggestion {
  player: {
    playerId: number;
    name: string;
    position: string;
    clubCode: string;
    form: number;
  };
  suggestedBid: { min: number; max: number; recommended: number };
  confidence: number;
  reason: string;
  priority: 'must_bid' | 'strong_add' | 'depth_add' | 'speculative';
  estimatedCompetition: number;
}

interface BrainFaabResult {
  budget: {
    total: number;
    spent: number;
    remaining: number;
    gameweeksPassed: number;
    gameweeksRemaining: number;
  };
  pacing: {
    weeklyBudget: number;
    status: 'under_spending' | 'on_track' | 'over_spending';
    recommendation: string;
  };
  bids: FaabBidSuggestion[];
  engine: string;
}

export function WaiverView({ availablePlayers, roster, faabRemaining }: Props) {
  const [mode, setMode] = useState<'waiver' | 'faab'>('waiver');
  const [viewTab, setViewTab] = useState<'manual' | 'brain'>('manual');
  const [claims, setClaims] = useState<WaiverClaim[]>([]);
  const [selectedIn, setSelectedIn] = useState<MockPlayer | null>(null);
  const [selectedOut, setSelectedOut] = useState<MockPlayer | null>(null);
  const [bidAmount, setBidAmount] = useState(0);
  const [search, setSearch] = useState('');
  const [posFilter, setPosFilter] = useState<string>('ALL');

  // Brain state
  const [brainResult, setBrainResult] = useState<BrainWaiverResult | null>(null);
  const [brainLoading, setBrainLoading] = useState(false);
  const [brainError, setBrainError] = useState<string | null>(null);

  // FAAB brain state
  const [faabResult, setFaabResult] = useState<BrainFaabResult | null>(null);
  const [faabLoading, setFaabLoading] = useState(false);
  const [faabError, setFaabError] = useState<string | null>(null);

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

  const fetchBrainRecommendations = useCallback(async () => {
    setBrainLoading(true);
    setBrainError(null);

    try {
      const leagueId = '00000000-0000-0000-0000-000000000000'; // demo
      const memberId = '00000000-0000-0000-0000-000000000001'; // demo
      const res = await fetch(`/api/brain/waiver/${leagueId}/${memberId}?limit=10`);

      if (!res.ok) throw new Error(`Brain API error: ${res.status}`);
      const data = await res.json();
      setBrainResult(data);
    } catch (err: any) {
      setBrainError(err.message ?? 'Failed to fetch recommendations');
    } finally {
      setBrainLoading(false);
    }
  }, []);

  const fetchFaabRecommendations = useCallback(async () => {
    setFaabLoading(true);
    setFaabError(null);

    try {
      const leagueId = '00000000-0000-0000-0000-000000000000';
      const memberId = '00000000-0000-0000-0000-000000000001';
      const res = await fetch(`/api/brain/faab/${leagueId}/${memberId}?limit=5`);

      if (!res.ok) throw new Error(`Brain API error: ${res.status}`);
      const data = await res.json();
      setFaabResult(data);
    } catch (err: any) {
      setFaabError(err.message ?? 'Failed to fetch FAAB advice');
    } finally {
      setFaabLoading(false);
    }
  }, []);

  useEffect(() => {
    if (viewTab === 'brain' && mode === 'waiver' && !brainResult && !brainLoading) {
      fetchBrainRecommendations();
    }
    if (viewTab === 'brain' && mode === 'faab' && !faabResult && !faabLoading) {
      fetchFaabRecommendations();
    }
  }, [viewTab, mode, brainResult, brainLoading, faabResult, faabLoading, fetchBrainRecommendations, fetchFaabRecommendations]);

  const severityBadge = (severity: string) => {
    const colors: Record<string, string> = { high: 'var(--red)', medium: 'var(--yellow)', low: 'var(--green)' };
    return (
      <span className="severity-badge" style={{ background: colors[severity] ?? 'var(--surface-2)' }}>
        {severity}
      </span>
    );
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

      {/* Manual vs Brain toggle */}
      <div className="view-toggle">
        <button
          className={`toggle-btn ${viewTab === 'manual' ? 'active' : ''}`}
          onClick={() => setViewTab('manual')}
        >
          Manual
        </button>
        <button
          className={`toggle-btn ${viewTab === 'brain' ? 'active' : ''}`}
          onClick={() => setViewTab('brain')}
        >
          Brain Recommendations
        </button>
      </div>

      {/* Brain Recommendations Tab — Priority Waiver mode */}
      {viewTab === 'brain' && mode === 'waiver' && (
        <div className="brain-waiver-section">
          {brainLoading && <div className="brain-loading">Loading brain recommendations...</div>}

          {brainError && (
            <div className="brain-error">
              Brain unavailable: {brainError}
              <button className="retry-btn" onClick={fetchBrainRecommendations}>Retry</button>
            </div>
          )}

          {brainResult && (
            <>
              <div className="brain-header">
                <span className="brain-label">Brain Analysis</span>
                <span className="brain-engine">Engine: {brainResult.engine}</span>
              </div>

              {brainResult.rosterNeeds.length > 0 && (
                <div className="brain-needs">
                  <h3 className="section-label">Roster Needs</h3>
                  <div className="needs-list">
                    {brainResult.rosterNeeds.map((need, i) => (
                      <div key={i} className="need-card">
                        <span className={`pos-badge pos-${need.position.toLowerCase()}`}>{need.position}</span>
                        {severityBadge(need.severity)}
                        <span className="need-reason">{need.reason}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="brain-recs">
                <h3 className="section-label">Recommended Pickups ({brainResult.recommendations.length})</h3>
                {brainResult.recommendations.length === 0 ? (
                  <p className="empty-text">No recommendations at this time.</p>
                ) : (
                  <div className="rec-list">
                    {brainResult.recommendations.map((rec, i) => (
                      <div key={i} className="rec-card">
                        <div className="rec-rank">#{i + 1}</div>
                        <div className="rec-main">
                          <div className="rec-player">
                            <span className={`pos-badge pos-${rec.player.position.toLowerCase()}`}>{rec.player.position}</span>
                            <span className="rec-player-name">{rec.player.name}</span>
                            <span className="rec-player-club">{rec.player.clubCode}</span>
                          </div>
                          <div className="rec-stats">
                            <span className="rec-stat">ROS: {rec.projectedROS.toFixed(1)}</span>
                            <span className="rec-stat">Form: {rec.player.form.toFixed(1)}</span>
                            <span className="rec-stat">FDR: {rec.player.fixtureRun.toFixed(1)}</span>
                            <span className={`rec-stat ${rec.netGain > 0 ? 'positive' : 'negative'}`}>
                              {rec.netGain > 0 ? '+' : ''}{rec.netGain.toFixed(1)} gain
                            </span>
                          </div>
                          <div className="rec-reason">{rec.reason}</div>
                        </div>
                        {rec.suggestedDrop && (
                          <div className="rec-drop">
                            <span className="rec-drop-label">Drop:</span>
                            <span className={`pos-badge pos-${rec.suggestedDrop.position.toLowerCase()}`}>
                              {rec.suggestedDrop.position}
                            </span>
                            <span>{rec.suggestedDrop.name}</span>
                            <span className="rec-drop-club">{rec.suggestedDrop.clubCode}</span>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* Brain FAAB Advice Tab */}
      {viewTab === 'brain' && mode === 'faab' && (
        <div className="brain-waiver-section">
          {faabLoading && <div className="brain-loading">Loading FAAB advice...</div>}

          {faabError && (
            <div className="brain-error">
              Brain unavailable: {faabError}
              <button className="retry-btn" onClick={fetchFaabRecommendations}>Retry</button>
            </div>
          )}

          {faabResult && (
            <>
              <div className="brain-header">
                <span className="brain-label">FAAB Budget Advisor</span>
                <span className="brain-engine">Engine: {faabResult.engine}</span>
              </div>

              {/* Budget Pacing */}
              <div className="brain-needs">
                <h3 className="section-label">Budget Pacing</h3>
                <div className="need-card">
                  <span className={`severity-badge ${
                    faabResult.pacing.status === 'on_track' ? 'low'
                    : faabResult.pacing.status === 'under_spending' ? 'medium'
                    : 'high'
                  }`} style={{ color: '#fff' }}>
                    {faabResult.pacing.status.replace('_', ' ')}
                  </span>
                  <span className="need-reason">
                    {faabResult.budget.remaining} / {faabResult.budget.total} FAAB remaining
                    ({faabResult.budget.gameweeksRemaining} GWs left, ~{faabResult.pacing.weeklyBudget.toFixed(0)}/week)
                  </span>
                </div>
                <p className="rec-reason" style={{ marginTop: '0.25rem' }}>{faabResult.pacing.recommendation}</p>
              </div>

              {/* Bid Suggestions */}
              <div className="brain-recs">
                <h3 className="section-label">Suggested Bids ({faabResult.bids.length})</h3>
                {faabResult.bids.length === 0 ? (
                  <p className="empty-text">No bid suggestions at this time.</p>
                ) : (
                  <div className="rec-list">
                    {faabResult.bids.map((bid, i) => (
                      <div key={i} className="rec-card">
                        <div className="rec-rank">#{i + 1}</div>
                        <div className="rec-main">
                          <div className="rec-player">
                            <span className={`pos-badge pos-${bid.player.position.toLowerCase()}`}>{bid.player.position}</span>
                            <span className="rec-player-name">{bid.player.name}</span>
                            <span className="rec-player-club">{bid.player.clubCode}</span>
                          </div>
                          <div className="rec-stats">
                            <span className="rec-stat">
                              Bid: {bid.suggestedBid.min}–{bid.suggestedBid.max} FAAB
                            </span>
                            <span className="rec-stat positive">
                              rec: {bid.suggestedBid.recommended}
                            </span>
                            <span className="rec-stat">
                              {bid.estimatedCompetition} rival{bid.estimatedCompetition !== 1 ? 's' : ''}
                            </span>
                          </div>
                          <div className="rec-stats">
                            <span className={`severity-badge ${
                              bid.priority === 'must_bid' ? 'high'
                              : bid.priority === 'strong_add' ? 'medium'
                              : 'low'
                            }`} style={{ color: '#fff', fontSize: '0.6rem' }}>
                              {bid.priority.replace('_', ' ')}
                            </span>
                            <span className="rec-stat">Form: {bid.player.form.toFixed(1)}</span>
                          </div>
                          <div className="rec-reason">{bid.reason}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* Manual Waiver Tab */}
      {viewTab === 'manual' && (
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
      )}
    </div>
  );
}

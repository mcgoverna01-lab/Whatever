import { useState } from 'react';
import { useDraftPlan } from '../hooks/useAnalysis.js';
import { SkeletonCard } from './LoadingState.jsx';

function PickInput({ picks, setPicks }) {
  const [raw, setRaw] = useState(picks.join(', '));

  const commit = () => {
    const arr = raw
      .split(/[,\s]+/)
      .map((x) => x.trim())
      .filter(Boolean);
    setPicks(arr);
  };

  return (
    <div>
      <label className="card-title block mb-2">Your Picks</label>
      <div className="flex gap-2">
        <input
          type="text"
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          placeholder="1.04, 1.07, 2.04, 3.10"
          className="input font-mono"
        />
        <button className="btn-primary whitespace-nowrap" onClick={commit}>
          Update
        </button>
      </div>
      <div className="text-xs text-ink-300 mt-2">
        Format: round.pick, comma separated. Example: <span className="font-mono">1.04, 2.07</span>.
      </div>
    </div>
  );
}

export default function DraftSimulator({ dossier, onClose }) {
  const [picks, setPicks] = useState(['1.04', '2.07', '3.04']);
  const { data, loading, error, run } = useDraftPlan();
  const { league, roster } = dossier;

  const handleRun = async () => {
    if (picks.length === 0) return;
    try {
      await run({ league, roster, picks });
    } catch {}
  };

  return (
    <div className="space-y-5 animate-fadeup">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="card-title">Draft Simulator</div>
          <h2 className="font-display text-3xl mt-1">2026 rookie plan</h2>
          <p className="text-ink-300 text-sm mt-1">
            Enter the picks you hold. We'll recommend optimal targets at each slot using your
            roster needs and this year's consensus board.
          </p>
        </div>
        <button className="btn-ghost" onClick={onClose}>
          Close
        </button>
      </div>

      <div className="card space-y-4">
        <PickInput picks={picks} setPicks={setPicks} />
        <div className="flex flex-wrap gap-2">
          {picks.map((p) => (
            <span key={p} className="pill border-pos-pick/40 text-pos-pick/90">
              {p}
            </span>
          ))}
        </div>
        <button className="btn-primary" onClick={handleRun} disabled={loading || picks.length === 0}>
          {loading ? 'Drafting plan…' : 'Generate draft plan'}
        </button>
      </div>

      {loading && (
        <div className="space-y-3">
          <SkeletonCard lines={2} />
          <SkeletonCard lines={3} />
          <SkeletonCard lines={3} />
        </div>
      )}
      {error && <div className="card border-red-500/30 text-red-200 text-sm">{error}</div>}

      {data && (
        <div className="space-y-4">
          <div className="card">
            <div className="card-title mb-2">Strategy</div>
            <p className="text-sm text-ink-100 leading-relaxed">{data.strategy}</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {(data.pick_plan || []).map((plan, i) => (
              <div key={i} className="card">
                <div className="flex items-center justify-between">
                  <div className="font-display text-2xl">{plan.pick}</div>
                  <span className="pill">{plan.position}</span>
                </div>
                <div className="mt-2 font-medium">{plan.target}</div>
                <div className="text-xs text-ink-300 mt-1">{plan.rationale}</div>
                {plan.fallbacks?.length > 0 && (
                  <div className="mt-3">
                    <div className="text-[10px] uppercase tracking-widest text-ink-300 mb-1">
                      Fallbacks
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {plan.fallbacks.map((f, j) => (
                        <span key={j} className="pill">
                          {f}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>

          {data.trade_back_candidates?.length > 0 && (
            <div className="card">
              <div className="card-title mb-2">Trade-back candidates</div>
              <div className="flex flex-wrap gap-2">
                {data.trade_back_candidates.map((p, i) => (
                  <span key={i} className="pill border-pos-pick/40 text-pos-pick/90">
                    {p}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

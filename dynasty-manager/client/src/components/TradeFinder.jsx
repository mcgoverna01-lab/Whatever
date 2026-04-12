import { useState } from 'react';
import PlayerCard from './PlayerCard.jsx';
import { useTradeFinder } from '../hooks/useAnalysis.js';
import { SkeletonCard } from './LoadingState.jsx';

const LIKELIHOOD_TONE = {
  High: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  Medium: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  Low: 'bg-red-500/15 text-red-300 border-red-500/30'
};

export default function TradeFinder({ dossier, onClose }) {
  const [selected, setSelected] = useState(null);
  const { data, loading, error, run } = useTradeFinder();

  const { league, roster } = dossier;
  const allPlayers = [...roster.starters, ...roster.bench];

  const handleRun = async () => {
    if (!selected) return;
    try {
      await run({ league, roster, playerToTrade: selected });
    } catch {}
  };

  return (
    <div className="space-y-5 animate-fadeup">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="card-title">Trade Finder</div>
          <h2 className="font-display text-3xl mt-1">Shop a player</h2>
          <p className="text-ink-300 text-sm mt-1">
            Pick a player you'd like to move. We'll draft 3-5 realistic packages other managers
            might actually accept.
          </p>
        </div>
        <button className="btn-ghost" onClick={onClose}>
          Close
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="card md:col-span-1">
          <div className="card-title mb-3">Your Roster</div>
          <div className="space-y-2 max-h-[520px] overflow-y-auto pr-1">
            {allPlayers.map((p) => (
              <PlayerCard
                key={p.id}
                player={p}
                onClick={() => setSelected(p)}
                selected={selected?.id === p.id}
                compact
              />
            ))}
          </div>
          <button
            className="btn-primary w-full mt-4"
            onClick={handleRun}
            disabled={!selected || loading}
          >
            {loading ? 'Finding trades…' : selected ? `Find trades for ${selected.name}` : 'Select a player'}
          </button>
        </div>

        <div className="md:col-span-2 space-y-3">
          {loading && (
            <>
              <SkeletonCard />
              <SkeletonCard />
              <SkeletonCard />
            </>
          )}
          {error && (
            <div className="card border-red-500/30 text-red-200 text-sm">{error}</div>
          )}
          {!loading && !data && (
            <div className="card text-sm text-ink-300">
              Pick a player on the left and click "Find trades" to see suggested packages.
            </div>
          )}
          {data?.packages?.map((pkg, i) => (
            <div key={i} className="card">
              <div className="flex items-center justify-between mb-3">
                <div className="card-title">Package {String(i + 1).padStart(2, '0')}</div>
                <span
                  className={`pill ${LIKELIHOOD_TONE[pkg.likelihood] || 'border-white/10 text-ink-300'}`}
                >
                  {pkg.likelihood} odds
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="rounded-md border border-red-500/20 bg-red-500/5 p-3">
                  <div className="text-[10px] uppercase tracking-widest text-red-300 mb-2">
                    You send
                  </div>
                  <ul className="text-sm space-y-1">
                    {pkg.send?.map((x, j) => (
                      <li key={j}>{x}</li>
                    ))}
                  </ul>
                </div>
                <div className="rounded-md border border-emerald-500/20 bg-emerald-500/5 p-3">
                  <div className="text-[10px] uppercase tracking-widest text-emerald-300 mb-2">
                    You get
                  </div>
                  <ul className="text-sm space-y-1">
                    {pkg.receive?.map((x, j) => (
                      <li key={j}>{x}</li>
                    ))}
                  </ul>
                </div>
              </div>
              <div className="mt-3 text-sm text-ink-300">{pkg.rationale}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

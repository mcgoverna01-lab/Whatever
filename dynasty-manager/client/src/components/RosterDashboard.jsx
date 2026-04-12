import { useMemo } from 'react';
import PlayerCard from './PlayerCard.jsx';
import GradeBadge from './GradeBadge.jsx';
import { gradeRoster } from '../utils/grading.js';
import { describeScoring } from '../utils/scoring.js';

function RosterGroup({ title, players, accent }) {
  if (!players || players.length === 0) return null;
  return (
    <div>
      <div className="flex items-baseline justify-between mb-2">
        <div className="card-title">{title}</div>
        <div className="text-xs text-ink-300 font-mono">{players.length}</div>
      </div>
      <div className={`space-y-2 border-l ${accent} pl-3`}>
        {players.map((p) => (
          <PlayerCard key={p.id} player={p} />
        ))}
      </div>
    </div>
  );
}

export default function RosterDashboard({ dossier, onAnalyze, onOpenTrade, onOpenDraft, analyzing }) {
  const { league, roster, owner } = dossier;
  const localGrades = useMemo(() => gradeRoster(roster), [roster]);

  return (
    <div className="space-y-6 animate-fadeup">
      {/* Header */}
      <div className="card grid-bg">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="card-title">{league.name}</div>
            <h1 className="font-display text-4xl md:text-5xl font-semibold mt-1">
              {owner?.display_name || 'Your Dynasty'}
            </h1>
            <div className="mt-2 text-sm text-ink-300">{describeScoring(league)}</div>
          </div>
          <div className="flex items-center gap-4">
            <GradeBadge grade={localGrades.overall.grade} size="lg" label="overall" />
          </div>
        </div>

        <div className="divider my-5" />

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {['QB', 'RB', 'WR', 'TE'].map((pos) => {
            const g = localGrades.positions[pos];
            const dot = {
              QB: 'bg-pos-qb',
              RB: 'bg-pos-rb',
              WR: 'bg-pos-wr',
              TE: 'bg-pos-te'
            }[pos];
            return (
              <div
                key={pos}
                className="card flex flex-col items-center text-center gap-2 py-5"
              >
                <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-ink-300">
                  <span className={`w-2 h-2 rounded-full ${dot}`} />
                  {pos}
                </div>
                <GradeBadge grade={g.grade} size="md" />
                <div className="text-[11px] text-ink-300 font-mono">
                  {g.count} players{g.avgAge ? ` · avg ${g.avgAge.toFixed(1)}y` : ''}
                </div>
              </div>
            );
          })}
        </div>

        <div className="divider my-5" />

        <div className="flex flex-wrap gap-2">
          <button className="btn-primary" onClick={onAnalyze} disabled={analyzing}>
            {analyzing ? 'Analyzing roster…' : 'Run AI Analysis'}
          </button>
          <button className="btn-ghost" onClick={onOpenTrade}>
            Trade Finder
          </button>
          <button className="btn-ghost" onClick={onOpenDraft}>
            Rookie Draft Plan
          </button>
        </div>
      </div>

      {/* Roster groups */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card">
          <RosterGroup title="Starters" players={roster.starters} accent="border-emerald-400/50" />
        </div>
        <div className="card">
          <RosterGroup title="Bench" players={roster.bench} accent="border-sky-400/40" />
        </div>
        {roster.taxi?.length > 0 && (
          <div className="card">
            <RosterGroup title="Taxi Squad" players={roster.taxi} accent="border-violet-400/40" />
          </div>
        )}
        {roster.ir?.length > 0 && (
          <div className="card">
            <RosterGroup title="Injured Reserve" players={roster.ir} accent="border-red-400/40" />
          </div>
        )}
      </div>
    </div>
  );
}

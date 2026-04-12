import GradeBadge from './GradeBadge.jsx';
import { SkeletonCard } from './LoadingState.jsx';

function WindowPill({ value }) {
  const tone = {
    'win-now': 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
    retool: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
    rebuild: 'bg-violet-500/15 text-violet-300 border-violet-500/30'
  }[value] || 'bg-white/5 text-ink-300 border-white/10';
  return (
    <span className={`pill ${tone}`}>{(value || 'unknown').toUpperCase()}</span>
  );
}

function BulletList({ items, tone = 'text-ink-100' }) {
  if (!items?.length) return <div className="text-sm text-ink-300">—</div>;
  return (
    <ul className="space-y-2">
      {items.map((item, i) => (
        <li key={i} className={`text-sm ${tone} flex gap-2`}>
          <span className="text-ink-300 font-mono shrink-0">{String(i + 1).padStart(2, '0')}</span>
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

export default function AnalysisPanel({ state }) {
  const { data, loading, error } = state;

  if (loading) {
    return (
      <div className="space-y-4 animate-fadeup">
        <SkeletonCard lines={4} />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <SkeletonCard />
          <SkeletonCard />
        </div>
        <SkeletonCard lines={5} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="card border-red-500/30">
        <div className="card-title text-red-300">Analysis failed</div>
        <div className="mt-2 text-sm text-red-200">{error}</div>
        <div className="mt-1 text-xs text-ink-300">
          Tip: make sure <code className="font-mono">ANTHROPIC_API_KEY</code> is set on the server.
        </div>
      </div>
    );
  }

  if (!data) return null;

  const pos = data.position_breakdown || {};

  return (
    <div className="space-y-6 animate-fadeup">
      {/* Verdict */}
      <div className="card">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="card-title">AI Verdict</div>
            <div className="mt-2 flex items-center gap-3">
              <WindowPill value={data.contention_window} />
              <span className="text-ink-300 text-sm">{data.window_summary}</span>
            </div>
          </div>
          <GradeBadge grade={data.overall_grade} size="md" label="AI grade" />
        </div>
      </div>

      {/* Strengths + Weaknesses */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="card">
          <div className="card-title mb-3">Strengths</div>
          <BulletList items={data.strengths} tone="text-emerald-200" />
        </div>
        <div className="card">
          <div className="card-title mb-3">Weaknesses</div>
          <BulletList items={data.weaknesses} tone="text-amber-200" />
        </div>
      </div>

      {/* Position breakdown */}
      <div className="card">
        <div className="card-title mb-4">Position-by-Position</div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {['QB', 'RB', 'WR', 'TE'].map((p) => {
            const entry = pos[p];
            if (!entry) return null;
            const dot = {
              QB: 'bg-pos-qb',
              RB: 'bg-pos-rb',
              WR: 'bg-pos-wr',
              TE: 'bg-pos-te'
            }[p];
            return (
              <div key={p} className="rounded-lg border border-white/5 bg-ink-900/50 p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2 text-sm font-display tracking-wide">
                    <span className={`w-2 h-2 rounded-full ${dot}`} />
                    {p}
                  </div>
                  <GradeBadge grade={entry.grade} size="sm" />
                </div>
                <div className="text-xs text-ink-300 space-y-1">
                  <div>
                    <span className="uppercase tracking-widest text-[10px] text-ink-300">
                      Starters
                    </span>
                    <div className="text-ink-100 text-sm">{entry.starters}</div>
                  </div>
                  <div>
                    <span className="uppercase tracking-widest text-[10px] text-ink-300">
                      Depth
                    </span>
                    <div className="text-ink-100 text-sm">{entry.depth}</div>
                  </div>
                  <div>
                    <span className="uppercase tracking-widest text-[10px] text-ink-300">
                      Aging
                    </span>
                    <div className="text-ink-100 text-sm">{entry.aging}</div>
                  </div>
                  <div>
                    <span className="uppercase tracking-widest text-[10px] text-ink-300">
                      Action
                    </span>
                    <div className="text-ink-100 text-sm font-medium">{entry.action}</div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Buy / Sell */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="card">
          <div className="card-title mb-3">Buy Targets</div>
          <ul className="space-y-3">
            {(data.buy_targets || []).map((t, i) => (
              <li key={i} className="rounded-md border border-emerald-500/20 bg-emerald-500/5 p-3">
                <div className="flex items-center justify-between">
                  <div className="font-medium">{t.player}</div>
                  <span className="pill">{t.position}</span>
                </div>
                <div className="text-xs text-ink-300 mt-1">{t.rationale}</div>
              </li>
            ))}
          </ul>
        </div>
        <div className="card">
          <div className="card-title mb-3">Sell Candidates</div>
          <ul className="space-y-3">
            {(data.sell_candidates || []).map((t, i) => (
              <li key={i} className="rounded-md border border-amber-500/20 bg-amber-500/5 p-3">
                <div className="flex items-center justify-between">
                  <div className="font-medium">{t.player}</div>
                  <span className="pill">{t.position}</span>
                </div>
                <div className="text-xs text-ink-300 mt-1">{t.rationale}</div>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Draft strategy */}
      {data.draft_strategy && (
        <div className="card">
          <div className="card-title mb-2">Rookie Draft Outline</div>
          <p className="text-sm text-ink-100 leading-relaxed">{data.draft_strategy}</p>
        </div>
      )}
    </div>
  );
}

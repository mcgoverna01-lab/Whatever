import { useState } from 'react';
import LeagueImport from './components/LeagueImport.jsx';
import RosterDashboard from './components/RosterDashboard.jsx';
import AnalysisPanel from './components/AnalysisPanel.jsx';
import TradeFinder from './components/TradeFinder.jsx';
import DraftSimulator from './components/DraftSimulator.jsx';
import { useSleeper } from './hooks/useSleeper.js';
import { useTeamAnalysis } from './hooks/useAnalysis.js';

function Header({ onReset, hasDossier }) {
  return (
    <header className="border-b border-white/5 bg-ink-900/80 backdrop-blur-md sticky top-0 z-30">
      <div className="max-w-6xl mx-auto px-5 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-md bg-gradient-to-br from-pos-wr to-pos-te flex items-center justify-center text-ink-900 font-display font-bold">
            D
          </div>
          <div>
            <div className="font-display font-semibold tracking-tight">Dynasty Portfolio Manager</div>
            <div className="text-[10px] uppercase tracking-[0.22em] text-ink-300">
              beta · powered by Claude
            </div>
          </div>
        </div>
        {hasDossier && (
          <button className="btn-ghost text-xs" onClick={onReset}>
            Switch league
          </button>
        )}
      </div>
    </header>
  );
}

export default function App() {
  const sleeper = useSleeper();
  const analysis = useTeamAnalysis();
  const [view, setView] = useState('dashboard'); // dashboard | trade | draft

  const dossier = sleeper.dossier;

  const runAnalysis = async () => {
    if (!dossier) return;
    try {
      await analysis.run({ league: dossier.league, roster: dossier.roster });
    } catch {}
  };

  const reset = () => {
    sleeper.reset();
    setView('dashboard');
  };

  return (
    <div className="min-h-full">
      <Header onReset={reset} hasDossier={!!dossier} />

      <main className="max-w-6xl mx-auto px-5 py-8 md:py-12 space-y-8">
        {!dossier && <LeagueImport sleeper={sleeper} />}

        {dossier && view === 'dashboard' && (
          <>
            <RosterDashboard
              dossier={dossier}
              analyzing={analysis.loading}
              onAnalyze={runAnalysis}
              onOpenTrade={() => setView('trade')}
              onOpenDraft={() => setView('draft')}
            />
            {(analysis.loading || analysis.data || analysis.error) && (
              <AnalysisPanel state={analysis} />
            )}
          </>
        )}

        {dossier && view === 'trade' && (
          <TradeFinder dossier={dossier} onClose={() => setView('dashboard')} />
        )}

        {dossier && view === 'draft' && (
          <DraftSimulator dossier={dossier} onClose={() => setView('dashboard')} />
        )}
      </main>

      <footer className="border-t border-white/5 mt-16">
        <div className="max-w-6xl mx-auto px-5 py-6 text-xs text-ink-300 flex flex-wrap justify-between gap-2">
          <span>Data via Sleeper · Analysis via Claude Sonnet 4</span>
          <span className="font-mono">prototype · not affiliated with Sleeper or the NFL</span>
        </div>
      </footer>
    </div>
  );
}

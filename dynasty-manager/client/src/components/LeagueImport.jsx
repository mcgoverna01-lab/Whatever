import { useState } from 'react';

export default function LeagueImport({ sleeper, onPick }) {
  const [username, setUsername] = useState('');
  const { user, leagues, loading, error, stage, lookupUser, selectLeague } = sleeper;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!username.trim()) return;
    try {
      await lookupUser(username);
    } catch {}
  };

  const pickLeague = async (leagueId) => {
    const dossier = await selectLeague(leagueId, user.user_id);
    onPick?.(dossier);
  };

  return (
    <div className="max-w-2xl mx-auto">
      <div className="card animate-fadeup">
        <div className="card-title mb-3">Step 01 — Import</div>
        <h2 className="font-display text-3xl mb-2">Pull your Sleeper league</h2>
        <p className="text-ink-300 text-sm mb-5">
          Enter your Sleeper username. We'll look up your dynasty leagues and pull in your roster.
          Nothing gets stored or shared.
        </p>

        <form onSubmit={handleSubmit} className="flex gap-2">
          <input
            type="text"
            className="input"
            placeholder="sleeper username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoFocus
          />
          <button type="submit" className="btn-primary whitespace-nowrap" disabled={loading}>
            {loading && stage === 'user' ? 'Fetching…' : 'Look up'}
          </button>
        </form>

        {error && (
          <div className="mt-4 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
            {error}
          </div>
        )}
      </div>

      {user && (
        <div className="card animate-fadeup mt-4">
          <div className="card-title mb-2">Step 02 — Select league</div>
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-full bg-ink-700 flex items-center justify-center font-display">
              {user.display_name?.[0]?.toUpperCase() || '?'}
            </div>
            <div>
              <div className="text-sm">{user.display_name}</div>
              <div className="text-xs text-ink-300 font-mono">id: {user.user_id}</div>
            </div>
          </div>

          {leagues.length === 0 ? (
            <div className="text-sm text-ink-300">
              No leagues found for 2025 under this username. Double-check spelling and that you're
              in at least one league this season.
            </div>
          ) : (
            <div className="space-y-2">
              {leagues.map((l) => (
                <button
                  key={l.league_id}
                  onClick={() => pickLeague(l.league_id)}
                  disabled={loading}
                  className="w-full text-left rounded-lg border border-white/10 bg-ink-800/60 hover:bg-ink-700/60 hover:border-white/20 transition px-4 py-3 flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <div className="font-medium truncate">{l.name}</div>
                    <div className="text-xs text-ink-300 font-mono">
                      {l.total_rosters}-team
                      {l.roster_positions?.includes('SUPER_FLEX') ? ' · SF' : ' · 1QB'}
                      {l.scoring_settings?.bonus_rec_te > 0 ? ' · TEP' : ''}
                      {l.is_dynasty ? ' · dynasty' : ''}
                    </div>
                  </div>
                  <div className="pill">{l.season}</div>
                </button>
              ))}
            </div>
          )}

          {loading && stage === 'dossier' && (
            <div className="mt-4 text-sm text-ink-300">Loading roster…</div>
          )}
        </div>
      )}
    </div>
  );
}

import { useCallback, useState } from 'react';

/**
 * Thin wrappers around our Express proxy. We don't use react-query here —
 * the state machine is small enough that a few useState hooks is clearer
 * than adding a dependency.
 */

async function jsonFetch(url, opts) {
  const res = await fetch(url, opts);
  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      if (body.error) msg = body.error;
    } catch {}
    throw new Error(msg);
  }
  return res.json();
}

export function useSleeper() {
  const [state, setState] = useState({
    user: null,
    leagues: [],
    selectedLeague: null,
    dossier: null,
    loading: false,
    error: null,
    stage: 'idle' // idle | user | leagues | dossier
  });

  const lookupUser = useCallback(async (username) => {
    setState((s) => ({ ...s, loading: true, error: null, stage: 'user' }));
    try {
      const user = await jsonFetch(`/api/sleeper/user/${encodeURIComponent(username.trim())}`);
      const leagues = await jsonFetch(`/api/sleeper/user/${user.user_id}/leagues`);
      setState((s) => ({
        ...s,
        user,
        leagues,
        loading: false,
        stage: 'leagues'
      }));
      return { user, leagues };
    } catch (err) {
      setState((s) => ({ ...s, loading: false, error: err.message, stage: 'idle' }));
      throw err;
    }
  }, []);

  const selectLeague = useCallback(async (leagueId, userId) => {
    setState((s) => ({ ...s, loading: true, error: null, stage: 'dossier' }));
    try {
      const dossier = await jsonFetch(
        `/api/sleeper/league/${leagueId}/dossier?user_id=${userId}`
      );
      setState((s) => ({
        ...s,
        selectedLeague: leagueId,
        dossier,
        loading: false
      }));
      return dossier;
    } catch (err) {
      setState((s) => ({ ...s, loading: false, error: err.message }));
      throw err;
    }
  }, []);

  const reset = useCallback(() => {
    setState({
      user: null,
      leagues: [],
      selectedLeague: null,
      dossier: null,
      loading: false,
      error: null,
      stage: 'idle'
    });
  }, []);

  return { ...state, lookupUser, selectLeague, reset };
}

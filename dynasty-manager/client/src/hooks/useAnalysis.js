import { useCallback, useState } from 'react';

export function useTeamAnalysis() {
  const [state, setState] = useState({ data: null, loading: false, error: null });

  const run = useCallback(async ({ league, roster }) => {
    setState({ data: null, loading: true, error: null });
    try {
      const res = await fetch('/api/analysis/team', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ league, roster })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(err.error || 'Analysis failed');
      }
      const data = await res.json();
      setState({ data, loading: false, error: null });
      return data;
    } catch (err) {
      setState({ data: null, loading: false, error: err.message });
      throw err;
    }
  }, []);

  return { ...state, run };
}

export function useTradeFinder() {
  const [state, setState] = useState({ data: null, loading: false, error: null });
  const run = useCallback(async ({ league, roster, playerToTrade }) => {
    setState({ data: null, loading: true, error: null });
    try {
      const res = await fetch('/api/analysis/trade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ league, roster, playerToTrade })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(err.error || 'Trade search failed');
      }
      const data = await res.json();
      setState({ data, loading: false, error: null });
      return data;
    } catch (err) {
      setState({ data: null, loading: false, error: err.message });
      throw err;
    }
  }, []);
  return { ...state, run, reset: () => setState({ data: null, loading: false, error: null }) };
}

export function useDraftPlan() {
  const [state, setState] = useState({ data: null, loading: false, error: null });
  const run = useCallback(async ({ league, roster, picks }) => {
    setState({ data: null, loading: true, error: null });
    try {
      const res = await fetch('/api/analysis/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ league, roster, picks })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(err.error || 'Draft plan failed');
      }
      const data = await res.json();
      setState({ data, loading: false, error: null });
      return data;
    } catch (err) {
      setState({ data: null, loading: false, error: err.message });
      throw err;
    }
  }, []);
  return { ...state, run };
}

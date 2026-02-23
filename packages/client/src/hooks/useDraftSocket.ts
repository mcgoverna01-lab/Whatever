import { useEffect, useRef, useCallback, useState } from 'react';
import type { ClientEvent, ServerEvent, DraftPick } from '@pitch-draft/shared';

interface DraftSocketState {
  connected: boolean;
  picks: DraftPick[];
  draftedPlayerIds: Set<number>;
  onTheClock: string | null;
  timeRemaining: number | null;
  draftCompleted: boolean;
  error: string | null;
}

interface UseDraftSocketReturn extends DraftSocketState {
  sendPick: (playerId: number) => void;
  setAutoPickRankings: (rankings: number[]) => void;
}

export function useDraftSocket(
  draftId: string,
  memberId: string,
): UseDraftSocketReturn {
  const wsRef = useRef<WebSocket | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [state, setState] = useState<DraftSocketState>({
    connected: false,
    picks: [],
    draftedPlayerIds: new Set(),
    onTheClock: null,
    timeRemaining: null,
    draftCompleted: false,
    error: null,
  });

  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(
      `${protocol}//${window.location.host}/ws/draft/${draftId}?memberId=${memberId}`,
    );
    wsRef.current = ws;

    ws.onopen = () => {
      setState((s) => ({ ...s, connected: true, error: null }));
    };

    ws.onclose = () => {
      setState((s) => ({ ...s, connected: false }));
      if (timerRef.current) clearInterval(timerRef.current);
    };

    ws.onerror = () => {
      setState((s) => ({ ...s, error: 'WebSocket connection error' }));
    };

    ws.onmessage = (event) => {
      const msg: ServerEvent = JSON.parse(event.data);
      handleServerEvent(msg);
    };

    return () => {
      ws.close();
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [draftId, memberId]);

  function handleServerEvent(event: ServerEvent): void {
    switch (event.type) {
      case 's:pick_made': {
        setState((s) => {
          const newPicks = [...s.picks, event.pick];
          const newDrafted = new Set(s.draftedPlayerIds);
          newDrafted.add(event.pick.playerId);

          return {
            ...s,
            picks: newPicks,
            draftedPlayerIds: newDrafted,
            onTheClock: event.nextOnClock?.memberId ?? null,
            error: null,
          };
        });
        break;
      }

      case 's:draft_started': {
        setState((s) => ({
          ...s,
          onTheClock: event.firstOnClock?.memberId ?? null,
        }));
        break;
      }

      case 's:draft_completed': {
        setState((s) => ({ ...s, draftCompleted: true, onTheClock: null }));
        if (timerRef.current) clearInterval(timerRef.current);
        break;
      }

      case 's:timer_update': {
        setState((s) => ({ ...s, timeRemaining: event.secondsRemaining }));
        break;
      }

      case 's:pick_error': {
        setState((s) => ({ ...s, error: event.message }));
        break;
      }
    }
  }

  const sendPick = useCallback((playerId: number) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

    const event: ClientEvent = {
      type: 'c:make_pick',
      draftId,
      playerId,
    };
    wsRef.current.send(JSON.stringify(event));
  }, [draftId]);

  const setAutoPickRankings = useCallback((rankings: number[]) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

    const event: ClientEvent = {
      type: 'c:set_auto_pick',
      draftId,
      rankings,
    };
    wsRef.current.send(JSON.stringify(event));
  }, [draftId]);

  return {
    ...state,
    sendPick,
    setAutoPickRankings,
  };
}

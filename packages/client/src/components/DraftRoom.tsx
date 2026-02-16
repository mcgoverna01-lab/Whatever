import { useState, useMemo } from 'react';
import { useDraftSocket } from '../hooks/useDraftSocket.js';
import type { Player, Position } from '@pitch-draft/shared';
import { PlayerBoard } from './PlayerBoard.js';
import { PickHistory } from './PickHistory.js';
import { DraftTimer } from './DraftTimer.js';

interface DraftRoomProps {
  draftId: string;
  memberId: string;
}

export function DraftRoom({ draftId, memberId }: DraftRoomProps) {
  const {
    connected,
    picks,
    draftedPlayerIds,
    onTheClock,
    timeRemaining,
    draftCompleted,
    error,
    sendPick,
  } = useDraftSocket(draftId, memberId);

  const isMyTurn = onTheClock === memberId;

  return (
    <div className="draft-room">
      <header className="draft-header">
        <h2>Draft Room</h2>
        <div className="draft-status">
          {!connected && <span className="status-badge offline">Disconnected</span>}
          {connected && !draftCompleted && (
            <span className="status-badge live">Live</span>
          )}
          {draftCompleted && <span className="status-badge completed">Complete</span>}
        </div>
      </header>

      {error && <div className="error-bar">{error}</div>}

      <div className="draft-layout">
        {/* Timer & On The Clock */}
        <section className="draft-clock">
          <DraftTimer
            timeRemaining={timeRemaining}
            isMyTurn={isMyTurn}
            onTheClock={onTheClock}
            draftCompleted={draftCompleted}
          />
        </section>

        {/* Player Board */}
        <section className="draft-board">
          <PlayerBoard
            draftedPlayerIds={draftedPlayerIds}
            isMyTurn={isMyTurn}
            onPick={sendPick}
          />
        </section>

        {/* Pick History */}
        <section className="draft-history">
          <PickHistory picks={picks} />
        </section>
      </div>
    </div>
  );
}

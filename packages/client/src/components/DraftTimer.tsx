interface DraftTimerProps {
  timeRemaining: number | null;
  isMyTurn: boolean;
  onTheClock: string | null;
  draftCompleted: boolean;
}

export function DraftTimer({
  timeRemaining,
  isMyTurn,
  onTheClock,
  draftCompleted,
}: DraftTimerProps) {
  if (draftCompleted) {
    return (
      <div className="timer-container completed">
        <div className="timer-label">Draft Complete</div>
      </div>
    );
  }

  if (!onTheClock) {
    return (
      <div className="timer-container waiting">
        <div className="timer-label">Waiting for draft to start...</div>
      </div>
    );
  }

  const seconds = Math.ceil(timeRemaining ?? 0);
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  const display = `${minutes}:${secs.toString().padStart(2, '0')}`;

  const urgency =
    seconds <= 10 ? 'critical' : seconds <= 30 ? 'warning' : 'normal';

  return (
    <div className={`timer-container ${urgency}`}>
      <div className="timer-display">{display}</div>
      <div className="timer-label">
        {isMyTurn ? 'Your Pick!' : `Waiting for pick...`}
      </div>
    </div>
  );
}

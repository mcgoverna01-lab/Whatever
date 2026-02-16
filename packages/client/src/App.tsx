import { useState } from 'react';
import { DraftRoom } from './components/DraftRoom.js';

export function App() {
  // TODO: routing, auth, league selection
  const [draftId] = useState<string | null>(null);
  const [memberId] = useState<string | null>(null);

  if (!draftId || !memberId) {
    return (
      <div className="app">
        <header className="header">
          <h1>Pitch Draft</h1>
          <p>Premier League Fantasy Draft</p>
        </header>
        <main className="main">
          <p>No active draft. Create or join a league to get started.</p>
        </main>
      </div>
    );
  }

  return (
    <div className="app">
      <DraftRoom draftId={draftId} memberId={memberId} />
    </div>
  );
}

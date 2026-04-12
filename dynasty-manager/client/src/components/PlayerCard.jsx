const POSITION_COLORS = {
  QB: 'bg-pos-qb/15 text-pos-qb border-pos-qb/30',
  RB: 'bg-pos-rb/15 text-pos-rb border-pos-rb/30',
  WR: 'bg-pos-wr/15 text-pos-wr border-pos-wr/30',
  TE: 'bg-pos-te/15 text-pos-te border-pos-te/30'
};

export default function PlayerCard({ player, onClick, selected = false, compact = false }) {
  const posClass = POSITION_COLORS[player.position] || 'bg-white/5 text-ink-300 border-white/10';
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group w-full text-left rounded-lg border border-white/5 bg-ink-800/60 hover:bg-ink-700/60 hover:border-white/10 transition-all px-3 py-2.5 flex items-center gap-3 ${
        selected ? 'ring-1 ring-white/30 border-white/20' : ''
      }`}
    >
      <div
        className={`shrink-0 w-10 h-10 flex items-center justify-center rounded-md border font-display font-semibold text-sm ${posClass}`}
      >
        {player.position}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-ink-100 truncate">{player.name}</div>
        <div className="text-[11px] text-ink-300 font-mono flex items-center gap-2">
          <span>{player.team}</span>
          {player.age != null && <span>{'\u00b7'} {player.age}y</span>}
          {!compact && player.experience != null && <span>{'\u00b7'} {player.experience}yr exp</span>}
          {player.injury && (
            <span className="text-red-400/90 uppercase text-[10px] font-semibold">
              {player.injury}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

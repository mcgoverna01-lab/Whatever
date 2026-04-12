import { gradeTone } from '../utils/grading.js';

export default function GradeBadge({ grade, size = 'md', label }) {
  const sizing = {
    sm: 'text-2xl w-12 h-12',
    md: 'text-4xl w-16 h-16',
    lg: 'text-6xl w-24 h-24'
  }[size];
  const tone = gradeTone(grade);
  return (
    <div className="flex flex-col items-center gap-1">
      <div
        className={`font-display font-semibold flex items-center justify-center rounded-lg border border-white/10 bg-ink-900 ${sizing} ${tone}`}
        style={{ boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.04)' }}
      >
        {grade || '—'}
      </div>
      {label ? <div className="text-[10px] uppercase tracking-widest text-ink-300">{label}</div> : null}
    </div>
  );
}

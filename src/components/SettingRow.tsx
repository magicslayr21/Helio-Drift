export function SettingRow({
  label,
  hint,
  on,
  onToggle,
}: {
  label: string;
  hint: string;
  on: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-steel/25 py-3">
      <div className="min-w-0">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-hot">
          {label}
        </p>
        <p className="mt-1 text-[10px] leading-relaxed text-amber/45">{hint}</p>
      </div>
      <button
        onClick={onToggle}
        role="switch"
        aria-label={label}
        aria-checked={on}
        className={`w-16 shrink-0 border px-2 py-1.5 text-[10px] uppercase tracking-[0.22em] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-amber ${on ? "border-amber bg-amber/15 text-amber" : "border-steel/50 text-amber/40 hover:border-amber/60"}`}
      >
        {on ? "On" : "Off"}
      </button>
    </div>
  );
}

export function LevelPips({ level, max, color }: { level: number; max: number; color: string }) {
  return (
    <span className="inline-flex items-center gap-[3px]" aria-label={`level ${level} of ${max}`}>
      {Array.from({ length: max }).map((_, i) => (
        <span
          key={i}
          className="h-[6px] w-[6px]"
          style={{
            background: i < level ? color : "rgba(58,63,85,0.5)",
            boxShadow: i < level ? `0 0 6px ${color}` : "none",
          }}
        />
      ))}
    </span>
  );
}

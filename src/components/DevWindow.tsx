import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Move } from "lucide-react";

type Position = { x: number; y: number };
const POSITION_KEY = "helios-dev-window-position";

export function DevWindow({ children }: { children: ReactNode }) {
  const panel = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: number; dx: number; dy: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [position, setPosition] = useState<Position>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(POSITION_KEY) || "null");
      if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) return saved;
    } catch {
      /* Use the default position if storage is unavailable. */
    }
    return { x: Math.max(8, window.innerWidth - 292), y: 80 };
  });
  const latest = useRef(position);

  const move = (next: Position, persist = false) => {
    const bounds = panel.current?.getBoundingClientRect();
    const clamped = {
      x: Math.max(8, Math.min(next.x, window.innerWidth - (bounds?.width ?? 276) - 8)),
      y: Math.max(8, Math.min(next.y, window.innerHeight - (bounds?.height ?? 40) - 8)),
    };
    latest.current = clamped;
    setPosition(clamped);
    if (persist) {
      try {
        localStorage.setItem(POSITION_KEY, JSON.stringify(clamped));
      } catch {
        /* Position still lasts until the window closes. */
      }
    }
  };

  useEffect(() => {
    const keepVisible = () => move(latest.current);
    keepVisible();
    window.addEventListener("resize", keepVisible);
    const observer = new ResizeObserver(keepVisible);
    if (panel.current) observer.observe(panel.current);
    return () => {
      window.removeEventListener("resize", keepVisible);
      observer.disconnect();
    };
  }, []);

  const finishDrag = () => {
    if (!drag.current) return;
    drag.current = null;
    setDragging(false);
    move(latest.current, true);
  };

  return createPortal(
    <div
      ref={panel}
      role="region"
      aria-label="Developer console"
      className="thin-scroll fixed z-[100] max-h-[calc(100dvh-1rem)] w-[276px] max-w-[calc(100vw-1rem)] overflow-y-auto border border-magenta/60 bg-black/88 p-3 pt-10 backdrop-blur-sm"
      style={{ left: position.x, top: position.y }}
    >
      <button
        type="button"
        aria-label="Move developer console"
        title="Drag to move · Arrow keys to nudge"
        className={`absolute left-2 top-2 touch-none select-none border border-magenta/50 p-1 text-magenta hover:bg-magenta/15 focus-visible:outline focus-visible:outline-magenta ${dragging ? "cursor-grabbing" : "cursor-grab"}`}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          const bounds = panel.current!.getBoundingClientRect();
          drag.current = {
            id: event.pointerId,
            dx: event.clientX - bounds.left,
            dy: event.clientY - bounds.top,
          };
          event.currentTarget.setPointerCapture(event.pointerId);
          setDragging(true);
          event.preventDefault();
          event.stopPropagation();
        }}
        onPointerMove={(event) => {
          if (drag.current?.id !== event.pointerId) return;
          move({ x: event.clientX - drag.current.dx, y: event.clientY - drag.current.dy });
        }}
        onPointerUp={finishDrag}
        onPointerCancel={finishDrag}
        onLostPointerCapture={finishDrag}
        onKeyDown={(event) => {
          event.stopPropagation();
          const steps: Record<string, Position> = {
            ArrowLeft: { x: -1, y: 0 },
            ArrowRight: { x: 1, y: 0 },
            ArrowUp: { x: 0, y: -1 },
            ArrowDown: { x: 0, y: 1 },
          };
          const step = steps[event.key];
          if (!step) return;
          event.preventDefault();
          const distance = event.shiftKey ? 40 : 10;
          move(
            { x: latest.current.x + step.x * distance, y: latest.current.y + step.y * distance },
            true,
          );
        }}
      >
        <Move className="h-4 w-4" aria-hidden="true" />
      </button>
      {children}
    </div>,
    document.body,
  );
}

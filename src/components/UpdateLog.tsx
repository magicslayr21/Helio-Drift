import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { UPDATE_LOG } from "../game/update-log";

export function UpdateLog({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const element = dialog.current!;
    element.showModal();
    return () => {
      element.close();
      previous?.focus();
    };
  }, []);

  return createPortal(
    <dialog
      ref={dialog}
      aria-labelledby="update-log-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onKeyDown={(event) => {
        event.stopPropagation();
        // The archive has one interactive control; keep Tab on that control
        // instead of handing focus to browser chrome or the paused game.
        if (event.key === "Tab") {
          event.preventDefault();
          dialog.current?.querySelector("button")?.focus();
        }
      }}
      className="thin-scroll fixed inset-0 m-auto max-h-[85dvh] w-[min(680px,calc(100%-2rem))] overflow-y-auto border border-ice/45 bg-void p-6 text-amber shadow-[0_0_50px_rgba(111,231,255,.12)] backdrop:bg-black/85 backdrop:backdrop-blur-sm"
    >
      <header className="flex items-start justify-between gap-4 border-b border-steel/35 pb-4">
        <div>
          <p className="legend text-ice">Transmission archive</p>
          <h2 id="update-log-title" className="mt-1 font-display text-3xl text-amber-hot">
            UPDATE LOG
          </h2>
        </div>
        <button
          autoFocus
          onClick={onClose}
          aria-label="Close update log"
          className="border border-steel/50 p-2 text-amber/70 hover:border-amber focus-visible:outline-ice"
        >
          <X size={18} />
        </button>
      </header>
      <div className="mt-5 space-y-8">
        {UPDATE_LOG.map((entry) => (
          <article key={entry.version}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="font-display text-xl text-ice">v{entry.version}</h3>
              <span className="legend text-amber/55">{entry.date}</span>
            </div>
            <p className="mt-1 text-sm uppercase tracking-widest text-amber-hot">{entry.title}</p>
            <ul className="mt-3 space-y-3 text-sm leading-relaxed text-amber/80">
              {entry.items.map((item) => (
                <li key={item} className="border-l border-amber/40 pl-3">
                  {item}
                </li>
              ))}
            </ul>
          </article>
        ))}
      </div>
    </dialog>,
    document.body,
  );
}

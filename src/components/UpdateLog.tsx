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
      className="thin-scroll fixed inset-0 m-auto max-h-[85dvh] w-[min(680px,calc(100%-2rem))] overflow-y-auto rounded-sm border border-steel/45 bg-void p-0 text-amber shadow-2xl backdrop:bg-black/85 backdrop:backdrop-blur-sm"
    >
      <header className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-steel/35 bg-void px-5 py-5 sm:px-7">
        <div>
          <p className="legend text-ice/70">Release notes</p>
          <h2 id="update-log-title" className="mt-1 font-display text-2xl text-amber-hot">
            UPDATE LOG
          </h2>
        </div>
        <button
          autoFocus
          onClick={onClose}
          aria-label="Close update log"
          className="rounded-sm border border-steel/40 p-2 text-amber/70 transition-colors hover:border-amber hover:text-amber-hot focus-visible:outline-ice"
        >
          <X size={18} />
        </button>
      </header>
      <div className="divide-y divide-steel/25 px-5 sm:px-7">
        {UPDATE_LOG.map((entry, index) => (
          <article key={entry.version} className="py-6">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div className="flex flex-wrap items-center gap-3">
                <h3 className="font-mono text-sm font-semibold text-ice">v{entry.version}</h3>
                {index === 0 && (
                  <span className="rounded-sm border border-ice/25 bg-ice/5 px-2 py-0.5 text-[10px] font-semibold tracking-widest text-ice">
                    LATEST
                  </span>
                )}
              </div>
              <span className="text-xs text-amber/55">
                {entry.date === "Previous release" ? (
                  entry.date
                ) : (
                  <time dateTime={entry.date}>
                    {new Date(`${entry.date}T00:00:00Z`).toLocaleDateString("en-AU", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                      timeZone: "UTC",
                    })}
                  </time>
                )}
              </span>
            </div>
            <p className="mt-2 text-base font-medium text-amber-hot">{entry.title}</p>
            <ul className="mt-3 list-disc space-y-1.5 pl-4 text-sm leading-relaxed text-amber/80 marker:text-ice/60">
              {entry.items.map((item) => (
                <li key={item} className="pl-1">
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

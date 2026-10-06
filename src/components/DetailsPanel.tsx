import { useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import Masthead from "./Masthead";
import MarqueeBand from "./MarqueeBand";
import SpecSection from "./SpecSection";

/** Full-screen sheet holding everything that used to sit under the game. */
export default function DetailsPanel({
  open,
  onClose,
  developer,
}: {
  open: boolean;
  onClose: () => void;
  developer: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", h, true);
    return () => window.removeEventListener("keydown", h, true);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="details"
          role="dialog"
          aria-modal="true"
          aria-label="Game details"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="thin-scroll fixed inset-0 z-[100] overflow-y-auto bg-void"
        >
          <div className="sticky top-0 z-10 flex items-center justify-between border-b border-steel/30 bg-void/92 px-4 py-2 backdrop-blur-sm sm:px-8">
            <p className="legend">Game Details</p>
            <button
              onClick={onClose}
              className="border border-amber/60 px-4 py-2 text-[10px] uppercase tracking-[0.24em] text-amber transition-colors hover:bg-amber/15 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber"
            >
              Back to Game
            </button>
          </div>
          <Masthead />
          <MarqueeBand />
          <SpecSection developer={developer} />
        </motion.div>
      )}
    </AnimatePresence>
  );
}

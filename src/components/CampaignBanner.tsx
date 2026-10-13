import { AnimatePresence, motion } from "framer-motion";

/** The same wave and boss-ability callouts in campaign and co-op. */
export function CampaignBanner({
  banner,
  subtitle,
  visible,
}: {
  banner: string;
  subtitle: string;
  visible: boolean;
}) {
  return (
    <AnimatePresence>
      {banner && visible && (
        <motion.div
          key={banner}
          initial={{ opacity: 0, y: -12, letterSpacing: "0.5em" }}
          animate={{ opacity: 1, y: 0, letterSpacing: "0.22em" }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.5 }}
          className="pointer-events-none absolute inset-x-0 top-[45%] text-center sm:top-[16%]"
        >
          <p className="font-display text-[clamp(1.8rem,6vw,3.4rem)] text-amber-hot drop-shadow-[0_0_28px_rgba(255,176,58,0.55)]">
            {banner}
          </p>
          <p className="legend mt-1 text-amber/80">{subtitle}</p>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Game,
  loadScores,
  saveScore,
  WEAPON_DEFS,
  WEAPON_ORDER,
  MAX_WEAPON_LEVEL,
  STAT_UPGRADES,
  type Hud,
  type Mode,
  type ScoreEntry,
  type UpgradeCard,
  type WeaponId,
  type WeaponStatRow,
  type SalvageShopInfo,
  type SalvageUpgradeId,
} from "../game/engine";
import { HeliosMark } from "./Masthead";
import { audio } from "../game/audio";
import { GAME_CONFIG } from "../game/game-config";
import nebulaImg from "../assets/nebula.jpg";
import marqueeImg from "../assets/marquee.jpg";

const EMPTY_HUD: Hud = {
  mode: "menu",
  score: 0,
  credits: 0,
  wave: 0,
  level: 1,
  xp: 0,
  xpNext: 100,
  hull: 100,
  maxHull: 100,
  sector: 0,
  primary: "pulse",
  weaponLevel: 1,
  owned: [{ id: "pulse", level: 1 }],
  missiles: 3,
  maxMissiles: 3,
  missileCharge: 1,
  heat: 0,
  comboTime: 0,
  multiplier: 1,
  banner: "",
  bannerSub: "",
  salvage: {
    purchased: false,
    active: false,
    hp: 0,
    maxHp: 24,
    rebuilding: 0,
    weapon: null,
    upgrades: [],
  },
  boosts: { taken: [], totals: [], totalStacks: 0 },
  showerActive: false,
  bonusAvailable: false,
  bonusActive: false,
  bonusDefeated: false,
};

const SECTORS = [
  { numeral: "I", name: "Deep Void" },
  { numeral: "II", name: "Verdant Drift" },
  { numeral: "III", name: "Frozen Belt" },
  { numeral: "IV", name: "Violet Storm" },
  { numeral: "V", name: "Ember Field" },
  { numeral: "VI", name: "The Core" },
  { numeral: "VII", name: "Solar Cataclysm" },
];

const SECTOR_FILTER = [
  "saturate(1.15) brightness(1)",
  "hue-rotate(115deg) saturate(1.25)",
  "hue-rotate(190deg) saturate(1.15)",
  "hue-rotate(265deg) saturate(1.35)",
  "hue-rotate(330deg) saturate(1.5)",
  "hue-rotate(20deg) saturate(2.6) brightness(1.45)",
  "sepia(0.85) hue-rotate(-20deg) saturate(3.2) brightness(1.35) contrast(1.2)",
];

// Hybrid Aim is the default flight scheme: the hull tracks the cursor while the
// keys push the ship in world space. Legacy Movement opts back into the classic
// keyboard-only handling (rotate with A/D, thrust with W) with no mouse assist.
const EMPTY_SETTINGS = {
  autoFire: false,
  mouseControl: false,
  hybridAim: true,
  legacyMovement: false,
  shake: true,
};

const DRONE_UPGRADE_IDS = [
  "twinCannons",
  "overcharge",
  "piercing",
  "armor",
  "repairPulse",
  "magnet",
  "scan",
  "speed",
] as const satisfies readonly SalvageUpgradeId[];

function Meter({
  value,
  max,
  color,
  glow,
}: {
  value: number;
  max: number;
  color: string;
  glow: string;
}) {
  return (
    <div className="h-[6px] w-full bg-steel/35">
      <div
        className="h-full transition-[width] duration-200 ease-out"
        style={{
          width: `${Math.max(0, Math.min(100, (value / max) * 100))}%`,
          background: color,
          boxShadow: `0 0 12px ${glow}`,
        }}
      />
    </div>
  );
}

function LevelPips({ level, max, color }: { level: number; max: number; color: string }) {
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

export default function GameShell({
  onOpenDetails,
  detailsOpen = false,
  onDeveloperChange,
}: {
  onOpenDetails?: () => void;
  detailsOpen?: boolean;
  onDeveloperChange: (enabled: boolean) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<Game | null>(null);
  const [hud, setHud] = useState<Hud>(EMPTY_HUD);
  const [mode, setMode] = useState<Mode>("menu");
  const [choices, setChoices] = useState<UpgradeCard[]>([]);
  const [scores, setScores] = useState<ScoreEntry[]>([]);
  const [run, setRun] = useState<ScoreEntry | null>(null);
  const [muted, setMuted] = useState(audio.muted);

  const [settings, setSettings] = useState(() => {
    try {
      const raw = localStorage.getItem("helios-settings-v1");
      if (raw) return { ...EMPTY_SETTINGS, ...(JSON.parse(raw) as Partial<typeof EMPTY_SETTINGS>) };
    } catch {
      /* fall through */
    }
    return { ...EMPTY_SETTINGS };
  });
  const [panel, setPanel] = useState<"none" | "settings" | "code">("none");
  const [codeInput, setCodeInput] = useState("");
  const [codeError, setCodeError] = useState(false);
  const [, forceTick] = useState(0);
  const [shopOpen, setShopOpen] = useState(false);
  const [shopWeapon, setShopWeapon] = useState<WeaponId>("pulse");
  const [shopTab, setShopTab] = useState<"weapons" | "drone">("weapons");
  const shopReturnMode = useRef<Mode>("playing");
  const [devUnlocked, setDevUnlocked] = useState(false);
  const [devOpen, setDevOpen] = useState(false);
  const [devPage, setDevPage] = useState<1 | 2>(1);

  useEffect(() => {
    onDeveloperChange(devUnlocked);
  }, [devUnlocked, onDeveloperChange]);

  useEffect(() => {
    // Retire permissions saved by older releases. Do not use sessionStorage:
    // browsers may restore it when a closed tab is reopened.
    try {
      localStorage.removeItem("helios-dev-unlocked");
    } catch {
      /* unavailable */
    }
    const revoke = () => {
      setDevUnlocked(false);
      setDevOpen(false);
      onDeveloperChange(false);
      if (gameRef.current) gameRef.current.god = false;
    };
    window.addEventListener("pagehide", revoke);
    return () => window.removeEventListener("pagehide", revoke);
  }, [onDeveloperChange]);

  useEffect(() => {
    setScores(loadScores());
    const canvas = canvasRef.current;
    if (!canvas) return;
    let restoring = false;
    const g = new Game(canvas, {
      onHud: setHud,
      onMode: (m) => {
        setMode(m);
        if (m === "levelup") setChoices([...g.choices]);
        if (m === "gameover" || m === "victory") {
          setShopOpen(false);
          const entry: ScoreEntry = {
            score: Math.floor(g.score),
            wave: g.wave,
            level: g.level,
            date: new Date().toLocaleDateString(undefined, { month: "short", day: "numeric" }),
          };
          setRun(entry);
          if (!restoring) setScores(saveScore(entry));
        }
        if (m !== "paused" && m !== "menu") setPanel("none");
      },
    });
    gameRef.current = g;
    restoring = true;
    g.restoreRun();
    restoring = false;
    return () => {
      g.destroy();
      gameRef.current = null;
    };
  }, []);

  useEffect(() => {
    const g = gameRef.current;
    if (g) {
      g.settings.autoFire = settings.autoFire;
      g.settings.mouseControl = settings.mouseControl;
      g.settings.hybridAim = settings.hybridAim;
      g.settings.legacyMovement = settings.legacyMovement;
      g.settings.shake = settings.shake;
    }
    try {
      localStorage.setItem("helios-settings-v1", JSON.stringify(settings));
    } catch {
      /* ignore */
    }
  }, [settings]);

  // opening the details sheet pauses a live run so nothing happens behind it
  useEffect(() => {
    if (!detailsOpen) return;
    const g = gameRef.current;
    if (g && g.mode === "playing") g.setMode("paused");
  }, [detailsOpen]);

  const openDetails = useCallback(() => {
    audio.play("ui");
    setPanel("none");
    onOpenDetails?.();
  }, [onOpenDetails]);

  const start = useCallback(() => {
    audio.unlock();
    setRun(null);
    setPanel("none");
    gameRef.current?.startGame();
  }, []);
  const resume = useCallback(() => {
    audio.unlock();
    setPanel("none");
    gameRef.current?.setMode("playing");
  }, []);
  const pause = useCallback(() => {
    const g = gameRef.current;
    if (!g) return;
    if (g.mode === "playing") g.setMode("paused");
    else if (g.mode === "paused") {
      setPanel("none");
      g.setMode("playing");
    }
  }, []);
  const toggleMute = useCallback(() => {
    audio.unlock();
    const next = !audio.muted;
    audio.setMuted(next);
    setMuted(next);
    if (!next) audio.play("ui");
  }, []);
  const toggleSetting = useCallback((key: keyof typeof EMPTY_SETTINGS) => {
    audio.play("ui");
    setSettings((s) => ({ ...s, [key]: !s[key] }));
  }, []);

  // The three flight schemes are mutually exclusive. Switching one on clears the
  // others; switching the active one off falls back to Legacy Movement, since
  // that is plain keyboard steering with no mouse assist.
  const toggleMovement = useCallback((key: "mouseControl" | "hybridAim" | "legacyMovement") => {
    audio.play("ui");
    setSettings((s) => {
      const on = !s[key];
      return {
        ...s,
        mouseControl: on && key === "mouseControl",
        hybridAim: on && key === "hybridAim",
        legacyMovement: on ? key === "legacyMovement" : true,
      };
    });
  }, []);
  const cycleWeapon = useCallback(() => gameRef.current?.cycleWeapon(1), []);

  const openShop = useCallback(() => {
    const g = gameRef.current;
    if (!g || g.mode === "menu" || g.mode === "gameover" || g.mode === "victory") return;
    audio.play("ui");
    shopReturnMode.current = g.mode;
    setDevOpen(false);
    setPanel("none");
    setShopOpen(true);
    if (g.mode !== "paused") g.setMode("paused");
  }, []);

  const closeShop = useCallback(() => {
    const g = gameRef.current;
    setShopOpen(false);
    if (g && shopReturnMode.current !== "paused") g.setMode(shopReturnMode.current);
  }, []);

  const closePanel = useCallback(() => {
    setPanel("none");
    setCodeInput("");
    setCodeError(false);
  }, []);
  const submitCode = useCallback(() => {
    if (codeInput.trim().toLowerCase() === GAME_CONFIG.developer.accessCode.trim().toLowerCase()) {
      setDevUnlocked(true);
      setDevOpen(true);
      closePanel();
      audio.play("levelup");
    } else {
      setCodeError(true);
      audio.play("overheat");
    }
  }, [codeInput, closePanel]);

  useEffect(() => {
    if (panel === "none" && !shopOpen) return;
    const close = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      if (shopOpen) closeShop();
      else closePanel();
    };
    window.addEventListener("keydown", close, true);
    return () => window.removeEventListener("keydown", close, true);
  }, [panel, shopOpen, closePanel, closeShop]);

  // backquote toggles the dev console — only once the service code has been entered
  useEffect(() => {
    if (!devUnlocked) return;
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      // "Backquote" is the physical code; e.key would be the ` character itself
      if (e.code === "Backquote") {
        e.preventDefault();
        setDevOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [devUnlocked]);

  const dev = useCallback((fn: (x: Game) => void) => {
    const x = gameRef.current;
    if (!x) return;
    fn(x);
    audio.play("ui");
  }, []);
  const devPlaying = useCallback((fn: (x: Game) => void) => {
    const x = gameRef.current;
    if (!x || x.mode !== "playing") return;
    fn(x);
    audio.play("ui");
  }, []);
  /** stat-stack edits must refresh the HUD, since stacks feed the boost ledger */
  const devStat = useCallback((fn: (x: Game) => void) => {
    const x = gameRef.current;
    if (!x) return;
    fn(x);
    setHud(x.snapshot());
    forceTick((v) => v + 1);
    audio.play("ui");
  }, []);

  const best = scores[0]?.score ?? 0;
  const curWeapon = WEAPON_DEFS[hud.primary];
  const shopInfo = gameRef.current?.weaponShopInfo(shopWeapon);
  const droneInfo = gameRef.current?.salvageShopInfo();
  const shopDef = WEAPON_DEFS[shopWeapon];
  const shopAccent =
    shopDef.rarity === "epic" ? "#ff3d6e" : shopDef.rarity === "rare" ? "#6fe7ff" : "#ffb03a";

  return (
    <section className="relative h-dvh w-full overflow-y-auto overflow-x-hidden">
      <div className="relative flex h-full w-full gap-0">
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
          {/* top telemetry strip */}
          <div className="flex shrink-0 items-end justify-between border-b border-steel/25 px-3 py-2 sm:px-5">
            <div>
              <p className="legend">Score</p>
              <p className="font-display text-[clamp(1.6rem,4.2vw,2.6rem)] leading-none text-amber-hot">
                {String(hud.score).padStart(6, "0")}
              </p>
            </div>
            <div className="hidden text-center sm:block">
              <p className="legend">Sector Wave</p>
              <p className="font-display text-[clamp(1.2rem,3vw,1.9rem)] leading-none text-amber">
                {String(hud.wave).padStart(2, "0")}
              </p>
            </div>
            <div className="flex items-end gap-5 sm:gap-8">
              <div className="text-right">
                <p className="legend">Multiplier</p>
                <p className="font-display text-[clamp(1.1rem,3vw,1.7rem)] leading-none text-magenta">
                  ×{hud.multiplier.toFixed(1)}
                </p>
              </div>
              <div className="text-right">
                <p className="legend">Credits</p>
                <p className="font-display text-[clamp(1.1rem,3vw,1.7rem)] leading-none text-amber">
                  {hud.credits}
                </p>
              </div>
              <button
                onClick={openShop}
                disabled={mode === "menu" || mode === "gameover" || mode === "victory"}
                className="border border-ice/50 px-3 py-2 text-[10px] uppercase tracking-[0.22em] text-ice transition-colors hover:border-ice hover:bg-ice/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-ice disabled:cursor-not-allowed disabled:opacity-25"
              >
                Shop
              </button>
              <button
                onClick={toggleMute}
                aria-pressed={muted}
                aria-label={muted ? "Unmute audio" : "Mute audio"}
                className="border border-steel/50 px-3 py-2 text-[10px] uppercase tracking-[0.22em] text-amber/80 transition-colors hover:border-amber hover:bg-amber/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber"
              >
                {muted ? "♪ Off" : "♪ On"}
              </button>
              <button
                onClick={openDetails}
                className="hidden border border-steel/50 px-3 py-2 text-[10px] uppercase tracking-[0.22em] text-amber/80 transition-colors hover:border-amber hover:bg-amber/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber sm:block"
              >
                Details
              </button>
              <button
                onClick={pause}
                className="border border-steel/50 px-3 py-2 text-[10px] uppercase tracking-[0.22em] text-amber/80 transition-colors hover:border-amber hover:bg-amber/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber"
              >
                {mode === "paused" ? "Resume" : "Pause"}
              </button>
            </div>
          </div>

          {/* playfield */}
          <div className="scanlines vignette relative min-h-[320px] w-full flex-1 overflow-hidden border-x border-steel/20 bg-void">
            <div
              className="absolute inset-0 opacity-[0.55]"
              style={{
                backgroundImage: `url(${nebulaImg})`,
                backgroundSize: "cover",
                backgroundPosition: "center",
                filter: SECTOR_FILTER[hud.sector],
                transition: "filter 2.5s ease",
              }}
            />
            <canvas
              ref={canvasRef}
              className={`absolute inset-0 block h-full w-full touch-none select-none ${!settings.legacyMovement && (settings.mouseControl || settings.hybridAim) ? "cursor-crosshair" : ""}`}
              aria-label="Helios Drift playfield"
            />

            <AnimatePresence>
              {hud.banner && mode === "playing" && (
                <motion.div
                  key={hud.banner}
                  initial={{ opacity: 0, y: -12, letterSpacing: "0.5em" }}
                  animate={{ opacity: 1, y: 0, letterSpacing: "0.22em" }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.5 }}
                  className="pointer-events-none absolute inset-x-0 top-[16%] text-center"
                >
                  <p className="font-display text-[clamp(1.8rem,6vw,3.4rem)] text-amber-hot drop-shadow-[0_0_28px_rgba(255,176,58,0.55)]">
                    {hud.banner}
                  </p>
                  <p className="legend mt-1 text-amber/80">{hud.bannerSub}</p>
                </motion.div>
              )}
            </AnimatePresence>

            {/* ---------------- state overlays ---------------- */}
            <AnimatePresence>
              {mode === "menu" && (
                <motion.div
                  key="menu"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.22 }}
                  className="absolute inset-0"
                >
                  <div
                    className="absolute inset-0"
                    style={{
                      backgroundImage: `url(${marqueeImg})`,
                      backgroundSize: "cover",
                      backgroundPosition: "center right",
                    }}
                  />
                  <div className="absolute inset-0 bg-gradient-to-r from-void via-void/92 to-void/35" />
                  <div className="thin-scroll relative flex h-full flex-col justify-center overflow-y-auto px-5 py-8 sm:px-12">
                    <HeliosMark size={40} className="mb-3 text-amber/80" />
                    <p className="legend text-amber/70">Vector Arcade System · HD-79</p>
                    <h1 className="mt-2 font-display text-[clamp(2.6rem,9vw,6.2rem)] leading-[0.86] tracking-[-0.03em] text-amber-hot">
                      HELIOS
                      <br />
                      DRIFT
                    </h1>
                    <p className="mt-4 max-w-sm text-[12px] leading-relaxed text-amber/70 sm:text-[13px]">
                      Inertia is a weapon. Break the belt, bank the salvage, and buy your arsenal
                      from the credit armory — eight weapon tracks, twenty-five waves, five
                      dreadnoughts.
                    </p>
                    <div className="mt-6 flex flex-wrap items-center gap-3">
                      <button
                        onClick={start}
                        className="border-2 border-amber bg-amber px-7 py-3 text-[11px] font-semibold uppercase tracking-[0.28em] text-void transition-transform hover:-translate-y-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-hot"
                      >
                        Start Run
                      </button>
                      <button
                        onClick={() => {
                          audio.play("ui");
                          setPanel("settings");
                        }}
                        className="border border-steel/60 px-5 py-3 text-[11px] uppercase tracking-[0.28em] text-amber/80 transition-colors hover:border-amber hover:bg-amber/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber"
                      >
                        Settings
                      </button>
                      <button
                        onClick={openDetails}
                        className="border border-steel/60 px-5 py-3 text-[11px] uppercase tracking-[0.28em] text-amber/80 transition-colors hover:border-amber hover:bg-amber/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber"
                      >
                        Game Details
                      </button>
                      <div className="text-[10px] uppercase leading-relaxed tracking-[0.18em] text-amber/55">
                        <span className="hidden sm:inline">
                          MOUSE AIMS · WASD THRUSTS · CLICK FIRES · TAB WEAPON · E MISSILE · P PAUSE
                        </span>
                        <span className="sm:hidden">LEFT THUMB STEERS · RIGHT THUMB FIRES</span>
                      </div>
                    </div>
                    <div className="mt-7 max-w-xs">
                      <p className="legend mb-2">Local Top Scores</p>
                      <ol className="space-y-1">
                        {(scores.length
                          ? scores.slice(0, 4)
                          : [{ score: 0, wave: 0, level: 0, date: "—" }]
                        ).map((s, i) => (
                          <li
                            key={i}
                            className="flex items-baseline justify-between border-b border-steel/25 pb-1 text-[11px] text-amber/70"
                          >
                            <span className="legend text-amber/50">
                              {String(i + 1).padStart(2, "0")}
                            </span>
                            <span className="flex-1 px-3 text-amber/45">
                              wave {String(s.wave).padStart(2, "0")} · lvl {s.level}
                            </span>
                            <span className="text-amber-hot">
                              {String(s.score).padStart(6, "0")}
                            </span>
                          </li>
                        ))}
                      </ol>
                    </div>
                  </div>
                </motion.div>
              )}

              {mode === "paused" && (
                <motion.div
                  key="paused"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.18 }}
                  className="absolute inset-0 flex items-center justify-center overflow-y-auto bg-void/86 py-6 backdrop-blur-[2px]"
                >
                  <div className="w-[min(520px,90%)] border border-steel/50 plate p-6 sm:p-7">
                    <div className="flex items-end justify-between">
                      <div>
                        <p className="legend">System State</p>
                        <h2 className="mt-1 font-display text-[clamp(1.8rem,5vw,2.6rem)] leading-none text-amber-hot">
                          PAUSED
                        </h2>
                      </div>
                      <p className="legend text-right text-amber/50">
                        Wave {String(hud.wave).padStart(2, "0")} · Lvl{" "}
                        {String(hud.level).padStart(2, "0")}
                      </p>
                    </div>

                    {/* arsenal readout */}
                    <div className="mt-5 border-y border-steel/30 py-3">
                      <p className="legend mb-2">Arsenal · Tab / Q to cycle · 1–8 to select</p>
                      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-3">
                        {hud.owned.map((o) => (
                          <button
                            key={o.id}
                            onClick={() => dev((x) => x.selectWeapon(o.id))}
                            className={`flex items-center justify-between gap-2 border px-2 py-1.5 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-amber ${
                              o.id === hud.primary
                                ? "border-amber bg-amber/10"
                                : "border-steel/40 hover:border-amber/60"
                            }`}
                          >
                            <span className="text-[10px] uppercase tracking-[0.16em] text-amber-hot">
                              {WEAPON_DEFS[o.id].short}
                            </span>
                            <LevelPips level={o.level} max={MAX_WEAPON_LEVEL} color="#ffb03a" />
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* boost ledger: every stat card taken, and what they add up to */}
                    <div className="mt-4 border border-steel/35 bg-black/25 p-3">
                      <div className="flex items-baseline justify-between gap-3">
                        <p className="legend">Boosts Unlocked</p>
                        <p className="text-[10px] uppercase tracking-[0.16em] text-amber/55">
                          {hud.boosts.totalStacks} stack{hud.boosts.totalStacks === 1 ? "" : "s"} ·{" "}
                          {hud.boosts.taken.length} type{hud.boosts.taken.length === 1 ? "" : "s"}
                        </p>
                      </div>
                      {hud.boosts.taken.length === 0 ? (
                        <p className="mt-2 text-[10px] leading-relaxed text-amber/35">
                          No stat upgrades yet — level up to draw your first rack.
                        </p>
                      ) : (
                        <>
                          <div className="thin-scroll mt-2 flex max-h-[76px] flex-wrap gap-1.5 overflow-y-auto">
                            {hud.boosts.taken.map((b) => (
                              <span
                                key={b.id}
                                className="inline-flex items-center gap-1.5 border border-steel/40 bg-graphite/60 px-2 py-1"
                              >
                                <span className="text-[9px] uppercase tracking-[0.1em] text-amber-hot">
                                  {b.name}
                                </span>
                                <span className="text-[9px] text-amber/50">
                                  ×{b.level}/{b.max}
                                </span>
                              </span>
                            ))}
                          </div>
                          <div className="mt-2.5 border-t border-steel/25 pt-2">
                            <p className="legend mb-1.5 text-amber/50">Combined effect</p>
                            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3">
                              {hud.boosts.totals.map((t) => (
                                <div
                                  key={t.label}
                                  className="flex items-baseline justify-between gap-2 border-b border-steel/20 pb-0.5 text-[10px]"
                                >
                                  <dt className="truncate uppercase tracking-[0.1em] text-amber/42">
                                    {t.label}
                                  </dt>
                                  <dd className="shrink-0 text-amber-hot">{t.value}</dd>
                                </div>
                              ))}
                            </dl>
                          </div>
                        </>
                      )}
                    </div>

                    <div className="mt-4 grid grid-cols-2 gap-2">
                      <button
                        onClick={resume}
                        className="col-span-2 border-2 border-amber bg-amber px-6 py-3 text-[11px] font-semibold uppercase tracking-[0.28em] text-void transition-transform hover:-translate-y-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-hot"
                      >
                        Resume
                      </button>
                      <button
                        onClick={openShop}
                        className="col-span-2 border border-ice/60 px-4 py-3 text-[11px] uppercase tracking-[0.24em] text-ice transition-colors hover:bg-ice/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-ice"
                      >
                        Weapon Shop · {hud.credits} CR
                      </button>
                      <button
                        onClick={() => {
                          audio.play("ui");
                          setPanel("settings");
                        }}
                        className="border border-steel/60 px-4 py-3 text-[11px] uppercase tracking-[0.24em] text-amber/80 transition-colors hover:border-amber hover:bg-amber/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber"
                      >
                        Settings
                      </button>
                      <button
                        onClick={() => {
                          audio.play("ui");
                          if (devUnlocked) setDevOpen((v) => !v);
                          else setPanel("code");
                        }}
                        className={`border px-4 py-3 text-[11px] uppercase tracking-[0.24em] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-amber ${
                          devUnlocked
                            ? "border-magenta/60 text-magenta hover:bg-magenta/10"
                            : "border-steel/60 text-amber/80 hover:border-amber hover:bg-amber/10"
                        }`}
                      >
                        {devUnlocked ? (devOpen ? "Hide Console" : "Dev Console") : "Service Code"}
                      </button>
                      <button
                        onClick={start}
                        className="col-span-2 border border-steel/60 px-6 py-3 text-[11px] uppercase tracking-[0.28em] text-amber/60 transition-colors hover:border-magenta hover:text-magenta focus:outline-none focus-visible:ring-2 focus-visible:ring-amber"
                      >
                        Restart Run
                      </button>
                    </div>
                    <p className="legend mt-4 text-center text-amber/40">
                      P or Esc to resume · R restarts
                    </p>
                  </div>
                </motion.div>
              )}

              {mode === "levelup" && (
                <motion.div
                  key="levelup"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="absolute inset-0 flex flex-col justify-center overflow-y-auto bg-void/78 px-3 py-6 sm:px-8"
                >
                  <div className="mb-4 flex items-end justify-between">
                    <div>
                      <p className="legend text-amber">Upgrade Available</p>
                      <h2 className="font-display text-[clamp(1.5rem,4.6vw,2.6rem)] leading-none text-amber-hot">
                        LEVEL {String(hud.level).padStart(2, "0")}
                      </h2>
                    </div>
                    <div className="hidden text-right sm:block">
                      <p className="legend">Available Credits</p>
                      <p className="font-display text-2xl leading-none text-amber">
                        {hud.credits} CR
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-col gap-2.5 sm:flex-row">
                    {choices.map((c, i) => {
                      const accent =
                        c.rarity === "epic"
                          ? "#ff3d6e"
                          : c.rarity === "rare"
                            ? "#6fe7ff"
                            : "#ffb03a";
                      return (
                        <motion.button
                          key={c.id}
                          initial={{ opacity: 0, x: 90, skewX: -6 }}
                          animate={{ opacity: 1, x: 0, skewX: 0 }}
                          transition={{
                            delay: i * 0.075,
                            type: "spring",
                            stiffness: 260,
                            damping: 26,
                          }}
                          onClick={() => gameRef.current?.chooseUpgrade(c.id)}
                          className={`group flex-1 border p-4 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-amber ${
                            c.rarity === "epic"
                              ? "border-magenta/70 bg-magenta/10 hover:bg-magenta/20"
                              : c.rarity === "rare"
                                ? "border-ice/50 bg-ice/5 hover:bg-ice/15"
                                : "border-steel/60 bg-graphite/70 hover:bg-amber/15"
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <p className="legend" style={{ color: accent }}>
                              {c.tag}
                            </p>
                            <p className="legend text-amber/35">{c.rarity}</p>
                          </div>
                          <h3 className="mt-2 text-[13px] font-semibold uppercase leading-tight tracking-[0.06em] text-amber-hot">
                            {c.name}
                          </h3>
                          <div className="mt-1.5 flex items-center gap-2">
                            <span className="legend text-amber/45">
                              {c.level === 0 ? "New" : `Owned ×${c.level} → ×${c.level + 1}`}
                            </span>
                          </div>
                          <p className="mt-2 text-[11px] leading-relaxed text-amber/60">{c.desc}</p>
                        </motion.button>
                      );
                    })}
                  </div>

                  <div className="mt-5 border-t border-steel/30 pt-4">
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                      <p className="legend">Not satisfied with the rack?</p>
                      <div className="flex flex-wrap gap-2">
                        <button
                          disabled={hud.credits < (gameRef.current?.rerollCost ?? 9999)}
                          onClick={() => {
                            const g = gameRef.current;
                            if (!g) return;
                            const paid = g.rerollChoices();
                            if (paid !== null) {
                              setChoices([...g.choices]);
                              setHud(g.snapshot());
                              forceTick((v) => v + 1);
                            }
                          }}
                          className={`border px-5 py-2.5 text-[10px] uppercase tracking-[0.24em] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-amber ${
                            hud.credits >= (gameRef.current?.rerollCost ?? 9999)
                              ? "border-amber/60 text-amber hover:bg-amber/15"
                              : "cursor-not-allowed border-steel/30 text-amber/25"
                          }`}
                        >
                          Reroll · {gameRef.current?.rerollCost ?? 30} CR
                        </button>
                        <button
                          onClick={openShop}
                          className="border border-ice/60 px-5 py-2.5 text-[10px] uppercase tracking-[0.24em] text-ice transition-colors hover:bg-ice/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-ice"
                        >
                          Weapon Shop
                        </button>
                      </div>
                    </div>
                    <p className="text-[10px] leading-relaxed text-amber/40">
                      Credits only reroll stat options or purchase and level weapons in the shop.
                    </p>
                  </div>
                </motion.div>
              )}

              {mode === "gameover" && (
                <motion.div
                  key="gameover"
                  initial={{ opacity: 0, scale: 1.03 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.28 }}
                  className="absolute inset-0 flex items-center justify-center overflow-y-auto bg-void/90 py-6"
                >
                  <div className="w-[min(520px,92%)] border border-magenta/40 plate p-6 sm:p-8">
                    <p className="legend text-magenta">Hull Breach · Signal Lost</p>
                    <h2 className="mt-1 font-display text-[clamp(2rem,7vw,3.4rem)] leading-none text-amber-hot">
                      RUN ENDED
                    </h2>
                    <div className="mt-6 grid grid-cols-3 gap-3 border-y border-steel/35 py-4">
                      <div>
                        <p className="legend">Final Score</p>
                        <p className="font-display text-[clamp(1.3rem,4vw,2rem)] leading-none text-amber">
                          {String(run?.score ?? hud.score).padStart(6, "0")}
                        </p>
                      </div>
                      <div>
                        <p className="legend">Wave</p>
                        <p className="font-display text-[clamp(1.3rem,4vw,2rem)] leading-none text-amber">
                          {String(run?.wave ?? hud.wave).padStart(2, "0")}
                        </p>
                      </div>
                      <div>
                        <p className="legend">Best</p>
                        <p className="font-display text-[clamp(1.3rem,4vw,2rem)] leading-none text-magenta">
                          {String(best).padStart(6, "0")}
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={start}
                      className="mt-6 w-full border-2 border-amber bg-amber px-6 py-3.5 text-[11px] font-semibold uppercase tracking-[0.28em] text-void transition-transform hover:-translate-y-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-hot"
                    >
                      Restart · R
                    </button>
                    <ScoreList scores={scores} />
                  </div>
                </motion.div>
              )}

              {mode === "victory" && (
                <motion.div
                  key="victory"
                  initial={{ opacity: 0, scale: 1.04 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.32 }}
                  className="absolute inset-0 flex items-center justify-center overflow-y-auto bg-void/90 py-6"
                >
                  <div className="w-[min(540px,92%)] border border-ice/40 plate p-6 sm:p-8">
                    <p className="legend text-ice">
                      {hud.bonusDefeated
                        ? "The Meteor Scattered · Sector VII"
                        : "Core Disintegrates · Sector VI"}
                    </p>
                    <h2 className="mt-1 font-display text-[clamp(2rem,7vw,3.4rem)] leading-none text-amber-hot">
                      {hud.bonusDefeated ? "THE METEOR DESTROYED" : "SECTOR CLEARED"}
                    </h2>
                    <p className="mt-3 text-[12px] leading-relaxed text-amber/60">
                      {hud.bonusDefeated
                        ? "THE METEOR is obliterated. You cleared all 25 waves, faced down the primordial cataclysm, and claimed ultimate supremacy over the belt."
                        : "THE CORE is silent. Five dreadnoughts, five shifting sectors — you cleared all 25 waves of Helios Drift."}
                    </p>

                    {hud.bonusAvailable && (
                      <div className="mt-4 border border-amber/50 bg-amber/[0.06] p-4">
                        <p className="legend text-amber">
                          Cataclysmic Signature · Secret Encounter
                        </p>
                        <h3 className="mt-1 text-[14px] font-semibold uppercase tracking-[0.1em] text-amber-hot">
                          THE METEOR · MK6
                        </h3>
                        <p className="mt-2 text-[11px] leading-relaxed text-amber/60">
                          A primordial meteor titan is warping the edge of known space.
                          Golden-orange molten rings, devastating meteor showers, eight scorching
                          beams, crushing singularities, and explosive strikes await. Your hull and
                          missiles are fully restored if you accept the challenge.
                        </p>
                        <button
                          onClick={() => {
                            const g = gameRef.current;
                            if (!g) return;
                            g.startBonusBoss();
                            setHud(g.snapshot());
                          }}
                          className="mt-3 w-full border-2 border-amber bg-amber px-6 py-3 text-[11px] font-semibold uppercase tracking-[0.26em] text-void transition-transform hover:-translate-y-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-hot"
                        >
                          Face The Meteor
                        </button>
                      </div>
                    )}
                    <div className="mt-6 grid grid-cols-3 gap-3 border-y border-steel/35 py-4">
                      <div>
                        <p className="legend">Final Score</p>
                        <p className="font-display text-[clamp(1.3rem,4vw,2rem)] leading-none text-amber">
                          {String(run?.score ?? hud.score).padStart(6, "0")}
                        </p>
                      </div>
                      <div>
                        <p className="legend">Waves</p>
                        <p className="font-display text-[clamp(1.3rem,4vw,2rem)] leading-none text-ice">
                          25
                        </p>
                      </div>
                      <div>
                        <p className="legend">Best</p>
                        <p className="font-display text-[clamp(1.3rem,4vw,2rem)] leading-none text-amber-hot">
                          {String(best).padStart(6, "0")}
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={start}
                      className="mt-6 w-full border-2 border-ice bg-ice px-6 py-3.5 text-[11px] font-semibold uppercase tracking-[0.28em] text-void transition-transform hover:-translate-y-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-hot"
                    >
                      Fly Again · R
                    </button>
                    <ScoreList scores={scores} />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* ---------------- service panels (opened from pause / menu) ---------------- */}
            <AnimatePresence>
              {panel === "settings" && (
                <motion.div
                  key="settings"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.16 }}
                  className="absolute inset-0 z-40 flex items-center justify-center overflow-y-auto bg-void/88 py-6 backdrop-blur-[2px]"
                >
                  <div className="w-[min(430px,90%)] border border-steel/50 plate p-6">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="legend">Cabinet Diagnostics</p>
                        <h3 className="mt-1 font-display text-2xl leading-none text-amber-hot">
                          SETTINGS
                        </h3>
                      </div>
                      <button
                        onClick={closePanel}
                        aria-label="Close settings"
                        className="border border-steel/50 px-2.5 py-1 text-[11px] text-amber/70 transition-colors hover:border-amber hover:text-amber-hot focus:outline-none focus-visible:ring-2 focus-visible:ring-amber"
                      >
                        X
                      </button>
                    </div>
                    <div className="mt-5">
                      <SettingRow
                        label="Auto-Fire"
                        hint="The ship fires on its own. Free up the trigger to focus on flying and dodging."
                        on={settings.autoFire}
                        onToggle={() => toggleSetting("autoFire")}
                      />
                      <SettingRow
                        label="Hybrid Aim"
                        hint="Default scheme. Twin-stick style: the hull always tracks the cursor while WASD / arrows push the ship in world space. Click to fire."
                        on={settings.hybridAim}
                        onToggle={() => toggleMovement("hybridAim")}
                      />
                      <SettingRow
                        label="Mouse Control"
                        hint="Veteran scheme: the ship faces the cursor and holds the left button to thrust. Keyboard steering is ignored."
                        on={settings.mouseControl}
                        onToggle={() => toggleMovement("mouseControl")}
                      />
                      <SettingRow
                        label="Legacy Movement"
                        hint="Classic cabinet handling: A/D or Left/Right rotate the hull, W thrusts. No mouse aiming at all."
                        on={settings.legacyMovement}
                        onToggle={() => toggleMovement("legacyMovement")}
                      />
                      <SettingRow
                        label="Screen Shake"
                        hint="Camera shake on impacts and explosions. Off for a perfectly still feed."
                        on={settings.shake}
                        onToggle={() => toggleSetting("shake")}
                      />
                      <SettingRow
                        label="Audio"
                        hint="Procedural synth audio. Choice persists between sessions."
                        on={!muted}
                        onToggle={toggleMute}
                      />
                    </div>
                    <button
                      onClick={openDetails}
                      className="mt-5 w-full border border-steel/60 px-4 py-2.5 text-[10px] uppercase tracking-[0.24em] text-amber/80 transition-colors hover:border-amber hover:bg-amber/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber"
                    >
                      Game Details
                    </button>
                    <button
                      onClick={closePanel}
                      className="mt-3 w-full border border-amber/60 px-4 py-2.5 text-[10px] uppercase tracking-[0.24em] text-amber transition-colors hover:bg-amber/15 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber"
                    >
                      Back
                    </button>
                  </div>
                </motion.div>
              )}

              {panel === "code" && (
                <motion.div
                  key="code"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.16 }}
                  className="absolute inset-0 z-40 flex items-center justify-center bg-void/88 backdrop-blur-[2px]"
                >
                  <div
                    className={`w-[min(390px,90%)] border plate p-6 ${codeError ? "border-magenta" : "border-steel/50"}`}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="legend">Service Bay</p>
                        <h3 className="mt-1 font-display text-2xl leading-none text-amber-hot">
                          ENTER CODE
                        </h3>
                      </div>
                      <button
                        onClick={closePanel}
                        aria-label="Close code entry"
                        className="border border-steel/50 px-2.5 py-1 text-[11px] text-amber/70 transition-colors hover:border-amber hover:text-amber-hot focus:outline-none focus-visible:ring-2 focus-visible:ring-amber"
                      >
                        X
                      </button>
                    </div>
                    <p className="mt-4 text-[11px] leading-relaxed text-amber/55">
                      Enter an operator code to unlock cabinet diagnostics.
                    </p>
                    <div className="mt-4 flex gap-2">
                      <input
                        autoFocus
                        value={codeInput}
                        onChange={(e) => {
                          setCodeInput(e.target.value);
                          setCodeError(false);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") submitCode();
                          e.stopPropagation();
                        }}
                        placeholder="CODE"
                        aria-label="Service code"
                        className={`min-w-0 flex-1 border bg-black/60 px-3 py-2.5 text-[12px] uppercase tracking-[0.35em] text-amber-hot placeholder:text-amber/25 focus:outline-none ${codeError ? "border-magenta" : "border-amber/40 focus-visible:ring-2 focus-visible:ring-amber"}`}
                      />
                      <button
                        onClick={submitCode}
                        className="border-2 border-amber bg-amber px-4 text-[10px] font-semibold uppercase tracking-[0.24em] text-void transition-transform hover:-translate-y-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-hot"
                      >
                        Enter
                      </button>
                    </div>
                    {codeError && (
                      <p className="mt-3 text-[10px] uppercase tracking-[0.24em] text-magenta">
                        Invalid code — check the service manual
                      </p>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Weapon shop always suspends the simulation and returns to its prior state. */}
            <AnimatePresence>
              {shopOpen && shopInfo && (
                <motion.div
                  key="weapon-shop"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.16 }}
                  className="absolute inset-0 z-[60] overflow-y-auto bg-void/96 px-3 py-4 backdrop-blur-[3px] sm:px-6"
                >
                  <div className="mx-auto w-full max-w-[920px] border border-ice/40 bg-graphite/80">
                    <div className="flex items-end justify-between gap-4 border-b border-steel/35 px-4 py-3 sm:px-5">
                      <div>
                        <p className="legend text-ice">Credit Armory · Simulation Suspended</p>
                        <h3 className="mt-1 font-display text-[clamp(1.5rem,4vw,2.3rem)] leading-none text-amber-hot">
                          WEAPON SHOP
                        </h3>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="text-right">
                          <p className="legend">Balance</p>
                          <p className="font-display text-xl leading-none text-amber">
                            {hud.credits} CR
                          </p>
                        </div>
                        <button
                          onClick={closeShop}
                          aria-label="Close weapon shop"
                          className="border border-steel/50 px-3 py-2 text-[11px] text-amber/70 transition-colors hover:border-ice hover:text-ice focus:outline-none focus-visible:ring-2 focus-visible:ring-ice"
                        >
                          X
                        </button>
                      </div>
                    </div>

                    <div className="flex border-b border-steel/35">
                      <button
                        onClick={() => {
                          setShopTab("weapons");
                          audio.play("ui");
                        }}
                        className={`flex-1 border-r border-steel/35 px-4 py-2 text-[10px] uppercase tracking-[0.24em] transition-colors ${shopTab === "weapons" ? "bg-ice/10 text-ice" : "text-amber/45 hover:text-amber"}`}
                      >
                        Weapons
                      </button>
                      <button
                        onClick={() => {
                          setShopTab("drone");
                          audio.play("ui");
                        }}
                        className={`flex-1 px-4 py-2 text-[10px] uppercase tracking-[0.24em] transition-colors ${shopTab === "drone" ? "bg-ice/10 text-ice" : "text-amber/45 hover:text-amber"}`}
                      >
                        Salvage Drone
                      </button>
                    </div>

                    {shopTab === "weapons" ? (
                      <div className="grid grid-cols-1 md:grid-cols-[250px_1fr]">
                        <div className="thin-scroll max-h-[260px] overflow-y-auto border-b border-steel/35 p-2 md:max-h-[490px] md:border-b-0 md:border-r">
                          {WEAPON_ORDER.map((w, i) => {
                            const info = gameRef.current!.weaponShopInfo(w);
                            const def = WEAPON_DEFS[w];
                            const accent =
                              def.rarity === "epic"
                                ? "#ff3d6e"
                                : def.rarity === "rare"
                                  ? "#6fe7ff"
                                  : "#ffb03a";
                            return (
                              <button
                                key={w}
                                onClick={() => {
                                  setShopWeapon(w);
                                  audio.play("ui");
                                }}
                                className={`mb-1 flex w-full items-center gap-3 border px-3 py-2.5 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ice ${
                                  w === shopWeapon
                                    ? "border-ice/70 bg-ice/10"
                                    : "border-transparent hover:border-steel/60 hover:bg-white/[0.025]"
                                }`}
                              >
                                <span className="legend w-5 shrink-0" style={{ color: accent }}>
                                  {i + 1}
                                </span>
                                <span className="min-w-0 flex-1">
                                  <span className="block truncate text-[10px] font-semibold uppercase tracking-[0.14em] text-amber-hot">
                                    {def.name}
                                  </span>
                                  <span className="mt-1 flex items-center justify-between gap-2">
                                    <span className="legend" style={{ color: accent }}>
                                      {def.rarity}
                                    </span>
                                    <span className="text-[9px] uppercase tracking-[0.14em] text-amber/45">
                                      {info.owned ? `LV ${info.level}` : `${info.price} CR`}
                                    </span>
                                  </span>
                                </span>
                              </button>
                            );
                          })}
                        </div>

                        <motion.div
                          key={shopWeapon}
                          initial={{ opacity: 0, x: 12 }}
                          animate={{ opacity: 1, x: 0 }}
                          className="p-4 sm:p-6"
                        >
                          <div className="flex flex-wrap items-start justify-between gap-4">
                            <div>
                              <p className="legend" style={{ color: shopAccent }}>
                                {shopDef.rarity} Weapon
                              </p>
                              <h4 className="mt-1 text-[17px] font-semibold uppercase tracking-[0.08em] text-amber-hot">
                                {shopDef.name}
                              </h4>
                              <p className="mt-2 max-w-xl text-[11px] leading-relaxed text-amber/58">
                                {shopDef.desc}
                              </p>
                            </div>
                            <div className="text-right">
                              <p className="legend">Installed</p>
                              <div className="mt-1">
                                <LevelPips
                                  level={shopInfo.level}
                                  max={MAX_WEAPON_LEVEL}
                                  color={shopAccent}
                                />
                              </div>
                              <p
                                className="mt-1 text-[10px] uppercase tracking-[0.16em]"
                                style={{ color: shopAccent }}
                              >
                                {shopInfo.owned ? `Level ${shopInfo.level}` : "Locked"}
                              </p>
                            </div>
                          </div>

                          <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
                            <ShopStats
                              title={
                                shopInfo.owned
                                  ? `Current · LV ${shopInfo.level}`
                                  : "Current · Not installed"
                              }
                              rows={shopInfo.current}
                              empty="Purchase the weapon to install it."
                              accent={shopAccent}
                            />
                            <ShopStats
                              title={
                                shopInfo.level >= MAX_WEAPON_LEVEL
                                  ? "Maximum specification"
                                  : shopInfo.owned
                                    ? `After upgrade · LV ${shopInfo.level + 1}`
                                    : "After purchase · LV 1"
                              }
                              rows={
                                shopInfo.level >= MAX_WEAPON_LEVEL
                                  ? shopInfo.current
                                  : shopInfo.next
                              }
                              empty="Maximum level reached."
                              accent={shopAccent}
                              compare={shopInfo.current}
                            />
                          </div>

                          <div className="mt-4 border-t border-steel/30 pt-4">
                            <p className="text-[10px] leading-relaxed text-amber/45">
                              {shopDef.perLevel}
                            </p>
                            <button
                              disabled={shopInfo.price == null || hud.credits < shopInfo.price}
                              onClick={() => {
                                const g = gameRef.current;
                                if (!g || !g.buyWeapon(shopWeapon)) return;
                                setHud(g.snapshot());
                                forceTick((v) => v + 1);
                              }}
                              className={`mt-3 w-full border px-5 py-3 text-[10px] font-semibold uppercase tracking-[0.26em] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ice ${
                                shopInfo.price != null && hud.credits >= shopInfo.price
                                  ? "border-ice bg-ice text-void hover:bg-ice/85"
                                  : "cursor-not-allowed border-steel/30 text-amber/25"
                              }`}
                            >
                              {shopInfo.price == null
                                ? "Maximum Level Installed"
                                : `${shopInfo.owned ? `Upgrade to LV ${shopInfo.level + 1}` : "Purchase Weapon"} · ${shopInfo.price} CR`}
                            </button>
                          </div>
                        </motion.div>
                      </div>
                    ) : droneInfo ? (
                      <SalvageShopPanel
                        info={droneInfo}
                        credits={hud.credits}
                        onBuy={(id: SalvageUpgradeId | "base") => {
                          const g = gameRef.current;
                          if (!g) return;
                          const purchased =
                            id === "base" ? g.buySalvageDrone() : g.buySalvageUpgrade(id);
                          if (purchased) {
                            setHud(g.snapshot());
                            forceTick((v) => v + 1);
                          }
                        }}
                        onEquip={(id) => {
                          const g = gameRef.current;
                          if (!g) return;
                          if (g.equipSalvageWeapon(id)) {
                            setHud(g.snapshot());
                            forceTick((v) => v + 1);
                          }
                        }}
                      />
                    ) : null}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {devOpen && devUnlocked && (
              <motion.div
                initial={{ opacity: 0, x: 18 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ type: "spring", stiffness: 300, damping: 28 }}
                className="thin-scroll absolute right-2 top-2 z-50 max-h-[calc(100%-1rem)] w-[276px] overflow-y-auto border border-magenta/60 bg-black/88 p-3 backdrop-blur-sm"
              >
                <div className="flex items-center justify-between border-b border-steel/30 pb-2">
                  <p className="legend text-magenta">
                    Dev Console · P{devPage} · Press ` to Toggle
                  </p>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => {
                        setDevPage((p) => (p === 1 ? 2 : 1));
                        audio.play("ui");
                      }}
                      aria-label="Switch developer console page"
                      className="border border-steel/50 px-2 py-0.5 text-[10px] text-amber/70 transition-colors hover:border-magenta hover:text-magenta focus:outline-none focus-visible:ring-2 focus-visible:ring-magenta"
                    >
                      {devPage === 1 ? "P2 →" : "← P1"}
                    </button>
                    <button
                      onClick={() => setDevOpen(false)}
                      aria-label="Close developer console"
                      className="border border-steel/50 px-2 py-0.5 text-[10px] text-amber/70 transition-colors hover:border-magenta hover:text-magenta focus:outline-none focus-visible:ring-2 focus-visible:ring-magenta"
                    >
                      X
                    </button>
                  </div>
                </div>
                <div className={`mt-2.5 space-y-2.5 ${devPage === 1 ? "" : "hidden"}`}>
                  <DevRow label="Score">
                    <DevBtn
                      label="-1k"
                      onClick={() =>
                        dev((x) => {
                          x.score = Math.max(0, x.score - 1000);
                        })
                      }
                    />
                    <DevBtn
                      label="+1k"
                      onClick={() =>
                        dev((x) => {
                          x.score += 1000;
                        })
                      }
                    />
                    <DevBtn
                      label="+10k"
                      onClick={() =>
                        dev((x) => {
                          x.score += 10000;
                        })
                      }
                    />
                  </DevRow>
                  <DevRow label="Credits">
                    <DevBtn
                      label="-100"
                      onClick={() =>
                        dev((x) => {
                          x.credits = Math.max(0, x.credits - 100);
                        })
                      }
                    />
                    <DevBtn
                      label="+100"
                      onClick={() =>
                        dev((x) => {
                          x.credits += 100;
                        })
                      }
                    />
                    <DevBtn
                      label="+1k"
                      onClick={() =>
                        dev((x) => {
                          x.credits += 1000;
                        })
                      }
                    />
                  </DevRow>
                  <DevRow label="Hull">
                    <DevBtn
                      label="-25"
                      onClick={() =>
                        dev((x) => {
                          x.p.hull = Math.max(1, x.p.hull - 25);
                        })
                      }
                    />
                    <DevBtn
                      label="+25"
                      onClick={() =>
                        dev((x) => {
                          x.p.hull = Math.min(x.p.maxHull, x.p.hull + 25);
                        })
                      }
                    />
                    <DevBtn
                      label="Max"
                      onClick={() =>
                        dev((x) => {
                          x.p.hull = x.p.maxHull;
                        })
                      }
                    />
                  </DevRow>
                  <DevRow label="Kill All">
                    <DevBtn
                      label="Clear Field"
                      onClick={() =>
                        devPlaying((x) => {
                          x.clearAllArt();
                        })
                      }
                    />
                    <DevBtn
                      label="Boss"
                      active={!!gameRef.current?.boss}
                      onClick={() =>
                        devPlaying((x) => {
                          if (x.boss) x.killBoss();
                        })
                      }
                    />
                  </DevRow>
                  <DevRow label="Wave">
                    <DevBtn
                      label="Next"
                      onClick={() =>
                        devPlaying((x) => {
                          x.rocks = [];
                          x.drones = [];
                          x.boss = null;
                          x.nextWave();
                        })
                      }
                    />
                    <DevBtn
                      label="+5"
                      onClick={() =>
                        devPlaying((x) => {
                          x.rocks = [];
                          x.drones = [];
                          x.boss = null;
                          x.wave += 4;
                          x.nextWave();
                        })
                      }
                    />
                  </DevRow>
                  <DevRow label="Boss">
                    {[1, 2, 3, 4, 5, 6].map((mk) => (
                      <DevBtn
                        key={mk}
                        label={mk === 5 ? "MK5" : `MK${mk}`}
                        active={
                          !!gameRef.current?.boss &&
                          gameRef.current.boss.suffix.startsWith(`MK${mk}`)
                        }
                        onClick={() =>
                          devPlaying((x) => {
                            x.boss = x.makeBoss(mk === 5, mk);
                            x.banner = x.boss.name + " " + x.boss.suffix.split(" ")[0];
                            x.bannerSub = "DEV SUMMON";
                            x.bannerT = 2;
                            audio.play("bossCharge");
                          })
                        }
                      />
                    ))}
                  </DevRow>
                  <DevRow label="Mob">
                    <DevBtn
                      label="Norm"
                      onClick={() => devPlaying((x) => x.devSpawnRock(2, "none"))}
                    />
                    <DevBtn
                      label="Homer"
                      onClick={() => devPlaying((x) => x.devSpawnRock(2, "homing"))}
                    />
                    <DevBtn
                      label="Bounce"
                      onClick={() => devPlaying((x) => x.devSpawnRock(2, "bounce"))}
                    />
                    <DevBtn
                      label="Boom"
                      onClick={() => devPlaying((x) => x.devSpawnRock(2, "boom"))}
                    />
                    <DevBtn
                      label="Fast"
                      onClick={() => devPlaying((x) => x.devSpawnRock(2, "fast"))}
                    />
                    <DevBtn
                      label="Sentinel"
                      onClick={() => devPlaying((x) => x.devSpawnMob("sentinel"))}
                    />
                    <DevBtn
                      label="Warden"
                      onClick={() => devPlaying((x) => x.devSpawnMob("warden"))}
                    />
                  </DevRow>
                  <DevRow label="Shower">
                    <DevBtn
                      label={gameRef.current?.shower.active ? "Running" : "Start"}
                      active={!!gameRef.current?.shower.active}
                      onClick={() =>
                        devPlaying((x) => {
                          if (!x.shower.active) x.startShower();
                        })
                      }
                    />
                    <DevBtn
                      label="Long"
                      onClick={() =>
                        devPlaying((x) => {
                          x.startShower(14);
                        })
                      }
                    />
                    <DevBtn
                      label="Stop"
                      onClick={() =>
                        devPlaying((x) => {
                          x.shower.t = 0;
                          x.shower.active = false;
                        })
                      }
                    />
                  </DevRow>
                  <DevRow label="Meteorite">
                    <DevBtn label="×1" onClick={() => devPlaying((x) => x.devSpawnMeteorites(1))} />
                    <DevBtn label="×6" onClick={() => devPlaying((x) => x.devSpawnMeteorites(6))} />
                    <DevBtn
                      label="×15"
                      onClick={() => devPlaying((x) => x.devSpawnMeteorites(15))}
                    />
                    <DevBtn
                      label="Meteor"
                      onClick={() => devPlaying((x) => x.spawnMeteor(Math.random() < 0.5 ? -1 : 1))}
                    />
                  </DevRow>
                </div>

                <div className={`mt-2.5 space-y-2.5 ${devPage === 2 ? "" : "hidden"}`}>
                  <DevRow label="Max All">
                    <DevBtn
                      label="God Build"
                      onClick={() =>
                        dev((x) => {
                          // full unlock: arsenal, drone, survivability and economy
                          for (const w of WEAPON_ORDER) x.p.weapons[w] = MAX_WEAPON_LEVEL;
                          x.devSetAllStacks(999);
                          for (const id of DRONE_UPGRADE_IDS) x.devSetSalvageUpgrade(id, 9);
                          x.buySalvageDrone();
                          x.salvageDrone.purchased = true;
                          x.salvageDrone.active = true;
                          x.devSetSalvageHp(9999);
                          x.p.maxHull = Math.max(x.p.maxHull, 500);
                          x.p.hull = x.p.maxHull;
                          x.p.missiles = x.p.maxMissiles;
                          x.credits = 999999;
                          x.score = Math.max(x.score, 999999);
                          x.floatText(x.p.x, x.p.y - 40, "MAX LOADOUT", "#ff3d6e", 16);
                          audio.play("levelup");
                        })
                      }
                    />
                  </DevRow>
                  <DevStatUpgrades game={gameRef.current} onEdit={devStat} />
                  <DevRow label="Level">
                    <DevBtn
                      label="+1"
                      onClick={() =>
                        devPlaying((x) => {
                          x.gainXp(x.xpNext);
                        })
                      }
                    />
                    <DevBtn
                      label="+5"
                      onClick={() =>
                        devPlaying((x) => {
                          x.gainXp(x.xpNext * 5);
                        })
                      }
                    />
                  </DevRow>
                  <DevRow label="Weapon">
                    {WEAPON_ORDER.map((w) => (
                      <DevBtn
                        key={w}
                        label={WEAPON_DEFS[w].short.slice(0, 4)}
                        active={hud.primary === w}
                        onClick={() =>
                          dev((x) => {
                            if (x.p.weapons[w] <= 0) x.p.weapons[w] = 1;
                            x.p.primary = w;
                            x.p.heat = 0;
                            x.p.beamOn = false;
                          })
                        }
                      />
                    ))}
                  </DevRow>
                  <DevRow label="Wpn Lvl">
                    <DevBtn
                      label="+1"
                      onClick={() =>
                        dev((x) => {
                          const w = x.p.primary;
                          x.p.weapons[w] = Math.min(MAX_WEAPON_LEVEL, x.p.weapons[w] + 1);
                        })
                      }
                    />
                    <DevBtn
                      label="Max"
                      onClick={() =>
                        dev((x) => {
                          x.p.weapons[x.p.primary] = MAX_WEAPON_LEVEL;
                        })
                      }
                    />
                    <DevBtn
                      label="All"
                      onClick={() =>
                        dev((x) => {
                          for (const w of WEAPON_ORDER)
                            x.p.weapons[w] = Math.max(1, x.p.weapons[w]);
                        })
                      }
                    />
                  </DevRow>
                  <DevRow label="Drone">
                    <DevBtn
                      label="Buy"
                      onClick={() =>
                        dev((x) => {
                          x.buySalvageDrone();
                        })
                      }
                    />
                    <DevBtn label="1x" onClick={() => dev((x) => x.devSpawnSalvage(1))} />
                    <DevBtn label="2x" onClick={() => dev((x) => x.devSpawnSalvage(2))} />
                    <DevBtn label="3x" onClick={() => dev((x) => x.devSpawnSalvage(3))} />
                    <DevBtn label="HP 1" onClick={() => dev((x) => x.devSetSalvageHp(1))} />
                    <DevBtn label="HP Max" onClick={() => dev((x) => x.devSetSalvageHp(999))} />
                  </DevRow>
                  <DevRow label="D Lv">
                    {DRONE_UPGRADE_IDS.map((id) => (
                      <DevBtn
                        key={id}
                        label={
                          id === "twinCannons"
                            ? "TC+"
                            : id === "overcharge"
                              ? "OC+"
                              : id === "piercing"
                                ? "PR+"
                                : id === "repairPulse"
                                  ? "RP+"
                                  : id.slice(0, 2).toUpperCase() + "+"
                        }
                        onClick={() =>
                          dev((x) => x.devSetSalvageUpgrade(id, x.salvageDrone.upgrades[id] + 1))
                        }
                      />
                    ))}
                  </DevRow>
                  <DevRow label="D Build">
                    <DevBtn
                      label="Max"
                      onClick={() =>
                        dev((x) => {
                          for (const id of DRONE_UPGRADE_IDS) x.devSetSalvageUpgrade(id, 9);
                        })
                      }
                    />
                    <DevBtn
                      label="Reset"
                      onClick={() =>
                        dev((x) => {
                          for (const id of DRONE_UPGRADE_IDS) x.devSetSalvageUpgrade(id, 0);
                        })
                      }
                    />
                    <DevBtn label="Die" onClick={() => dev((x) => x.damageSalvageDrone(9999))} />
                  </DevRow>
                  <DevRow label="D Wpn">
                    <DevBtn
                      label="Base"
                      active={gameRef.current?.salvageDrone.weapon == null}
                      onClick={() => dev((x) => x.devEquipSalvageWeapon(null))}
                    />
                    {WEAPON_ORDER.map((w) => (
                      <DevBtn
                        key={w}
                        label={WEAPON_DEFS[w].short.slice(0, 3)}
                        active={gameRef.current?.salvageDrone.weapon === w}
                        onClick={() => dev((x) => x.devEquipSalvageWeapon(w))}
                      />
                    ))}
                  </DevRow>
                  <DevRow label="Misc">
                    <DevBtn
                      label="Missiles"
                      onClick={() =>
                        dev((x) => {
                          x.p.missiles = x.p.maxMissiles;
                        })
                      }
                    />
                    <DevBtn
                      label="God"
                      active={!!gameRef.current?.god}
                      onClick={() =>
                        dev((x) => {
                          x.god = !x.god;
                        })
                      }
                    />
                    <DevBtn label="Restart" onClick={start} />
                  </DevRow>
                </div>
              </motion.div>
            )}

            {/* In-play hotbar: every installed weapon and its actual level. */}
            {mode === "playing" && (
              <div className="absolute inset-x-0 bottom-2 z-30 flex justify-center px-2">
                <div className="thin-scroll flex max-w-full gap-1 overflow-x-auto border border-steel/45 bg-void/82 p-1 backdrop-blur-sm">
                  {hud.owned.map((o) => {
                    const idx = WEAPON_ORDER.indexOf(o.id) + 1;
                    const active = o.id === hud.primary;
                    return (
                      <button
                        key={o.id}
                        onClick={() => gameRef.current?.selectWeapon(o.id)}
                        className={`min-w-[76px] border px-2 py-1.5 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-amber ${
                          active
                            ? "border-amber bg-amber/15"
                            : "border-steel/35 hover:border-amber/50 hover:bg-amber/5"
                        }`}
                      >
                        <span className="flex items-center justify-between gap-2">
                          <span className="legend text-amber/40">{idx}</span>
                          <span
                            className={`text-[9px] uppercase tracking-[0.12em] ${active ? "text-amber-hot" : "text-amber/65"}`}
                          >
                            LV {o.level}
                          </span>
                        </span>
                        <span className="mt-0.5 block truncate text-[9px] font-semibold uppercase tracking-[0.1em] text-amber-hot">
                          {WEAPON_DEFS[o.id].short}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* bottom status deck */}
          <div className="grid shrink-0 grid-cols-2 gap-x-6 gap-y-3 border-t border-steel/25 px-3 py-3 sm:grid-cols-4 sm:px-5">
            <div>
              <div className="mb-1 flex items-baseline justify-between">
                <p className="legend">Hull</p>
                <p className="text-[11px] text-amber-hot">
                  {hud.hull}/{hud.maxHull}
                </p>
              </div>
              <Meter
                value={hud.hull}
                max={hud.maxHull}
                color="linear-gradient(90deg,#ff8a3a,#ffe0a3)"
                glow="rgba(255,176,58,.5)"
              />
            </div>
            <div>
              <div className="mb-1 flex items-baseline justify-between">
                <p className="legend">Sector</p>
                <p className="text-[11px] text-amber-hot">
                  {SECTORS[hud.sector].numeral} · {SECTORS[hud.sector].name}
                </p>
              </div>
              <div className="flex h-[6px] w-full items-center gap-1">
                {SECTORS.slice(0, 5).map((s, i) => (
                  <div
                    key={s.numeral}
                    className="h-full flex-1 transition-colors duration-500"
                    style={{
                      background:
                        i < hud.sector
                          ? "rgba(111,231,255,0.35)"
                          : i === hud.sector
                            ? "#6fe7ff"
                            : "rgba(58,63,85,0.35)",
                      boxShadow: i === hud.sector ? "0 0 10px rgba(111,231,255,.6)" : "none",
                    }}
                  />
                ))}
              </div>
            </div>
            <div>
              <div className="mb-1 flex items-baseline justify-between">
                <p className="legend">Missiles</p>
                <p className="text-[11px] text-magenta">
                  {hud.missiles}/{hud.maxMissiles}
                </p>
              </div>
              <div className="flex h-[6px] w-full items-center gap-1">
                {Array.from({ length: Math.max(1, hud.maxMissiles) }).map((_, i) => {
                  const loaded = i < hud.missiles,
                    reloading = i === hud.missiles;
                  return (
                    <div key={i} className="h-full flex-1 bg-steel/35">
                      <div
                        className="h-full transition-[width] duration-150"
                        style={{
                          width: loaded ? "100%" : reloading ? `${hud.missileCharge * 100}%` : "0%",
                          background: loaded ? "#ff3d6e" : "rgba(255,61,110,0.55)",
                          boxShadow: loaded ? "0 0 10px rgba(255,61,110,.55)" : "none",
                        }}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
            <div>
              <div className="mb-1 flex items-baseline justify-between">
                <p className="legend">Weapon</p>
                <button
                  onClick={cycleWeapon}
                  className="text-[11px] text-amber-hot transition-colors hover:text-amber focus:outline-none focus-visible:ring-2 focus-visible:ring-amber"
                  aria-label="Cycle weapon"
                >
                  {curWeapon.short} · LV {hud.weaponLevel}{" "}
                  {hud.owned.length > 1 && <span className="text-amber/45">⇄</span>}
                </button>
              </div>
              {hud.primary === "laser" ? (
                <Meter
                  value={hud.heat * 100}
                  max={100}
                  color={
                    hud.heat > 0.85
                      ? "linear-gradient(90deg,#a8233f,#ff3d6e)"
                      : "linear-gradient(90deg,#2f8fa8,#6fe7ff)"
                  }
                  glow={hud.heat > 0.85 ? "rgba(255,61,110,.6)" : "rgba(111,231,255,.5)"}
                />
              ) : (
                <div className="flex h-[6px] w-full items-center gap-1">
                  {Array.from({ length: MAX_WEAPON_LEVEL }).map((_, i) => (
                    <div
                      key={i}
                      className="h-full flex-1"
                      style={{
                        background: i < hud.weaponLevel ? "#ffb03a" : "rgba(58,63,85,0.35)",
                        boxShadow: i < hud.weaponLevel ? "0 0 8px rgba(255,176,58,.5)" : "none",
                      }}
                    />
                  ))}
                </div>
              )}
              <p className="mt-1.5 truncate text-[10px] uppercase tracking-[0.18em] text-amber/50">
                {hud.owned.map((o) => `${WEAPON_DEFS[o.id].short} ${o.level}`).join(" · ")}
              </p>
            </div>
          </div>

          <div className="h-[3px] w-full shrink-0 bg-steel/25">
            <div
              className="h-full bg-amber transition-[width] duration-300"
              style={{
                width: `${Math.min(100, (hud.xp / hud.xpNext) * 100)}%`,
                boxShadow: "0 0 14px rgba(255,176,58,.8)",
              }}
            />
          </div>
          <div className="flex shrink-0 items-center justify-between px-3 py-2 sm:px-5">
            <p className="legend">
              Level {String(hud.level).padStart(2, "0")} · {Math.floor((hud.xp / hud.xpNext) * 100)}
              % to next upgrade
            </p>
            <p className="legend hidden sm:block">
              Sector {String(hud.wave).padStart(2, "0")} · Salvage {hud.credits} CR
            </p>
          </div>

          {/* touch controls */}
          <div className="flex shrink-0 items-center justify-between gap-3 px-3 pb-4 sm:hidden">
            <button
              onClick={cycleWeapon}
              className="flex-1 border border-amber/50 py-4 text-[10px] uppercase tracking-[0.22em] text-amber active:bg-amber/20"
            >
              Weapon
            </button>
            <button
              onPointerDown={() => {
                if (gameRef.current) gameRef.current.keys["e"] = true;
              }}
              onPointerUp={() => {
                if (gameRef.current) gameRef.current.keys["e"] = false;
              }}
              onPointerLeave={() => {
                if (gameRef.current) gameRef.current.keys["e"] = false;
              }}
              className="flex-1 border border-magenta/50 py-4 text-[10px] uppercase tracking-[0.22em] text-magenta active:bg-magenta/20"
            >
              Missile
            </button>
            <button
              onClick={pause}
              className="flex-1 border border-steel/50 py-4 text-[10px] uppercase tracking-[0.22em] text-amber/70 active:bg-amber/10"
            >
              {mode === "paused" ? "Resume" : "Pause"}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------ bits */

function ScoreList({ scores }: { scores: ScoreEntry[] }) {
  return (
    <ol className="mt-5 space-y-1">
      {scores.slice(0, 5).map((s, i) => (
        <li
          key={i}
          className="flex items-baseline justify-between border-b border-steel/20 pb-1 text-[11px]"
        >
          <span className="legend text-amber/45">{String(i + 1).padStart(2, "0")}</span>
          <span className="flex-1 px-3 text-amber/45">{s.date}</span>
          <span className="text-amber/60">wave {String(s.wave).padStart(2, "0")}</span>
          <span className="w-24 text-right text-amber-hot">{String(s.score).padStart(6, "0")}</span>
        </li>
      ))}
    </ol>
  );
}

function SettingRow({
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
        aria-pressed={on}
        className={`w-16 shrink-0 border px-2 py-1.5 text-[10px] uppercase tracking-[0.22em] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-amber ${on ? "border-amber bg-amber/15 text-amber" : "border-steel/50 text-amber/40 hover:border-amber/60"}`}
      >
        {on ? "On" : "Off"}
      </button>
    </div>
  );
}

function SalvageShopPanel({
  info,
  credits,
  onBuy,
  onEquip,
}: {
  info: SalvageShopInfo;
  credits: number;
  onBuy: (id: SalvageUpgradeId | "base") => void;
  onEquip: (id: WeaponId | null) => void;
}) {
  const paths: {
    id: "offense" | "support" | "utility";
    label: string;
    accent: string;
    note: string;
  }[] = [
    {
      id: "offense",
      label: "Offense Path",
      accent: "#ff3d6e",
      note: "Weak support fire that compounds into a glass-cannon identity.",
    },
    {
      id: "support",
      label: "Defense / Support Path",
      accent: "#6fe7ff",
      note: "Keep the companion alive and let it slowly stabilize the ship.",
    },
    {
      id: "utility",
      label: "Utility Path",
      accent: "#ffb03a",
      note: "Turn the drone into a wider, faster salvage partner.",
    },
  ];
  return (
    <div className="p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-steel/30 pb-4">
        <div>
          <p className="legend text-ice">Permanent chassis · build persists through destruction</p>
          <h4 className="mt-1 font-display text-[clamp(1.35rem,4vw,2rem)] leading-none text-amber-hot">
            SALVAGE DRONE
          </h4>
          <p className="mt-2 max-w-xl text-[11px] leading-relaxed text-amber/58">
            A deliberately undertuned companion. It follows with lag, collects credit shards and
            becomes useful only through the path you choose. Weapons are shared from your armory,
            but the ship's currently active weapon cannot be mounted here.
          </p>
        </div>
        <div className="text-right">
          <p className="legend">Chassis</p>
          <p
            className={`mt-1 text-[11px] uppercase tracking-[0.16em] ${info.purchased ? (info.active ? "text-ice" : "text-magenta") : "text-amber/45"}`}
          >
            {info.purchased
              ? info.active
                ? "Online"
                : info.rebuilding > 0
                  ? `Rebuilding ${info.rebuilding.toFixed(1)}`
                  : "Offline · Next wave rebuild"
              : "Not assembled"}
          </p>
          {info.purchased && (
            <p className="mt-1 text-[10px] text-amber/55">
              Hull {info.hp}/{info.maxHp}
            </p>
          )}
        </div>
      </div>

      {!info.purchased ? (
        <div className="mt-5 border border-ice/30 bg-ice/[0.04] p-4">
          <p className="legend text-ice">Base chassis · one-time purchase</p>
          <p className="mt-2 text-[11px] leading-relaxed text-amber/55">
            The base frame has no weapons and a small hull. Buy it once, then shape it across the
            three paths below. If it is destroyed, it rebuilds for free at the next wave.
          </p>
          <button
            disabled={credits < info.basePrice}
            onClick={() => onBuy("base")}
            className={`mt-4 w-full border px-5 py-3 text-[10px] font-semibold uppercase tracking-[0.24em] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ice ${credits >= info.basePrice ? "border-ice bg-ice text-void hover:bg-ice/85" : "cursor-not-allowed border-steel/30 text-amber/25"}`}
          >
            Deploy Salvage Drone · {info.basePrice} CR
          </button>
        </div>
      ) : (
        <div className="mt-5 grid gap-5">
          <div className="border border-ice/30 bg-ice/[0.04] p-3">
            <div className="flex items-baseline justify-between gap-3">
              <p className="legend text-ice">Drone hardpoint</p>
              <p className="text-[10px] text-amber/40">
                {info.weapon
                  ? `Mounted · ${WEAPON_DEFS[info.weapon].name}`
                  : "Level-0 cannon mounted"}
              </p>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <button
                onClick={() => onEquip(null)}
                className={`border px-2 py-2 text-[9px] uppercase tracking-[0.12em] transition-colors ${info.weapon == null ? "border-ice bg-ice/10 text-ice" : "border-steel/40 text-amber/55 hover:border-ice"}`}
              >
                Base Cannon
              </button>
              {info.weaponOptions
                .filter((o) => o.owned)
                .map((o) => {
                  const unavailable = o.equippedByPlayer;
                  const active = info.weapon === o.id;
                  return (
                    <button
                      key={o.id}
                      disabled={unavailable}
                      onClick={() => onEquip(o.id)}
                      title={
                        unavailable ? "Currently equipped by the player" : "Mount on salvage drone"
                      }
                      className={`border px-2 py-2 text-[9px] uppercase tracking-[0.12em] transition-colors ${active ? "border-ice bg-ice/10 text-ice" : unavailable ? "cursor-not-allowed border-steel/20 text-amber/20 line-through" : "border-steel/40 text-amber/65 hover:border-ice"}`}
                    >
                      {WEAPON_DEFS[o.id].short} · LV {o.level}
                    </button>
                  );
                })}
            </div>
          </div>
          {paths.map((path) => (
            <div key={path.id}>
              <div className="flex items-baseline justify-between gap-3">
                <p className="legend" style={{ color: path.accent }}>
                  {path.label}
                </p>
                <p className="text-[10px] text-amber/35">{path.note}</p>
              </div>
              <div className="mt-2 grid gap-2 sm:grid-cols-3">
                {info.upgrades
                  .filter((u) => u.path === path.id)
                  .map((u) => {
                    const canBuy = u.price != null && credits >= u.price;
                    return (
                      <button
                        key={u.id}
                        disabled={!canBuy}
                        onClick={() => onBuy(u.id)}
                        className={`border p-3 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ice ${canBuy ? "border-steel/55 hover:border-ice hover:bg-ice/[0.06]" : "cursor-not-allowed border-steel/25 opacity-55"}`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-amber-hot">
                            {u.name}
                          </span>
                          <span
                            className="text-[9px] uppercase tracking-[0.12em]"
                            style={{ color: path.accent }}
                          >
                            {u.level}/{u.max}
                          </span>
                        </div>
                        <p className="mt-2 text-[10px] leading-relaxed text-amber/48">{u.desc}</p>
                        <div className="mt-3 flex items-center justify-between gap-2">
                          <LevelPips level={u.level} max={u.max} color={path.accent} />
                          <span className="text-[9px] uppercase tracking-[0.13em] text-amber/60">
                            {u.price == null ? "MAX" : `${u.price} CR`}
                          </span>
                        </div>
                      </button>
                    );
                  })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ShopStats({
  title,
  rows,
  empty,
  accent,
  compare = [],
}: {
  title: string;
  rows: WeaponStatRow[];
  empty: string;
  accent: string;
  compare?: WeaponStatRow[];
}) {
  const before = new Map(compare.map((r) => [r.label, r.value]));
  return (
    <div className="border border-steel/35 bg-black/20 p-3">
      <p className="legend" style={{ color: accent }}>
        {title}
      </p>
      {rows.length ? (
        <dl className="mt-2 space-y-1.5">
          {rows.map((row) => {
            const old = before.get(row.label);
            const changed = old != null && old !== row.value;
            return (
              <div
                key={row.label}
                className="flex items-baseline justify-between gap-3 border-b border-steel/20 pb-1 text-[10px]"
              >
                <dt className="uppercase tracking-[0.12em] text-amber/42">{row.label}</dt>
                <dd className="text-right">
                  {changed && <span className="mr-2 text-amber/30 line-through">{old}</span>}
                  <span style={{ color: changed ? accent : "rgba(255,224,163,0.9)" }}>
                    {row.value}
                  </span>
                </dd>
              </div>
            );
          })}
        </dl>
      ) : (
        <p className="mt-3 text-[10px] leading-relaxed text-amber/35">{empty}</p>
      )}
    </div>
  );
}

/**
 * Dev-only picker: choose exactly which stat upgrades are unlocked and how many
 * times each one is stacked. Counts are read live from the engine and every edit
 * rebuilds the derived stats, so the numbers always match what the ship has.
 */
function DevStatUpgrades({
  game,
  onEdit,
}: {
  game: Game | null;
  onEdit: (fn: (g: Game) => void) => void;
}) {
  return (
    <div className="space-y-1 border-t border-steel/25 pt-2">
      <div className="flex items-center justify-between gap-1">
        <span className="legend text-amber/50">Stat Upgrades</span>
        <span className="flex gap-1">
          <DevBtn
            label="+1 All"
            onClick={() =>
              onEdit((g) => {
                for (const u of STAT_UPGRADES) g.devSetStack(u.id, (g.stacks[u.id] ?? 0) + 1);
              })
            }
          />
          <DevBtn label="Max" onClick={() => onEdit((g) => g.devSetAllStacks(999))} />
          <DevBtn label="Zero" onClick={() => onEdit((g) => g.devSetAllStacks(0))} />
        </span>
      </div>
      {STAT_UPGRADES.map((u) => {
        const level = game?.stacks[u.id] ?? 0;
        const capped = level >= u.max;
        return (
          <div key={u.id} className="flex items-center gap-1">
            <span
              title={`${u.desc} (max ${u.max})`}
              className="min-w-0 flex-1 truncate text-[9px] uppercase tracking-[0.06em] text-amber/65"
            >
              {u.name}
            </span>
            <span
              className={`w-9 shrink-0 text-right text-[9px] ${level > 0 ? "text-amber-hot" : "text-amber/30"}`}
            >
              {level}/{u.max}
            </span>
            <DevBtn label="−" onClick={() => onEdit((g) => g.devSetStack(u.id, level - 1))} />
            <DevBtn
              label="+"
              disabled={capped}
              onClick={() => onEdit((g) => g.devSetStack(u.id, level + 1))}
            />
            <DevBtn
              label="M"
              active={capped}
              onClick={() => onEdit((g) => g.devSetStack(u.id, u.max))}
            />
          </div>
        );
      })}
    </div>
  );
}

function DevRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-1.5">
      <span className="legend mt-1 w-[54px] shrink-0 text-amber/45">{label}</span>
      <div className="flex flex-wrap justify-end gap-1">{children}</div>
    </div>
  );
}

function DevBtn({
  label,
  onClick,
  active,
  disabled,
}: {
  label: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
}) {
  const tone = disabled
    ? "cursor-not-allowed border-steel/25 text-amber/25"
    : active
      ? "border-magenta bg-magenta/25 text-magenta"
      : "border-steel/50 text-amber/70 hover:border-amber hover:text-amber-hot";
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`border px-1.5 py-1 text-[9px] uppercase tracking-[0.12em] transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-magenta ${tone}`}
    >
      {label}
    </button>
  );
}

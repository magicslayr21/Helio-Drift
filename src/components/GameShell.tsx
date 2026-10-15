import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CampaignBanner } from "./CampaignBanner";
import {
  Game,
  loadScores,
  saveScore,
  WEAPON_ORDER,
  type Hud,
  type Mode,
  type ScoreEntry,
  type UpgradeCard,
  type SalvageUpgradeId,
} from "../game/engine";
import { PlayerStatus } from "./PlayerStatus";
import { FlightSettings } from "./FlightSettings";
import { UpgradeIcon, UpgradeOption } from "./UpgradeOption";
import { ShopScreen } from "./ShopScreen";
import { PauseMenu } from "./PauseMenu";
import { DeveloperConsole } from "./DeveloperConsole";
import { applyDeveloperCommand } from "../game/developer-command";
import { WeaponBar } from "./WeaponBar";
import { readFlightSettings } from "../game/preferences";
import { Leaderboard } from "./Leaderboard";
import {
  authenticateDeveloper,
  clearDeveloperSession,
  flushPendingRuns,
  isLeaderboardConfigured,
  queueRun,
} from "../leaderboard/client";
import { MainMenu } from "./MainMenu";
import { UpdateLog } from "./UpdateLog";
import { audio } from "../game/audio";
import { GAME_CONFIG } from "../game/game-config";
import nebulaImg from "../assets/nebula.jpg";

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

const APP_VERSION = __APP_VERSION__;

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

  const [settings, setSettings] = useState(readFlightSettings);
  const [panel, setPanel] = useState<"none" | "settings" | "code">("none");
  useEffect(() => {
    const sync = () => {
      setSettings(readFlightSettings());
      setMuted(audio.muted);
    };
    window.addEventListener("helios-settings-change", sync);
    return () => window.removeEventListener("helios-settings-change", sync);
  }, []);
  const [codeInput, setCodeInput] = useState("");
  const [codeError, setCodeError] = useState(false);
  const [, forceTick] = useState(0);
  const [shopOpen, setShopOpen] = useState(false);
  const shopReturnMode = useRef<Mode>("playing");
  const shopInputWasSuspended = useRef(false);
  const [devUnlocked, setDevUnlocked] = useState(false);
  const [devOpen, setDevOpen] = useState(false);
  const [leaderboardOpen, setLeaderboardOpen] = useState(false);
  const [updateLogOpen, setUpdateLogOpen] = useState(false);
  const [canContinue, setCanContinue] = useState(false);
  const continuingSavedRun = useRef(false);

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
      clearDeveloperSession();
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
      onRunReport: queueRun,
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
          if (!restoring && !continuingSavedRun.current) setScores(saveScore(entry));
        }
        if (m !== "paused" && m !== "menu") setPanel("none");
      },
    });
    gameRef.current = g;
    restoring = true;
    const restoredRun = g.restoreRun(true);
    setCanContinue(restoredRun);
    // Recover a checkpoint that may never have reached the server before closing.
    if (restoredRun) queueRun(g.leaderboardReport());
    restoring = false;
    // Low-frequency reporting is outside the canvas loop. Network failures never stop a run.
    const reportRun = () => {
      if (g.mode !== "menu") queueRun(g.leaderboardReport());
      void flushPendingRuns();
    };
    const reportTimer = window.setInterval(reportRun, 15000);
    const onVisibility = () => {
      if (document.hidden) reportRun();
    };
    const onPageShow = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      g.saveRun();
      setCanContinue(g.wave > 0 && g.p.hull > 0);
      g.setMode("menu");
    };
    window.addEventListener("pageshow", onPageShow);
    window.addEventListener("online", reportRun);
    window.addEventListener("pagehide", reportRun);
    document.addEventListener("visibilitychange", onVisibility);
    void flushPendingRuns();
    return () => {
      window.clearInterval(reportTimer);
      window.removeEventListener("pageshow", onPageShow);
      window.removeEventListener("online", reportRun);
      window.removeEventListener("pagehide", reportRun);
      document.removeEventListener("visibilitychange", onVisibility);
      reportRun();
      g.destroy();
      gameRef.current = null;
    };
  }, []);

  useEffect(() => {
    const g = gameRef.current;
    if (g) {
      g.settings.shipVisibility = settings.shipVisibility;
      g.settings.autoFire = settings.autoFire;
      g.settings.mouseControl = settings.mouseControl;
      g.settings.hybridAim = settings.hybridAim;
      g.settings.trackpad = settings.trackpad;
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

  const openLeaderboard = useCallback(() => {
    const game = gameRef.current;
    if (game) {
      game.inputSuspended = true;
      game.keys = {};
      game.touchFire = false;
      game.mouseDown = false;
      if (game.mode === "playing") game.setMode("paused");
      if (game.mode !== "menu") queueRun(game.leaderboardReport());
    }
    setLeaderboardOpen(true);
    audio.play("ui");
  }, []);
  const closeLeaderboard = useCallback(() => {
    setLeaderboardOpen(false);
    if (gameRef.current) gameRef.current.inputSuspended = false;
  }, []);
  const unlockLeaderboardDeveloper = useCallback(() => setDevUnlocked(true), []);

  const start = useCallback(() => {
    audio.unlock();
    setRun(null);
    setPanel("none");
    setCanContinue(false);
    gameRef.current?.startGame();
  }, []);
  const continueRun = useCallback(() => {
    audio.unlock();
    setPanel("none");
    continuingSavedRun.current = true;
    try {
      gameRef.current?.continueRun();
    } finally {
      continuingSavedRun.current = false;
    }
  }, []);
  const resume = useCallback(() => {
    audio.unlock();
    setPanel("none");
    gameRef.current?.setMode("playing");
  }, []);
  const returnToMenu = useCallback(() => {
    const game = gameRef.current;
    if (!game) return;
    if (game.saveRun() === false) {
      window.alert(
        "Your run could not be saved on this device. Check browser storage and any other open game tabs, then try Save & Return again. Your current run is still open.",
      );
      return;
    }
    queueRun(game.leaderboardReport());
    setCanContinue(game.wave > 0 && game.p.hull > 0);
    setPanel("none");
    game.setMode("menu");
  }, []);
  const pause = useCallback(() => {
    const g = gameRef.current;
    if (!g || g.inputSuspended) return;
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

  const cycleWeapon = useCallback(() => gameRef.current?.cycleWeapon(1), []);

  const openShop = useCallback(() => {
    const g = gameRef.current;
    if (
      !g ||
      g.inputSuspended ||
      g.mode === "menu" ||
      g.mode === "gameover" ||
      g.mode === "victory"
    )
      return;
    audio.play("ui");
    shopReturnMode.current = g.mode;
    shopInputWasSuspended.current = g.inputSuspended;
    g.inputSuspended = true;
    g.keys = {};
    g.mouseDown = g.touchFire = false;
    setDevOpen(false);
    setPanel("none");
    setShopOpen(true);
    if (g.mode !== "paused") g.setMode("paused");
  }, []);

  const closeShop = useCallback(() => {
    const g = gameRef.current;
    setShopOpen(false);
    if (g) g.inputSuspended = shopInputWasSuspended.current;
    if (g && shopReturnMode.current !== "paused") g.setMode(shopReturnMode.current);
  }, []);

  const closePanel = useCallback(() => {
    setPanel("none");
    setCodeInput("");
    setCodeError(false);
  }, []);
  const submitCode = useCallback(async () => {
    const code = codeInput.trim();
    const localCode = code.toLowerCase() === GAME_CONFIG.developer.accessCode.trim().toLowerCase();
    if (localCode) {
      setDevUnlocked(true);
      setDevOpen(true);
      closePanel();
      audio.play("levelup");
      if (isLeaderboardConfigured()) void authenticateDeveloper(code).catch(() => {});
      return;
    }
    try {
      await authenticateDeveloper(code);
      setDevUnlocked(true);
      setDevOpen(true);
      closePanel();
      audio.play("levelup");
    } catch {
      setCodeError(true);
      audio.play("overheat");
    }
  }, [codeInput, closePanel]);

  useEffect(() => {
    if (leaderboardOpen || updateLogOpen || (panel === "none" && !shopOpen)) return;
    const close = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      if (shopOpen) closeShop();
      else closePanel();
    };
    window.addEventListener("keydown", close, true);
    return () => window.removeEventListener("keydown", close, true);
  }, [panel, shopOpen, closePanel, closeShop, leaderboardOpen, updateLogOpen]);

  // backquote toggles the dev console — only once the service code has been entered
  useEffect(() => {
    if (!devUnlocked || leaderboardOpen || updateLogOpen) return;
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
  }, [devUnlocked, leaderboardOpen, updateLogOpen]);

  useEffect(() => {
    if (!updateLogOpen) return;
    const game = gameRef.current;
    if (!game) return;
    const suspended = game.inputSuspended;
    game.inputSuspended = true;
    game.keys = {};
    game.mouseDown = game.touchFire = false;
    if (game.mode === "playing") game.setMode("paused");
    return () => {
      game.inputSuspended = suspended;
    };
  }, [updateLogOpen]);

  const dev = useCallback((fn: (x: Game) => void) => {
    const x = gameRef.current;
    if (!x) return;
    x.markLeaderboardAssisted();
    fn(x);
    audio.play("ui");
  }, []);
  /** stat-stack edits must refresh the HUD, since stacks feed the boost ledger */
  const devStat = useCallback((fn: (x: Game) => void) => {
    const x = gameRef.current;
    if (!x) return;
    x.markLeaderboardAssisted();
    fn(x);
    setHud(x.snapshot());
    forceTick((v) => v + 1);
    audio.play("ui");
  }, []);

  const best = scores[0]?.score ?? 0;
  const shopWeapons =
    shopOpen && gameRef.current
      ? WEAPON_ORDER.map((id) => gameRef.current!.weaponShopInfo(id))
      : [];
  const droneInfo = shopOpen ? gameRef.current?.salvageShopInfo() : undefined;
  const refreshShop = () => {
    const game = gameRef.current;
    if (!game) return;
    game.saveRun();
    setHud(game.snapshot());
    forceTick((v) => v + 1);
  };

  return (
    <section className="relative h-dvh w-full overflow-y-auto overflow-x-hidden">
      {leaderboardOpen && (
        <Leaderboard
          onClose={closeLeaderboard}
          devUnlocked={devUnlocked}
          onDeveloperUnlock={unlockLeaderboardDeveloper}
        />
      )}
      <div className="relative flex h-full w-full gap-0">
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
          {/* top telemetry strip */}
          {mode !== "menu" && (
            <div
              inert={shopOpen}
              className="flex shrink-0 flex-wrap items-end justify-between gap-2 border-b border-steel/25 px-3 py-2 sm:px-5"
            >
              <div>
                <p className="legend">Score</p>
                <p className="font-display text-[clamp(1.6rem,4.2vw,2.6rem)] leading-none text-amber-hot">
                  {String(hud.score).padStart(6, "0")}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <div className="text-center">
                  <p className="legend">Wave</p>
                  <p className="font-display text-2xl leading-none text-amber">
                    {String(hud.wave).padStart(2, "0")}
                  </p>
                </div>
                <div className="w-24 sm:w-36" aria-label="Sector progress">
                  <p className="text-[10px] text-ice">
                    {SECTORS[hud.sector].numeral} · {SECTORS[hud.sector].name}
                  </p>
                  <div className="mt-1 flex h-1.5 gap-1">
                    {SECTORS.map((sector, i) => (
                      <span
                        key={sector.numeral}
                        className="flex-1"
                        style={{
                          background: i <= hud.sector ? "#6fe7ff" : "#3a3f55",
                          opacity: i === hud.sector ? 1 : 0.45,
                        }}
                      />
                    ))}
                  </div>
                </div>
              </div>
              <div className="flex items-end gap-2 sm:gap-5">
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
                  disabled={mode === "gameover" || mode === "victory"}
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
          )}
          {/* playfield */}
          <div className="scanlines vignette relative min-h-[320px] w-full flex-1 overflow-hidden border-x border-steel/20 bg-void">
            <span
              hidden={mode === "menu"}
              aria-label={`Game version ${APP_VERSION}`}
              className="pointer-events-none absolute bottom-2 left-2 z-10 border border-steel/30 bg-void/70 px-1.5 py-0.5 font-mono text-[9px] tracking-wider text-amber/45"
            >
              v{APP_VERSION || "local"}
            </span>
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
              className={`absolute inset-0 block h-full w-full touch-none select-none ${!settings.legacyMovement && (settings.mouseControl || settings.hybridAim || settings.trackpad) ? "cursor-crosshair" : ""}`}
              aria-label="Helios Drift playfield"
            />

            {mode !== "menu" && <PlayerStatus hud={hud} />}

            <CampaignBanner
              banner={hud.banner}
              subtitle={hud.bannerSub}
              visible={mode === "playing"}
            />

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
                  <MainMenu
                    hud={hud}
                    canContinue={canContinue}
                    version={APP_VERSION}
                    onContinue={continueRun}
                    onStart={start}
                    onLeaderboard={openLeaderboard}
                    leaderboardOpen={leaderboardOpen}
                    onSettings={() => {
                      audio.play("ui");
                      setPanel("settings");
                    }}
                    onDetails={openDetails}
                    onUpdateLog={() => setUpdateLogOpen(true)}
                  />
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
                  <PauseMenu
                    hud={hud}
                    onSelectWeapon={(id) => dev((x) => x.selectWeapon(id))}
                    onResume={resume}
                    onShop={openShop}
                    onSettings={() => {
                      audio.play("ui");
                      setPanel("settings");
                    }}
                    onDeveloper={() => {
                      audio.play("ui");
                      if (devUnlocked) setDevOpen((v) => !v);
                      else setPanel("code");
                    }}
                    onReturn={returnToMenu}
                    onLeaderboard={openLeaderboard}
                    devUnlocked={devUnlocked}
                    devOpen={devOpen}
                  />
                </motion.div>
              )}

              {mode === "levelup" && (
                <motion.div
                  key="levelup"
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="upgrade-title"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="upgrade-screen absolute inset-0 flex flex-col justify-center overflow-y-auto px-3 py-6 sm:px-8"
                >
                  <div className="upgrade-screen-inner">
                    <div className="upgrade-heading">
                      <div className="upgrade-reward-mark" aria-hidden="true">
                        <UpgradeIcon id="crit" />
                      </div>
                      <div>
                        <p className="legend text-amber">Level up · Choose your upgrade</p>
                        <h2
                          id="upgrade-title"
                          className="font-display text-[clamp(1.5rem,4.6vw,2.6rem)] leading-none text-amber-hot"
                        >
                          LEVEL {String(hud.level).padStart(2, "0")}
                        </h2>
                        <p className="upgrade-reward-note">Hull patched · Systems ready</p>
                      </div>
                      <div className="upgrade-credit hidden sm:block">
                        <p className="legend">Available Credits</p>
                        <p className="font-display text-2xl leading-none text-amber">
                          {hud.credits} CR
                        </p>
                      </div>
                    </div>
                    <div className="upgrade-choices">
                      {choices.map((card, i) => (
                        <UpgradeOption
                          key={card.id}
                          card={card}
                          index={i}
                          onChoose={() => gameRef.current?.chooseUpgrade(card.id)}
                        />
                      ))}
                    </div>
                    <div className="mt-5 border-t border-steel/30 pt-4">
                      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                        <p className="legend">Choose one system · Flight paused</p>
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
                        Install one upgrade to resume. Weapons are available in the shop.
                      </p>
                    </div>
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
                    <p className="legend text-magenta">Health Depleted · Signal Lost</p>
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
                          beams, crushing singularities, and explosive strikes await. Your health
                          and missiles are fully restored if you accept the challenge.
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
                  <div className="thin-scroll max-h-full w-[min(430px,90%)] overflow-y-auto border border-steel/50 plate p-6">
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
                    <button
                      onClick={() => {
                        setPanel("code");
                        setCodeInput("");
                        setCodeError(false);
                      }}
                      className="mt-2 w-full border border-steel/50 px-4 py-2 text-[10px] uppercase tracking-[0.18em] text-amber/70 hover:border-amber"
                    >
                      Developer Access
                    </button>
                    <FlightSettings settings={settings} onChange={setSettings} />
                    <button
                      onClick={() => setUpdateLogOpen(true)}
                      className="mt-5 w-full border border-ice/50 px-4 py-2.5 text-xs uppercase tracking-widest text-ice hover:bg-ice/10"
                    >
                      Update log · v{__APP_VERSION__}
                    </button>
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

              {updateLogOpen && <UpdateLog onClose={() => setUpdateLogOpen(false)} />}

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
              {shopOpen && droneInfo && shopWeapons.length > 0 && (
                <motion.div
                  key="weapon-shop"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.16 }}
                  className="campaign-shop-layer"
                >
                  <ShopScreen
                    credits={hud.credits}
                    weapons={shopWeapons}
                    drone={droneInfo}
                    activeWeapon={hud.primary}
                    onClose={closeShop}
                    onBuyWeapon={(id) => {
                      if (gameRef.current?.buyWeapon(id)) refreshShop();
                    }}
                    onBuyDrone={(id: SalvageUpgradeId | "base") => {
                      const game = gameRef.current;
                      if (
                        game &&
                        (id === "base" ? game.buySalvageDrone() : game.buySalvageUpgrade(id))
                      )
                        refreshShop();
                    }}
                    onEquipWeapon={(id) => {
                      gameRef.current?.selectWeapon(id);
                      refreshShop();
                    }}
                    onEquipDrone={(id) => {
                      if (gameRef.current?.equipSalvageWeapon(id)) refreshShop();
                    }}
                    notice="FLIGHT PAUSED · INSTALL YOUR NEXT ADVANTAGE"
                  />
                </motion.div>
              )}
            </AnimatePresence>

            {devOpen && devUnlocked && (
              <DeveloperConsole
                view={gameRef.current!}
                onClose={() => setDevOpen(false)}
                onRestart={start}
                send={(command) =>
                  devStat((g) => {
                    applyDeveloperCommand(g, command);
                  })
                }
              />
            )}
          </div>

          {mode !== "menu" && (
            <WeaponBar
              owned={hud.owned}
              active={hud.primary}
              blocked={gameRef.current?.salvageDrone.weapon}
              enabled={!shopOpen && (mode === "playing" || mode === "paused")}
              onSelect={(weapon) => {
                const game = gameRef.current;
                if (game) {
                  game.selectWeapon(weapon);
                  setHud(game.snapshot());
                }
              }}
            />
          )}
          {/* touch controls */}
          <div
            inert={shopOpen}
            className={`${mode === "menu" ? "hidden" : "flex"} shrink-0 items-center justify-between gap-3 px-3 pb-4 sm:hidden`}
          >
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

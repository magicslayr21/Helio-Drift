import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowRight, ChevronRight, Radio, RefreshCw } from "lucide-react";
import { HeliosMark } from "./Masthead";
import {
  getIdentity,
  getLeaderboard,
  isLeaderboardConfigured,
  setUsername,
} from "../leaderboard/client";
import type { LeaderboardPage } from "../leaderboard/types";
import type { Hud } from "../game/types";
import marqueeImg from "../assets/marquee.jpg";
import "./MainMenu.css";

export function MainMenu({
  hud,
  canContinue,
  version,
  onContinue,
  onStart,
  onLeaderboard,
  leaderboardOpen,
  onSettings,
  onDetails,
  onUpdateLog,
}: {
  hud: Hud;
  canContinue: boolean;
  version: string;
  onContinue: () => void;
  onStart: () => void;
  onLeaderboard: () => void;
  leaderboardOpen: boolean;
  onSettings: () => void;
  onDetails: () => void;
  onUpdateLog: () => void;
}) {
  const [confirmNew, setConfirmNew] = useState(false);
  const [callsign, setCallsign] = useState(getIdentity()?.username ?? "");
  const [saving, setSaving] = useState(false);
  const [profileMessage, setProfileMessage] = useState("");
  const [page, setPage] = useState<LeaderboardPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [boardError, setBoardError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const startButton = useRef<HTMLButtonElement>(null);
  const configured = isLeaderboardConfigured();

  useEffect(() => {
    if (!leaderboardOpen) setCallsign(getIdentity()?.username ?? "");
  }, [leaderboardOpen]);

  useEffect(() => {
    if (leaderboardOpen) return;
    const controller = new AbortController();
    let fetching = false;
    const load = async () => {
      if (fetching) return;
      fetching = true;
      setLoading(true);
      try {
        const result = await getLeaderboard(0, 5, controller.signal);
        if (!controller.signal.aborted) {
          setPage(result);
          setBoardError("");
        }
      } catch (error) {
        if (!controller.signal.aborted)
          setBoardError(error instanceof Error ? error.message : "Leaderboard unavailable.");
      } finally {
        fetching = false;
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    void load();
    const timer = window.setInterval(() => {
      if (!document.hidden) void load();
    }, 30_000);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [leaderboardOpen, refresh]);

  async function saveCallsign(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setProfileMessage("");
    try {
      const identity = await setUsername(callsign.trim());
      setCallsign(identity.username);
      setProfileMessage(`Callsign saved: ${identity.username}`);
      setRefresh((value) => value + 1);
    } catch (error) {
      setProfileMessage(error instanceof Error ? error.message : "Unable to save callsign.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="launch-menu thin-scroll"
      style={{
        backgroundImage: `linear-gradient(90deg,rgba(8,10,18,.98),rgba(8,10,18,.78)),url(${marqueeImg})`,
      }}
    >
      <div className="launch-masthead">
        <span>
          <HeliosMark size={25} /> HELIOS FLIGHT SYSTEMS
        </span>
        <button className="launch-version" onClick={onUpdateLog} aria-label="Open update log">
          v{version}
        </button>
      </div>
      <div className="launch-layout">
        <section className="launch-briefing" aria-label="Flight menu">
          <p className="launch-eyebrow">Independent pilot program / 079</p>
          <h1>
            HELIOS
            <br />
            <span>DRIFT</span>
          </h1>
          <p className="launch-intro">
            Into the belt. Against the odds.
            <br />
            Build your arsenal. Leave your callsign among the stars.
          </p>
          <div className="launch-save">
            <span className="launch-eyebrow">
              {canContinue ? "Flight recorder · saved run" : "Flight recorder · ready"}
            </span>
            <p>
              {canContinue
                ? `Wave ${hud.wave}  /  Level ${hud.level}  /  ${hud.score.toLocaleString()} points`
                : "Your next flight starts here."}
            </p>
          </div>
          <div className="launch-actions">
            <button className="launch-primary" disabled={!canContinue} onClick={onContinue}>
              Continue run <ArrowRight size={18} />
            </button>
            <button
              ref={startButton}
              className="launch-secondary"
              aria-expanded={confirmNew}
              onClick={() => (canContinue ? setConfirmNew(true) : onStart())}
            >
              Start new run <ChevronRight size={18} />
            </button>
          </div>
          {!canContinue && <p className="launch-hint">No saved run on this browser yet.</p>}
          {confirmNew && (
            <section className="launch-warning" role="alert" aria-label="Replace saved run">
              <strong>Replace your saved run?</strong>
              <p>
                Starting a new run permanently removes your previous saved progress. You cannot
                continue that run afterwards. Submitted leaderboard records remain.
              </p>
              <div>
                <button
                  autoFocus
                  onClick={() => {
                    setConfirmNew(false);
                    startButton.current?.focus();
                  }}
                >
                  Keep previous run
                </button>
                <button onClick={onStart}>Replace & start</button>
              </div>
            </section>
          )}
          <nav className="launch-links" aria-label="Menu options">
            <button onClick={onSettings}>Settings</button>
            <button onClick={onDetails}>Flight manual</button>
            <button onClick={onLeaderboard}>Leaderboard</button>
            <button onClick={onUpdateLog}>Update log</button>
          </nav>
          <p className="launch-hint">
            WASD thrust · Mouse aim · Click fire · Tab weapon · E missile · P pause
          </p>
        </section>
        <aside className="launch-sidebar">
          <form className="launch-profile" onSubmit={saveCallsign}>
            <label className="launch-eyebrow" htmlFor="menu-callsign">
              Pilot callsign
            </label>
            <div className="launch-input-row">
              <input
                id="menu-callsign"
                value={callsign}
                onChange={(event) => setCallsign(event.target.value)}
                minLength={2}
                maxLength={24}
                required
                pattern="[A-Za-z0-9][A-Za-z0-9 _\-]{1,23}"
                placeholder="Choose your callsign"
                autoComplete="nickname"
                disabled={saving || !configured}
                aria-describedby="callsign-help"
              />
              <button disabled={saving || !configured}>{saving ? "Saving…" : "Save"}</button>
            </div>
            <p id="callsign-help" className="launch-hint">
              2–24 letters, numbers, spaces, underscores or hyphens.
            </p>
            <p role="status" className="launch-profile-message">
              {profileMessage ||
                (!configured
                  ? "Callsign editing becomes available when the leaderboard is connected."
                  : "Your identity across the global leaderboard.")}
            </p>
          </form>
          <section className="launch-board" aria-label="Global leaderboard preview">
            <div className="launch-board-heading">
              <div>
                <p className="launch-eyebrow">
                  <Radio size={12} /> Global signal
                </p>
                <h2>TOP PILOTS</h2>
              </div>
              <button
                onClick={() => setRefresh((value) => value + 1)}
                disabled={loading}
                aria-label="Refresh leaderboard"
              >
                <RefreshCw size={16} />
              </button>
            </div>
            {boardError && (
              <p className="launch-board-message" role="status">
                {boardError}
                {page ? " Showing last received standings." : ""}
              </p>
            )}
            {loading && !page && (
              <p className="launch-board-message" role="status">
                Connecting to the leaderboard…
              </p>
            )}
            {page && page.entries.length === 0 && (
              <p className="launch-board-message">
                The board is clear. Fly your first run to claim a place.
              </p>
            )}
            <ol className="launch-ranks">
              {page?.entries.map((entry) => (
                <li key={entry.id}>
                  <span className="launch-rank">{String(entry.rank).padStart(2, "0")}</span>
                  <div>
                    <strong>{entry.username}</strong>
                    <small>
                      {entry.stage === "mk6-cleared"
                        ? "MK6 cleared"
                        : entry.stage === "mk6"
                          ? "MK6 engaged"
                          : `Wave ${entry.wave}`}{" "}
                      · LV {entry.level}
                      {entry.assisted ? " · Assisted" : ""}
                    </small>
                  </div>
                  <span className="launch-score">
                    {entry.score.toLocaleString()}
                    <small>PTS</small>
                  </span>
                </li>
              ))}
            </ol>
            <button className="launch-more" onClick={onLeaderboard}>
              View full leaderboard{" "}
              <span>
                {page ? `${page.total} pilots` : "More"} <ArrowRight size={15} />
              </span>
            </button>
          </section>
          <p className="launch-hint">
            One best run per pilot. Ranked by progression, then score and credits.
          </p>
        </aside>
      </div>
    </div>
  );
}

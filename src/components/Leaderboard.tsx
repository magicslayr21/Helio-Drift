import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronLeft,
  Crosshair,
  Ellipsis,
  Eye,
  LoaderCircle,
  Pencil,
  Radio,
  RefreshCw,
  ShieldCheck,
  Trash2,
  Trophy,
  UserRound,
  WifiOff,
  X,
} from "lucide-react";
import { SALVAGE_UPGRADES, STAT_UPGRADES, WEAPON_DEFS } from "../game/balance";
import {
  authenticateDeveloper,
  deleteRun,
  editRun,
  getAdminSession,
  getIdentity,
  getLeaderboard,
  getRunDetails,
  getSyncStatus,
  isLeaderboardConfigured,
  setUsername,
} from "../leaderboard/client";
import type {
  LeaderboardEntry,
  LeaderboardPage,
  RunDetails,
  RunEdit,
  RunStage,
  RunStatus,
} from "../leaderboard/types";
import "./Leaderboard.css";

const PAGE_SIZE = 25;
const numberFormat = new Intl.NumberFormat();
const formatNumber = (value: number) => numberFormat.format(value);
const statusLabels: Record<RunStatus, string> = {
  active: "In flight",
  paused: "Paused",
  dead: "Run ended",
  victory: "Victory",
  abandoned: "Retired",
};
type RunAction = "details" | "rename" | "edit" | "delete";
type ActionPanel = { kind: RunAction | "authenticate"; entry: LeaderboardEntry; next?: RunAction };

function progression(entry: Pick<LeaderboardEntry, "stage" | "wave">) {
  if (entry.stage === "mk6-cleared") return "MK6 · CLEARED";
  if (entry.stage === "mk6") return "MK6 · ENGAGED";
  return `WAVE ${String(entry.wave).padStart(2, "0")}`;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Connection interrupted. Please try again.";
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unknown" : date.toLocaleString();
}

function formatDuration(seconds: number) {
  const whole = Math.max(0, Math.round(seconds));
  const hours = Math.floor(whole / 3600);
  return `${hours ? `${hours}h ` : ""}${Math.floor((whole % 3600) / 60)}m ${whole % 60}s`;
}

function upgradeName(id: string) {
  return STAT_UPGRADES.find((upgrade) => upgrade.id === id)?.name ?? id;
}

function droneUpgradeName(id: string) {
  return SALVAGE_UPGRADES[id as keyof typeof SALVAGE_UPGRADES]?.name ?? id;
}

function RunTelemetry({ details }: { details: RunDetails }) {
  const report = details.report;
  const weapons = Object.entries(report.weapons).filter(([, level]) => level > 0);
  const upgrades = Object.entries(report.upgrades).filter(([, stacks]) => stacks > 0);
  const droneUpgrades = Object.entries(report.drone.upgrades).filter(([, stacks]) => stacks > 0);
  return (
    <div className="lb-telemetry">
      <dl className="lb-detail-stats">
        <div>
          <dt>Furthest reached</dt>
          <dd>{progression(details)}</dd>
        </div>
        <div>
          <dt>Run status</dt>
          <dd>{statusLabels[details.status]}</dd>
        </div>
        <div>
          <dt>Score</dt>
          <dd>{formatNumber(details.score)}</dd>
        </div>
        <div>
          <dt>Credits held</dt>
          <dd>{formatNumber(details.credits)}</dd>
        </div>
        <div>
          <dt>Player level</dt>
          <dd>{formatNumber(details.level)}</dd>
        </div>
        <div>
          <dt>Flight time</dt>
          <dd>{formatDuration(report.durationSeconds)}</dd>
        </div>
        <div>
          <dt>Sector</dt>
          <dd>{report.sector}</dd>
        </div>
        <div>
          <dt>Developer assists</dt>
          <dd>{report.assisted ? "Used" : "None recorded"}</dd>
        </div>
      </dl>
      <section className="lb-detail-section">
        <h4>Final damage source</h4>
        <p>
          {report.deathCause ||
            (details.status === "dead" ? "No cause recorded" : "No death recorded")}
        </p>
      </section>
      <section className="lb-detail-section">
        <h4>Weapon loadout</h4>
        <ul className="lb-detail-list">
          {weapons.map(([id, level]) => (
            <li key={id}>
              <span>
                {WEAPON_DEFS[id as keyof typeof WEAPON_DEFS]?.name ?? id}
                {id === report.primary && <small>Equipped</small>}
              </span>
              <strong>LVL {level}</strong>
            </li>
          ))}
        </ul>
        {!weapons.length && <p>No weapons recorded.</p>}
      </section>
      <section className="lb-detail-section">
        <h4>Stat upgrades</h4>
        {upgrades.length ? (
          <ul className="lb-detail-list">
            {upgrades.map(([id, stacks]) => (
              <li key={id}>
                <span>{upgradeName(id)}</span>
                <strong>×{stacks}</strong>
              </li>
            ))}
          </ul>
        ) : (
          <p>No stat upgrades taken.</p>
        )}
      </section>
      <section className="lb-detail-section">
        <h4>Salvage drone</h4>
        <p>
          {report.drone.purchased
            ? `Deployed · ${report.drone.weapon ? (WEAPON_DEFS[report.drone.weapon]?.name ?? report.drone.weapon) : "No weapon mounted"}`
            : "Not purchased"}
        </p>
        {!!droneUpgrades.length && (
          <ul className="lb-detail-list">
            {droneUpgrades.map(([id, stacks]) => (
              <li key={id}>
                <span>{droneUpgradeName(id)}</span>
                <strong>×{stacks}</strong>
              </li>
            ))}
          </ul>
        )}
      </section>
      <dl className="lb-detail-meta">
        <div>
          <dt>First recorded</dt>
          <dd>{formatDate(details.createdAt)}</dd>
        </div>
        <div>
          <dt>Last updated</dt>
          <dd>{formatDate(details.updatedAt)}</dd>
        </div>
        <div>
          <dt>Moderated</dt>
          <dd>{details.moderated ? "Yes" : "No"}</dd>
        </div>
        <div>
          <dt>Record ID</dt>
          <dd>{details.id}</dd>
        </div>
        <div>
          <dt>Player ID</dt>
          <dd>{details.playerId}</dd>
        </div>
      </dl>
    </div>
  );
}

export function Leaderboard({
  onClose,
  devUnlocked,
  onDeveloperUnlock,
}: {
  onClose: () => void;
  devUnlocked: boolean;
  onDeveloperUnlock?: () => void;
}) {
  const configured = isLeaderboardConfigured();
  const [identity, setIdentity] = useState(getIdentity);
  const [username, updateUsername] = useState(() => getIdentity()?.username ?? "");
  const [namePending, setNamePending] = useState(false);
  const [nameError, setNameError] = useState("");
  const [notice, setNotice] = useState("");
  const [page, setPage] = useState<LeaderboardPage | null>(null);
  const [offset, setOffset] = useState(0);
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState("");
  const [online, setOnline] = useState(() => navigator.onLine);
  const [syncStatus, setSyncStatus] = useState(getSyncStatus);
  const [admin, setAdmin] = useState(getAdminSession);
  const [actionMenu, setActionMenu] = useState<string | null>(null);
  const [action, setAction] = useState<ActionPanel | null>(null);
  const [actionError, setActionError] = useState("");
  const [actionPending, setActionPending] = useState(false);
  const [details, setDetails] = useState<RunDetails | null>(null);
  const [detailsPending, setDetailsPending] = useState(false);
  const [code, setCode] = useState("");
  const [edit, setEdit] = useState<RunEdit | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const offsetRef = useRef(0);
  const requestRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);
  const detailsRequestRef = useRef(0);
  const canModerate = devUnlocked || !!admin;

  const fetchPage = useCallback(
    async (requestedOffset = offsetRef.current) => {
      if (!configured) return;
      requestRef.current?.abort();
      const controller = new AbortController();
      requestRef.current = controller;
      setFetching(true);
      setFetchError("");
      try {
        let result = await getLeaderboard(requestedOffset, PAGE_SIZE, controller.signal);
        // A moderator may have removed the last entry on the current page.
        const lastOffset = Math.max(0, Math.floor((result.total - 1) / PAGE_SIZE) * PAGE_SIZE);
        if (requestedOffset > lastOffset) {
          requestedOffset = lastOffset;
          result = await getLeaderboard(requestedOffset, PAGE_SIZE, controller.signal);
        }
        if (controller.signal.aborted || !mountedRef.current) return;
        setPage(result);
        setOffset(requestedOffset);
        offsetRef.current = requestedOffset;
        setOnline(navigator.onLine);
        const currentIdentity = getIdentity();
        if (currentIdentity) setIdentity(currentIdentity);
      } catch (error) {
        if (!controller.signal.aborted && mountedRef.current) setFetchError(errorMessage(error));
      } finally {
        if (!controller.signal.aborted && mountedRef.current) setFetching(false);
      }
    },
    [configured],
  );

  useEffect(() => {
    mountedRef.current = true;
    const previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    void fetchPage();
    const refresh = () => {
      setOnline(navigator.onLine);
      setSyncStatus(getSyncStatus());
      setAdmin(getAdminSession());
      if (document.visibilityState === "visible" && navigator.onLine) void fetchPage();
    };
    const markOffline = () => setOnline(false);
    const interval = window.setInterval(refresh, 30_000);
    window.addEventListener("online", refresh);
    window.addEventListener("offline", markOffline);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      mountedRef.current = false;
      requestRef.current?.abort();
      detailsRequestRef.current++;
      window.clearInterval(interval);
      window.removeEventListener("online", refresh);
      window.removeEventListener("offline", markOffline);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, [fetchPage]);

  useEffect(() => {
    if (!action) return;
    const frame = requestAnimationFrame(() => {
      (sheetRef.current?.querySelector("[data-autofocus]") as HTMLElement | null)?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [action?.kind, action?.entry.id]);

  const closeAction = () => {
    if (actionPending) return;
    detailsRequestRef.current++;
    setAction(null);
    setActionError("");
    setCode("");
    setDetails(null);
    setDetailsPending(false);
    requestAnimationFrame(() => triggerRef.current?.focus());
  };

  const loadDetails = async (entry: LeaderboardEntry) => {
    const request = ++detailsRequestRef.current;
    setDetailsPending(true);
    setDetails(null);
    setActionError("");
    try {
      const result = await getRunDetails(entry.id);
      if (mountedRef.current && request === detailsRequestRef.current) setDetails(result);
    } catch (error) {
      if (mountedRef.current && request === detailsRequestRef.current)
        setActionError(errorMessage(error));
    } finally {
      if (mountedRef.current && request === detailsRequestRef.current) setDetailsPending(false);
    }
  };

  const openAction = (kind: RunAction, entry: LeaderboardEntry) => {
    setActionMenu(null);
    setActionError("");
    setDetails(null);
    setEdit({
      username: entry.username,
      score: entry.score,
      credits: entry.credits,
      wave: entry.wave,
      level: entry.level,
      stage: entry.stage,
      status: entry.status,
    });
    if (!getAdminSession()) {
      setAdmin(null);
      setAction({ kind: "authenticate", next: kind, entry });
      return;
    }
    setAction({ kind, entry });
    if (kind === "details") void loadDetails(entry);
  };

  const saveName = async (event: FormEvent) => {
    event.preventDefault();
    if (namePending) return;
    setNamePending(true);
    setNameError("");
    setNotice("");
    try {
      const result = await setUsername(username.trim());
      if (!mountedRef.current) return;
      setIdentity(result);
      updateUsername(result.username);
      setNotice(
        result.username === username.trim()
          ? `Callsign saved: ${result.username}.`
          : `Your callsign was adjusted to ${result.username}.`,
      );
      void fetchPage();
    } catch (error) {
      if (mountedRef.current) setNameError(errorMessage(error));
    } finally {
      if (mountedRef.current) setNamePending(false);
    }
  };

  const submitAction = async (event: FormEvent) => {
    event.preventDefault();
    if (!action || actionPending) return;
    setActionPending(true);
    setActionError("");
    try {
      if (action.kind === "authenticate") {
        const session = await authenticateDeveloper(code);
        if (!mountedRef.current) return;
        setAdmin(session);
        setCode("");
        onDeveloperUnlock?.();
        const next = action.next ?? "details";
        setAction({ kind: next, entry: action.entry });
        if (next === "details") void loadDetails(action.entry);
      } else if (action.kind === "delete") {
        await deleteRun(action.entry.id);
        if (!mountedRef.current) return;
        setNotice(`${action.entry.username}’s run was removed.`);
        setAction(null);
        void fetchPage();
        requestAnimationFrame(() => closeRef.current?.focus());
      } else if (edit && (action.kind === "edit" || action.kind === "rename")) {
        await editRun(
          action.entry.id,
          action.kind === "rename"
            ? { username: edit.username.trim() }
            : { ...edit, username: edit.username.trim() },
        );
        if (!mountedRef.current) return;
        setNotice("Record updated. Offensive callsigns are replaced automatically.");
        setAction(null);
        void fetchPage();
        requestAnimationFrame(() => triggerRef.current?.focus());
      }
    } catch (error) {
      if (mountedRef.current) {
        setActionError(errorMessage(error));
        setAdmin(getAdminSession());
      }
    } finally {
      if (mountedRef.current) setActionPending(false);
    }
  };

  const actionTitle =
    action?.kind === "authenticate"
      ? "Developer access"
      : action?.kind === "details"
        ? "Run telemetry"
        : action?.kind === "rename"
          ? "Rename pilot"
          : action?.kind === "edit"
            ? "Modify run"
            : "Remove run";

  return createPortal(
    <div
      className="lb-overlay"
      onPointerDown={(event) => event.stopPropagation()}
      onKeyUp={(event) => event.stopPropagation()}
    >
      <div
        ref={panelRef}
        className="lb-window"
        role="dialog"
        aria-modal="true"
        aria-labelledby="leaderboard-title"
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Escape") {
            event.preventDefault();
            if (action) closeAction();
            else if (actionMenu) setActionMenu(null);
            else onClose();
          }
          if (event.key !== "Tab") return;
          const container = action ? sheetRef.current : panelRef.current;
          const focusable = Array.from(
            container?.querySelectorAll<HTMLElement>(
              'button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"]',
            ) ?? [],
          ).filter((element) => element.getClientRects().length > 0);
          const first = focusable[0];
          const last = focusable[focusable.length - 1];
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last?.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
          }
        }}
      >
        <div className="lb-main" inert={action ? true : undefined}>
          <header className="lb-header">
            <div className="lb-heading">
              <div className="lb-eyebrow">
                <Trophy size={14} aria-hidden="true" /> GLOBAL LEADERBOARD <span>HD–79</span>
              </div>
              <h2 id="leaderboard-title">FLIGHT RECORDS</h2>
              <p>The furthest run from every pilot. All sectors. Beyond MK6.</p>
            </div>
            <button
              ref={closeRef}
              type="button"
              className="lb-icon-button lb-close"
              aria-label="Close leaderboard"
              onClick={onClose}
            >
              <X size={21} />
            </button>
          </header>

          <div className="lb-body thin-scroll">
            <section className="lb-profile" aria-label="Your player profile">
              <div className="lb-profile-label">
                <UserRound size={16} aria-hidden="true" />
                <div>
                  <span className="lb-label">YOUR CALLSIGN</span>
                  <p>{identity ? identity.username : "Choose your pilot name"}</p>
                </div>
              </div>
              <form onSubmit={saveName} className="lb-name-form">
                <label className="lb-sr-only" htmlFor="leaderboard-username">
                  Your username
                </label>
                <input
                  id="leaderboard-username"
                  name="username"
                  value={username}
                  onChange={(event) => {
                    updateUsername(event.target.value);
                    setNameError("");
                  }}
                  minLength={2}
                  maxLength={24}
                  required
                  autoComplete="nickname"
                  spellCheck={false}
                  placeholder="StarDestroyer"
                  disabled={!configured || namePending}
                />
                <button
                  type="submit"
                  className="lb-button lb-button-accent"
                  disabled={!configured || namePending || !username.trim()}
                >
                  {namePending ? (
                    <LoaderCircle size={14} className="lb-spin" aria-hidden="true" />
                  ) : (
                    <Check size={14} aria-hidden="true" />
                  )}
                  Save name
                </button>
              </form>
              <p className="lb-profile-note">
                Offensive names are replaced with a safe callsign. Your pilot profile is saved in
                this browser.
              </p>
              {nameError && (
                <p className="lb-inline-error" role="alert">
                  {nameError}
                </p>
              )}
            </section>

            <div className="lb-toolbar">
              <div>
                <span className="lb-label">PILOT RANKINGS</span>
                <p>
                  {page
                    ? `${formatNumber(page.total)} pilot${page.total === 1 ? "" : "s"} on record`
                    : "Every flight leaves a mark"}
                </p>
              </div>
              <div className="lb-toolbar-controls">
                <span
                  className={`lb-connection ${!online || fetchError ? "lb-connection-offline" : ""}`}
                >
                  {!online || fetchError ? (
                    <WifiOff size={12} aria-hidden="true" />
                  ) : (
                    <Radio size={12} aria-hidden="true" />
                  )}
                  {!configured
                    ? "UNAVAILABLE"
                    : !online
                      ? "OFFLINE"
                      : fetchError
                        ? "RETRY NEEDED"
                        : "REFRESHES EVERY 30s"}
                </span>
                <button
                  className="lb-icon-button"
                  type="button"
                  aria-label="Refresh leaderboard"
                  title="Refresh leaderboard"
                  disabled={!configured || fetching}
                  onClick={() => void fetchPage()}
                >
                  <RefreshCw size={16} className={fetching ? "lb-spin" : ""} />
                </button>
              </div>
            </div>

            {notice && (
              <p className="lb-notice" role="status">
                <Check size={14} aria-hidden="true" />
                {notice}
                <button type="button" aria-label="Dismiss notice" onClick={() => setNotice("")}>
                  <X size={13} />
                </button>
              </p>
            )}
            {fetchError && (
              <div className="lb-error" role="alert">
                <WifiOff size={16} aria-hidden="true" />
                <div>
                  <strong>Unable to refresh the leaderboard</strong>
                  <p>
                    {fetchError}
                    {page ? " Your last loaded records are still shown." : ""}
                  </p>
                </div>
                <button
                  type="button"
                  className="lb-button"
                  disabled={fetching}
                  onClick={() => void fetchPage()}
                >
                  Retry
                </button>
              </div>
            )}

            {!configured ? (
              <div className="lb-empty">
                <Radio size={36} aria-hidden="true" />
                <h3>Leaderboard is not available yet</h3>
                <p>Global flight records will appear here when the leaderboard comes online.</p>
              </div>
            ) : !page && fetching ? (
              <div className="lb-empty" role="status">
                <LoaderCircle size={32} className="lb-spin" aria-hidden="true" />
                <h3>Receiving flight records</h3>
                <p>Connecting to the global leaderboard…</p>
              </div>
            ) : page && page.total === 0 ? (
              <div className="lb-empty">
                <Crosshair size={36} aria-hidden="true" />
                <h3>Uncharted territory</h3>
                <p>No runs have been recorded yet. Set your callsign and take flight.</p>
              </div>
            ) : page ? (
              <div className="lb-rankings" aria-busy={fetching}>
                <div
                  className={`lb-columns ${canModerate ? "lb-with-actions" : ""}`}
                  aria-hidden="true"
                >
                  <span>#</span>
                  <span>PILOT</span>
                  <span>FURTHEST</span>
                  <span>SCORE</span>
                  <span>CREDITS</span>
                  {canModerate && <span />}
                </div>
                <ol className="lb-record-list" start={offset + 1}>
                  {page.entries.map((entry) => (
                    <li
                      key={entry.id}
                      className={`lb-record ${canModerate ? "lb-with-actions" : ""} ${entry.rank === 1 ? "lb-record-first" : ""} ${identity?.playerId === entry.playerId ? "lb-record-you" : ""}`}
                    >
                      <span className="lb-rank" aria-label={`Rank ${entry.rank}`}>
                        {entry.rank === 1 ? (
                          <Trophy size={18} aria-hidden="true" />
                        ) : (
                          String(entry.rank).padStart(2, "0")
                        )}
                      </span>
                      <div className="lb-pilot">
                        <div>
                          <span className="lb-pilot-name" title={entry.username}>
                            {entry.username}
                          </span>
                          {identity?.playerId === entry.playerId && (
                            <span className="lb-you">YOU</span>
                          )}
                        </div>
                        <p>
                          LVL {entry.level}
                          <span>·</span>
                          {statusLabels[entry.status]}
                          {entry.assisted && (
                            <span
                              className="lb-assisted"
                              title="Developer assists were used during this run"
                            >
                              ASSISTED
                            </span>
                          )}
                        </p>
                      </div>
                      <div className={`lb-progress ${entry.stage !== "sectors" ? "lb-mk6" : ""}`}>
                        <span className="lb-mobile-label">FURTHEST</span>
                        <strong>{progression(entry)}</strong>
                      </div>
                      <div className="lb-score">
                        <span className="lb-mobile-label">SCORE</span>
                        <strong>{formatNumber(entry.score)}</strong>
                      </div>
                      <div className="lb-credits">
                        <span className="lb-mobile-label">CREDITS</span>
                        <strong>{formatNumber(entry.credits)}</strong>
                      </div>
                      {canModerate && (
                        <div className="lb-actions">
                          <button
                            type="button"
                            className="lb-icon-button"
                            aria-label={`Actions for ${entry.username}`}
                            aria-expanded={actionMenu === entry.id}
                            onClick={(event) => {
                              triggerRef.current = event.currentTarget;
                              setActionMenu((current) => (current === entry.id ? null : entry.id));
                            }}
                          >
                            <Ellipsis size={19} />
                          </button>
                          {actionMenu === entry.id && (
                            <div
                              className="lb-action-menu"
                              role="group"
                              aria-label={`Actions for ${entry.username}`}
                            >
                              <button type="button" onClick={() => openAction("details", entry)}>
                                <Eye size={14} />
                                View run details
                              </button>
                              <button type="button" onClick={() => openAction("rename", entry)}>
                                <UserRound size={14} />
                                Change name
                              </button>
                              <button type="button" onClick={() => openAction("edit", entry)}>
                                <Pencil size={14} />
                                Modify run
                              </button>
                              <button
                                type="button"
                                className="lb-danger-text"
                                onClick={() => openAction("delete", entry)}
                              >
                                <Trash2 size={14} />
                                Remove run
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </li>
                  ))}
                </ol>
                <div className="lb-pagination">
                  <span>
                    {page.total
                      ? `${formatNumber(offset + 1)}–${formatNumber(Math.min(offset + page.entries.length, page.total))} of ${formatNumber(page.total)}`
                      : "0 pilots"}
                  </span>
                  <div>
                    <button
                      type="button"
                      className="lb-button"
                      disabled={offset === 0 || fetching}
                      onClick={() => {
                        setActionMenu(null);
                        void fetchPage(Math.max(0, offset - PAGE_SIZE));
                      }}
                    >
                      <ArrowLeft size={14} />
                      Previous
                    </button>
                    <button
                      type="button"
                      className="lb-button"
                      disabled={offset + PAGE_SIZE >= page.total || fetching}
                      onClick={() => {
                        setActionMenu(null);
                        void fetchPage(offset + PAGE_SIZE);
                      }}
                    >
                      Next
                      <ArrowRight size={14} />
                    </button>
                  </div>
                </div>
              </div>
            ) : !fetchError ? (
              <div className="lb-empty">
                <WifiOff size={32} aria-hidden="true" />
                <h3>Waiting for a connection</h3>
                <p>Reconnect to view pilots from around the world.</p>
              </div>
            ) : null}
          </div>

          <footer className="lb-footer">
            <p>Ranked by progress, then score and credits. One best run per pilot.</p>
            <div>
              {canModerate && (
                <span className="lb-dev-badge">
                  <ShieldCheck size={12} />
                  DEVELOPER
                </span>
              )}
              {page && (
                <span title={formatDate(page.updatedAt)}>
                  Updated{" "}
                  {new Date(page.updatedAt).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              )}
              {syncStatus === "offline" && <span>Run sync pending</span>}
            </div>
          </footer>
        </div>

        {action && (
          <div className="lb-sheet-backdrop">
            <div
              ref={sheetRef}
              className="lb-sheet thin-scroll"
              role="dialog"
              aria-modal="true"
              aria-labelledby="leaderboard-action-title"
            >
              <header className="lb-sheet-header">
                <div>
                  <span className="lb-label">DEVELOPER CONSOLE</span>
                  <h3 id="leaderboard-action-title">{actionTitle}</h3>
                  <p>
                    {action.entry.username} · {progression(action.entry)}
                  </p>
                </div>
                <button
                  type="button"
                  className="lb-icon-button"
                  aria-label="Close record actions"
                  data-autofocus={
                    action.kind === "details" || action.kind === "delete" ? true : undefined
                  }
                  disabled={actionPending}
                  onClick={closeAction}
                >
                  <X size={19} />
                </button>
              </header>
              {actionError && (
                <div className="lb-error" role="alert">
                  <div>
                    <strong>Action could not be completed</strong>
                    <p>{actionError}</p>
                  </div>
                </div>
              )}
              {action.kind === "details" ? (
                <>
                  {detailsPending ? (
                    <div className="lb-empty" role="status">
                      <LoaderCircle size={26} className="lb-spin" />
                      <p>Loading run telemetry…</p>
                    </div>
                  ) : details ? (
                    <RunTelemetry details={details} />
                  ) : (
                    <button
                      type="button"
                      className="lb-button"
                      onClick={() => void loadDetails(action.entry)}
                    >
                      <RefreshCw size={14} />
                      Retry details
                    </button>
                  )}
                  <div className="lb-sheet-buttons">
                    <button type="button" className="lb-button" onClick={closeAction}>
                      <ChevronLeft size={14} />
                      Back to records
                    </button>
                  </div>
                </>
              ) : (
                <form onSubmit={submitAction} className="lb-edit-form">
                  {action.kind === "authenticate" ? (
                    <>
                      <p className="lb-sheet-copy">
                        Enter the developer code to securely manage global records.
                      </p>
                      <label>
                        Developer code
                        <input
                          type="password"
                          value={code}
                          onChange={(event) => setCode(event.target.value)}
                          autoComplete="off"
                          required
                          data-autofocus
                          disabled={actionPending}
                        />
                      </label>
                    </>
                  ) : action.kind === "delete" ? (
                    <div className="lb-delete-warning">
                      <Trash2 size={28} aria-hidden="true" />
                      <p>
                        Remove <strong>{action.entry.username}’s</strong> run from the global
                        leaderboard?
                      </p>
                      <p>
                        This record will be hidden from all players. This action cannot be undone
                        here.
                      </p>
                      <dl>
                        <div>
                          <dt>Progress</dt>
                          <dd>{progression(action.entry)}</dd>
                        </div>
                        <div>
                          <dt>Score</dt>
                          <dd>{formatNumber(action.entry.score)}</dd>
                        </div>
                      </dl>
                    </div>
                  ) : (
                    edit && (
                      <>
                        <label>
                          Pilot name
                          <input
                            value={edit.username}
                            onChange={(event) => setEdit({ ...edit, username: event.target.value })}
                            minLength={2}
                            maxLength={24}
                            required
                            spellCheck={false}
                            data-autofocus
                            disabled={actionPending}
                          />
                        </label>
                        <p className="lb-field-note">
                          Offensive names are automatically replaced with a safe callsign.
                        </p>
                        {action.kind === "edit" && (
                          <>
                            <div className="lb-edit-grid">
                              {(["score", "credits", "wave", "level"] as const).map((field) => (
                                <label key={field}>
                                  {field === "level" ? "Player level" : field}
                                  <input
                                    type="number"
                                    min={field === "level" || field === "wave" ? 1 : 0}
                                    max={
                                      field === "level" || field === "wave"
                                        ? 1_000_000
                                        : 1_000_000_000_000
                                    }
                                    step={1}
                                    required
                                    value={Number.isNaN(edit[field]) ? "" : edit[field]}
                                    onChange={(event) =>
                                      setEdit({
                                        ...edit,
                                        [field]:
                                          event.target.value === ""
                                            ? Number.NaN
                                            : Number(event.target.value),
                                      })
                                    }
                                    disabled={actionPending}
                                  />
                                </label>
                              ))}
                              <label htmlFor="leaderboard-edit-stage">
                                Stage
                                <select
                                  id="leaderboard-edit-stage"
                                  aria-label="Stage"
                                  value={edit.stage}
                                  onChange={(event) =>
                                    setEdit({ ...edit, stage: event.target.value as RunStage })
                                  }
                                  disabled={actionPending}
                                >
                                  <option value="sectors">Standard sectors</option>
                                  <option value="mk6">MK6 engaged</option>
                                  <option value="mk6-cleared">MK6 cleared</option>
                                </select>
                              </label>
                              <label htmlFor="leaderboard-edit-status">
                                Run status
                                <select
                                  id="leaderboard-edit-status"
                                  aria-label="Run status"
                                  value={edit.status}
                                  onChange={(event) =>
                                    setEdit({ ...edit, status: event.target.value as RunStatus })
                                  }
                                  disabled={actionPending}
                                >
                                  {Object.entries(statusLabels).map(([value, label]) => (
                                    <option key={value} value={value}>
                                      {label}
                                    </option>
                                  ))}
                                </select>
                              </label>
                            </div>
                            <p className="lb-field-note">
                              Changes update this global record. Saved weapon and upgrade telemetry
                              is kept with the run.
                            </p>
                          </>
                        )}
                      </>
                    )
                  )}
                  <div className="lb-sheet-buttons">
                    <button
                      type="button"
                      className="lb-button"
                      onClick={closeAction}
                      disabled={actionPending}
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className={`lb-button ${action.kind === "delete" ? "lb-button-danger" : "lb-button-accent"}`}
                      disabled={actionPending}
                    >
                      {actionPending && (
                        <LoaderCircle size={14} className="lb-spin" aria-hidden="true" />
                      )}
                      {action.kind === "authenticate"
                        ? "Unlock actions"
                        : action.kind === "delete"
                          ? "Remove run"
                          : "Save changes"}
                    </button>
                  </div>
                </form>
              )}
              {actionError && action.kind !== "authenticate" && (
                <button
                  type="button"
                  className="lb-reauthenticate"
                  disabled={actionPending}
                  onClick={() => {
                    setActionError("");
                    setAction({ ...action, kind: "authenticate", next: action.kind as RunAction });
                  }}
                >
                  Sign in again with developer code
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

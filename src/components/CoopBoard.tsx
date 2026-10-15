import { useEffect, useRef, useState, type FormEvent } from "react";
import { Eye, Pencil, RefreshCw, ShieldCheck, Trash2, X } from "lucide-react";
import {
  authenticateDeveloper,
  deleteCoopRun,
  editCoopRun,
  getAdminSession,
  getCoopRunDetails,
} from "../leaderboard/client";
import type {
  CoopLeaderboardEntry,
  CoopLeaderboardPage,
  CoopRunDetails,
  CoopRunEdit,
} from "../leaderboard/types";
import { SALVAGE_UPGRADES, STAT_UPGRADES, WEAPON_DEFS } from "../game/balance";
import type { SalvageUpgradeId, WeaponId } from "../game/types";
import "./Leaderboard.css";

const duration = (seconds: number) => `${Math.floor(seconds / 60)}m ${Math.floor(seconds % 60)}s`;
type Action = "details" | "edit" | "delete" | "authenticate";
export function CoopBoard({
  page,
  notice,
  pending,
  onRefresh,
  onMore,
}: {
  page: CoopLeaderboardPage | null;
  notice: string;
  pending: boolean;
  onRefresh: () => void;
  onMore: () => void;
}) {
  const [admin, setAdmin] = useState(getAdminSession);
  const [selected, setSelected] = useState<CoopLeaderboardEntry | null>(null);
  const [action, setAction] = useState<Action>("details");
  const [nextAction, setNextAction] = useState<Action>("details");
  const [details, setDetails] = useState<CoopRunDetails | null>(null);
  const [edit, setEdit] = useState<CoopRunEdit | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [code, setCode] = useState("");
  const sheet = useRef<HTMLDivElement>(null);
  const request = useRef(0);
  const trigger = useRef<HTMLElement | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      request.current++;
    };
  }, []);
  useEffect(() => {
    if (selected) sheet.current?.querySelector<HTMLElement>("[data-autofocus]")?.focus();
  }, [selected, action, busy]);
  const close = () => {
    if (busy) return;
    request.current++;
    setSelected(null);
    setError("");
    setCode("");
    trigger.current?.focus();
  };
  const load = async (entry: CoopLeaderboardEntry, kind: Action) => {
    const id = ++request.current;
    setBusy(true);
    setError("");
    try {
      const data = await getCoopRunDetails(entry.id);
      if (!mounted.current || id !== request.current) return;
      setDetails(data);
      setEdit({
        revision: data.revision,
        playerOne: data.playerOne,
        playerTwo: data.playerTwo,
        score: data.score,
        wave: data.wave,
        sector: data.sector,
        durationSeconds: data.durationSeconds,
        bossesDefeated: data.bossesDefeated,
        status: data.status,
      });
      setAction(kind);
    } catch (e) {
      if (!mounted.current || id !== request.current) return;
      setError(e instanceof Error ? e.message : "Unable to load record.");
      if (!getAdminSession()) {
        setAdmin(null);
        setNextAction(kind);
        setAction("authenticate");
      }
    } finally {
      if (mounted.current && id === request.current) setBusy(false);
    }
  };
  const open = (entry: CoopLeaderboardEntry, kind: Action) => {
    trigger.current = document.activeElement as HTMLElement;
    setSelected(entry);
    setDetails(null);
    setEdit(null);
    setError("");
    if (!getAdminSession()) {
      setAdmin(null);
      setNextAction(kind);
      setAction("authenticate");
    } else {
      setAction(kind);
      void load(entry, kind);
    }
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || !selected) return;
    setBusy(true);
    setError("");
    try {
      if (action === "authenticate") {
        const session = await authenticateDeveloper(code);
        if (!mounted.current) return;
        setAdmin(session);
        setCode("");
        setBusy(false);
        await load(selected, nextAction);
        return;
      }
      if (action === "delete") await deleteCoopRun(selected.id);
      else if (action === "edit" && edit) await editCoopRun(selected.id, edit);
      if (!mounted.current) return;
      setSelected(null);
      onRefresh();
      trigger.current?.focus();
    } catch (e) {
      if (!mounted.current) return;
      setError(e instanceof Error ? e.message : "Action failed.");
      if (!getAdminSession()) {
        setAdmin(null);
        setNextAction(action);
        setAction("authenticate");
      }
    } finally {
      if (mounted.current) setBusy(false);
    }
  };
  return (
    <div className="coop-browser">
      <div className="coop-section-title">
        <div>
          <p className="deploy-eyebrow">Server-authored records</p>
          <h2>CO-OP LEADERBOARD</h2>
        </div>
        <button onClick={onRefresh} disabled={pending}>
          <RefreshCw size={16} /> Refresh
        </button>
      </div>
      <p className="coop-help">
        {admin
          ? "Developer session active · Inspect, edit or remove team records."
          : "Use a record action and enter your developer code to manage co-op records."}
      </p>
      {notice && <p className="coop-notice">{notice}</p>}
      <div className="coop-board-head">
        <span>Rank / team</span>
        <span>Progress</span>
        <span>Score</span>
        <span>Time / actions</span>
      </div>
      {page?.entries.map((entry) => (
        <div className="coop-board-row" key={entry.id}>
          <span>
            <b>#{entry.rank}</b>
            <strong>
              {entry.playerOne} + {entry.playerTwo}
            </strong>
          </span>
          <span>
            W{entry.wave} · S{entry.sector}
            <small>{entry.status}</small>
          </span>
          <span>
            {entry.score.toLocaleString()}
            <small>{entry.bossesDefeated} bosses</small>
          </span>
          <span>
            {duration(entry.durationSeconds)}
            <small>{entry.completed ? "Campaign clear" : "Run ended"}</small>
            <span className="coop-record-actions">
              <button
                className="lb-icon-button"
                aria-label={`View stats for ${entry.playerOne} and ${entry.playerTwo}`}
                onClick={() => open(entry, "details")}
              >
                <Eye size={15} />
              </button>
              <button
                className="lb-icon-button"
                aria-label={`Edit run for ${entry.playerOne} and ${entry.playerTwo}`}
                onClick={() => open(entry, "edit")}
              >
                <Pencil size={15} />
              </button>
              <button
                className="lb-icon-button"
                aria-label={`Delete run for ${entry.playerOne} and ${entry.playerTwo}`}
                onClick={() => open(entry, "delete")}
              >
                <Trash2 size={15} />
              </button>
            </span>
          </span>
        </div>
      ))}
      {page && page.entries.length < page.total && (
        <button className="coop-load-more" disabled={pending} onClick={onMore}>
          Load more records
        </button>
      )}
      {!pending && !page?.entries.length && (
        <p className="coop-help">No authoritative co-op results have been recorded yet.</p>
      )}
      {selected && (
        <div
          className="lb-sheet-backdrop coop-record-backdrop"
          data-coop-record-dialog
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === "Escape") {
              event.preventDefault();
              close();
            }
            if (event.key !== "Tab") return;
            const controls = Array.from(
              sheet.current?.querySelectorAll<HTMLElement>(
                "button:not(:disabled),input:not(:disabled),select:not(:disabled)",
              ) ?? [],
            );
            const first = controls[0],
              last = controls.at(-1);
            if (event.shiftKey && document.activeElement === first) {
              event.preventDefault();
              last?.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault();
              first?.focus();
            }
          }}
        >
          <div
            className="lb-sheet thin-scroll"
            ref={sheet}
            role="dialog"
            aria-modal="true"
            aria-labelledby="coop-action-title"
          >
            <header className="lb-sheet-header">
              <div>
                <span className="lb-label">DEVELOPER CONSOLE</span>
                <h3 id="coop-action-title">
                  {action === "authenticate"
                    ? "Developer access"
                    : action === "details"
                      ? "Team telemetry"
                      : action === "edit"
                        ? "Edit co-op record"
                        : "Delete co-op record"}
                </h3>
                <p>
                  {selected.playerOne} + {selected.playerTwo} · Wave {selected.wave}
                </p>
              </div>
              <button
                className="lb-icon-button"
                type="button"
                aria-label="Close record actions"
                data-autofocus={action === "details" || action === "delete" ? true : undefined}
                disabled={busy}
                onClick={close}
              >
                <X size={19} />
              </button>
            </header>
            {error && (
              <div className="lb-error" role="alert">
                <p>{error}</p>
                {action !== "authenticate" && (
                  <button
                    className="lb-button"
                    onClick={() => void load(selected, action)}
                    disabled={busy}
                  >
                    Reload record
                  </button>
                )}
              </div>
            )}
            {busy && (
              <p role="status" className="lb-label">
                Synchronizing record…
              </p>
            )}
            {action === "details" && details && <CoopTelemetry details={details} />}
            {action !== "details" && (
              <form className="lb-edit-form" onSubmit={submit}>
                {action === "authenticate" ? (
                  <>
                    <p>Enter the developer code to securely manage co-op records.</p>
                    <label>
                      Developer code
                      <input
                        type="password"
                        value={code}
                        onChange={(e) => setCode(e.target.value)}
                        autoComplete="off"
                        maxLength={256}
                        required
                        disabled={busy}
                        data-autofocus
                      />
                    </label>
                  </>
                ) : action === "delete" ? (
                  <div className="lb-delete-warning">
                    <Trash2 size={28} />
                    <p>
                      Remove{" "}
                      <strong>
                        {selected.playerOne} + {selected.playerTwo}’s
                      </strong>{" "}
                      run from the co-op leaderboard?
                    </p>
                    <p>
                      This record will be hidden from all players. This action cannot be undone
                      here.
                    </p>
                    <dl>
                      <div>
                        <dt>Progress</dt>
                        <dd>Wave {selected.wave}</dd>
                      </div>
                      <div>
                        <dt>Score</dt>
                        <dd>{selected.score.toLocaleString()}</dd>
                      </div>
                    </dl>
                  </div>
                ) : (
                  edit && (
                    <>
                      {(
                        [
                          ["playerOne", "Pilot one"],
                          ["playerTwo", "Pilot two"],
                        ] as const
                      ).map(([key, label]) => (
                        <label key={key}>
                          {label}
                          <input
                            value={edit[key]}
                            minLength={2}
                            maxLength={24}
                            required
                            disabled={busy}
                            data-autofocus={key === "playerOne" ? true : undefined}
                            onChange={(e) => setEdit({ ...edit, [key]: e.target.value })}
                          />
                        </label>
                      ))}
                      <div className="lb-edit-grid">
                        {(
                          [
                            ["score", "Team score", 1e12],
                            ["wave", "Wave", 1000000],
                            ["sector", "Sector", 7],
                            ["durationSeconds", "Flight time (seconds)", 31536000],
                            ["bossesDefeated", "Bosses defeated", 1000000],
                          ] as const
                        ).map(([key, label, max]) => (
                          <label key={key}>
                            {label}
                            <input
                              type="number"
                              min={0}
                              max={max}
                              step={1}
                              required
                              disabled={busy}
                              value={edit[key]}
                              onChange={(e) => setEdit({ ...edit, [key]: Number(e.target.value) })}
                            />
                          </label>
                        ))}
                        <label>
                          Run status
                          <select
                            value={edit.status}
                            disabled={busy}
                            onChange={(e) =>
                              setEdit({ ...edit, status: e.target.value as CoopRunEdit["status"] })
                            }
                          >
                            <option value="victory">Victory</option>
                            <option value="defeat">Defeat</option>
                            <option value="abandoned">Abandoned</option>
                          </select>
                        </label>
                      </div>
                      <p>
                        Victory marks a campaign clear. Saved pilot telemetry remains the original
                        flight record.
                      </p>
                    </>
                  )
                )}
                <footer className="lb-sheet-buttons">
                  <button type="button" className="lb-button" disabled={busy} onClick={close}>
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className={`lb-button ${action === "delete" ? "lb-button-danger" : "lb-button-accent"}`}
                    disabled={busy || (action === "edit" && !edit)}
                  >
                    {action === "authenticate" ? (
                      <>
                        <ShieldCheck size={14} /> Authorize
                      </>
                    ) : action === "delete" ? (
                      "Delete run"
                    ) : (
                      "Save changes"
                    )}
                  </button>
                </footer>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
function CoopTelemetry({ details }: { details: CoopRunDetails }) {
  const stats = [
    ["Wave", details.wave],
    ["Sector", details.sector],
    ["Score", details.score.toLocaleString()],
    ["Bosses defeated", details.bossesDefeated],
    ["Flight time", duration(details.durationSeconds)],
    ["Status", details.status],
    ["Room", details.roomCode],
    ["Record edited", details.moderated ? "Yes" : "No"],
    ["Finished", new Date(details.finishedAt).toLocaleString()],
  ];
  return (
    <div className="lb-telemetry">
      <dl className="lb-detail-stats">
        {stats.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      {!details.telemetry ? (
        <p>
          Detailed pilot telemetry was not recorded for this older run. Its team statistics are
          shown above.
        </p>
      ) : (
        Object.entries(details.telemetry.pilots).map(([id, p]) => (
          <section className="lb-detail-section" key={id}>
            <h4>{id === "p1" ? details.playerOne : details.playerTwo}</h4>
            <dl className="lb-detail-stats">
              {[
                ["Level", p.level],
                ["Credits", p.credits],
                ["Hull", `${Math.ceil(p.hull)}/${p.maxHull}`],
                ["Damage dealt", Math.floor(p.stats.damage).toLocaleString()],
                ["Boss damage", Math.floor(p.stats.bossDamage).toLocaleString()],
                ["Enemy kills", p.stats.kills],
                ["Asteroid kills", p.stats.asteroidKills],
                ["Revives", p.stats.revives],
                ["Credits collected", p.stats.creditsCollected],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
            <h4>Weapon loadout</h4>
            <ul className="lb-detail-list">
              {Object.entries(p.weapons)
                .filter(([, n]) => n > 0)
                .map(([id, n]) => (
                  <li key={id}>
                    <span>
                      {WEAPON_DEFS[id as WeaponId]?.name ?? id}
                      {p.primary === id && <small>Equipped</small>}
                    </span>
                    <strong>LVL {n}</strong>
                  </li>
                ))}
            </ul>
            <h4>Stat upgrades</h4>
            <ul className="lb-detail-list">
              {Object.entries(p.upgrades)
                .filter(([, n]) => n > 0)
                .map(([id, n]) => (
                  <li key={id}>
                    <span>{STAT_UPGRADES.find((u) => u.id === id)?.name ?? id}</span>
                    <strong>×{n}</strong>
                  </li>
                ))}
            </ul>
            <h4>Salvage drone</h4>
            <p>
              {p.drone.purchased
                ? p.drone.weapon
                  ? WEAPON_DEFS[p.drone.weapon]?.name
                  : "Starter cannon"
                : "Not purchased"}
            </p>
            <ul className="lb-detail-list">
              {Object.entries(p.drone.upgrades)
                .filter(([, n]) => n > 0)
                .map(([id, n]) => (
                  <li key={id}>
                    <span>{SALVAGE_UPGRADES[id as SalvageUpgradeId]?.name ?? id}</span>
                    <strong>×{n}</strong>
                  </li>
                ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}

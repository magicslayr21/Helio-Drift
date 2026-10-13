import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { ArrowLeft, ArrowRight, RefreshCw, Radio, Shield, Users } from "lucide-react";
import {
  SALVAGE_BASE_PRICE,
  SALVAGE_UPGRADES,
  SALVAGE_UPGRADE_ORDER,
  STAT_UPGRADES,
  WEAPON_DEFS,
  WEAPON_ORDER,
  weaponMaxLevel,
} from "../game/balance";
import { audio } from "../game/audio";
import type {
  AuthoritativeSnapshot,
  ClientInputMessage,
  MultiplayerClientMessage,
  MultiplayerRoomView,
  PublicRoomSummary,
} from "../game/network/protocol";
import type { CoopEvent, CoopPlayerId } from "../game/simulation/coop-types";
import { salvageUpgradePrice, weaponPrice } from "../game/simulation/weapons";
import type { SalvageUpgradeId } from "../game/types";
import {
  authenticateDeveloper,
  clearDeveloperSession,
  getAdminSession,
  getCoopLeaderboard,
  isLeaderboardConfigured,
} from "../leaderboard/client";
import type { CoopLeaderboardPage } from "../leaderboard/types";
import {
  CoopConnection,
  clearCoopSession,
  createPrivateRoom,
  createPublicRoom,
  getPublicRooms,
  isMultiplayerConfigured,
  joinRoom,
  loadCoopSession,
  MultiplayerError,
  quickJoinRoom,
  saveCoopSession,
  type CoopConnectionState,
  type CoopSession,
} from "../multiplayer/client";
import { CoopArena } from "./CoopArena";
import "./MultiplayerExperience.css";

type Screen = "home" | "browse" | "create" | "join" | "leaderboard" | "room";
type WithoutSequence<T> = T extends { sequence: number } ? Omit<T, "sequence"> : T;
type UiCommand = WithoutSequence<Exclude<MultiplayerClientMessage, ClientInputMessage>>;

const directiveNames = {
  asteroidSurge: "Asteroid Surge",
  elitePatrol: "Elite Patrol",
  volatileSpace: "Volatile Space",
};

const statusLabel: Record<CoopConnectionState, string> = {
  connecting: "Linking",
  connected: "Synchronized",
  reconnecting: "Reconnecting",
  closed: "Offline",
};

const duration = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

export function MultiplayerExperience({
  callsign,
  onExit,
}: {
  callsign: string;
  onExit: () => void;
}) {
  const configured = isMultiplayerConfigured();
  const [screen, setScreen] = useState<Screen>("home");
  const [session, setSession] = useState<CoopSession | null>(null);
  const [room, setRoom] = useState<MultiplayerRoomView | null>(null);
  const [snapshot, setSnapshot] = useState<AuthoritativeSnapshot | null>(null);
  const [connectionState, setConnectionState] = useState<CoopConnectionState>("closed");
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState(false);
  const [roomName, setRoomName] = useState(`${callsign}'s Patrol`.slice(0, 32));
  const [roomCode, setRoomCode] = useState("");
  const [publicRooms, setPublicRooms] = useState<PublicRoomSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [board, setBoard] = useState<CoopLeaderboardPage | null>(null);
  const [shopOpen, setShopOpen] = useState(false);
  const [developerSession, setDeveloperSession] = useState(getAdminSession);
  const [developerCode, setDeveloperCode] = useState("");
  const [developerPending, setDeveloperPending] = useState(false);
  const [developerNotice, setDeveloperNotice] = useState("");
  const connection = useRef<CoopConnection | null>(null);
  const commandSequence = useRef(0);

  const enterSession = useCallback((next: CoopSession) => {
    setSession(next);
    setRoom(next.room);
    setSnapshot(null);
    setScreen("room");
    setNotice("");
  }, []);

  useEffect(() => {
    if (!session) return;
    let beamActive = false;
    const link = new CoopConnection(
      session,
      (message) => {
        if (message.type === "welcome" || message.type === "room") {
          setRoom(message.room);
          saveCoopSession({ ...session, room: message.room });
          if (message.room.phase === "running" || message.room.phase === "finished")
            setScreen("room");
        } else if (message.type === "snapshot") {
          setSnapshot(message);
          const events = message.events as CoopEvent[];
          for (const event of events) {
            if (event.type === "sound" && event.name !== "beamStart" && event.name !== "beamStop")
              audio.play(event.name);
            else if (event.type === "playerDisabled") audio.play("death");
            else if (event.type === "playerRevived") audio.play("levelup");
            else if (event.type === "overdriveActivated") audio.play("bossCharge");
          }
          const pilots = Object.values(message.state.players);
          const firingBeam = pilots.some((p) => !p.disabled && p.ship.beamOn);
          if (firingBeam !== beamActive) {
            audio.play(firingBeam ? "beamStart" : "beamStop");
            beamActive = firingBeam;
          }
          if (firingBeam)
            audio.beamHeat(
              Math.max(...pilots.filter((p) => p.ship.beamOn).map((p) => p.ship.heat)),
            );
        } else if (message.type === "error") {
          setNotice(message.message);
        }
      },
      setConnectionState,
    );
    connection.current = link;
    void link.connect();
    return () => {
      if (beamActive) audio.play("beamStop");
      link.close();
      if (connection.current === link) connection.current = null;
    };
  }, [session]);

  const run = useCallback(
    async (operation: () => Promise<CoopSession>) => {
      setPending(true);
      setNotice("");
      audio.unlock();
      try {
        enterSession(await operation());
      } catch (error) {
        if (error instanceof MultiplayerError && error.status === 401) {
          clearDeveloperSession();
          setDeveloperSession(null);
          setDeveloperNotice("Developer authorization expired. Enter the code again to host.");
        }
        setNotice(error instanceof Error ? error.message : "Online co-op request failed.");
        audio.play("overheat");
      } finally {
        setPending(false);
      }
    },
    [enterSession],
  );

  const authorizeHosting = async (event: FormEvent) => {
    event.preventDefault();
    if (developerPending) return;
    setDeveloperPending(true);
    setDeveloperNotice("");
    try {
      const next = await authenticateDeveloper(developerCode.trim());
      setDeveloperSession(next);
      setDeveloperCode("");
      setDeveloperNotice("Hosting unlocked for this developer session.");
      audio.play("levelup");
    } catch (error) {
      setDeveloperSession(null);
      setDeveloperNotice(error instanceof Error ? error.message : "Developer access was denied.");
      audio.play("overheat");
    } finally {
      setDeveloperPending(false);
    }
  };

  const loadRooms = useCallback(async (cursor = "") => {
    setPending(true);
    setNotice("");
    try {
      const page = await getPublicRooms(cursor);
      setPublicRooms((current) => (cursor ? [...current, ...page.rooms] : page.rooms));
      setNextCursor(page.nextCursor);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Public rooms are unavailable.");
    } finally {
      setPending(false);
    }
  }, []);

  const loadBoard = useCallback(async () => {
    setScreen("leaderboard");
    setPending(true);
    setNotice("");
    try {
      setBoard(await getCoopLeaderboard(0, 50));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Co-op records are unavailable.");
    } finally {
      setPending(false);
    }
  }, []);

  const sendCommand = useCallback((message: UiCommand) => {
    if (
      message.type === "heartbeat" ||
      message.type === "ready" ||
      message.type === "start" ||
      message.type === "leave"
    ) {
      return connection.current?.send(message) ?? false;
    }
    return (
      connection.current?.send({
        ...message,
        sequence: ++commandSequence.current,
      } as MultiplayerClientMessage) ?? false
    );
  }, []);

  const leave = useCallback(() => {
    if (
      room?.phase === "running" &&
      !window.confirm("Leave this co-op run? Your teammate will remain in the match.")
    )
      return;
    connection.current?.leave();
    clearCoopSession();
    setSession(null);
    setRoom(null);
    setSnapshot(null);
    setShopOpen(false);
    setConnectionState("closed");
    setScreen("home");
  }, [room?.phase]);

  const back = () => {
    if (session) leave();
    else if (screen === "home") onExit();
    else {
      setScreen("home");
      setNotice("");
    }
  };

  const recovered = loadCoopSession();
  const hostingUnlocked = Boolean(developerSession);
  const state = snapshot?.state ?? null;
  const me = session && state ? state.players[session.playerId] : null;
  const teammateId: CoopPlayerId | null = session
    ? session.playerId === "p1"
      ? "p2"
      : "p1"
    : null;
  const teammate = teammateId && state ? state.players[teammateId] : null;
  const bothReady = Boolean(room?.players.p1?.ready && room.players.p2?.ready);

  const reviveDistance = useMemo(() => {
    if (!me || !teammate) return Infinity;
    return Math.hypot(me.ship.x - teammate.ship.x, me.ship.y - teammate.ship.y);
  }, [me, teammate]);

  useEffect(() => {
    if (!state || (state.phase !== "running" && state.phase !== "bonusOffer")) {
      audio.setMusicOverride(null);
      return;
    }
    audio.setMusicOverride(
      state.boss?.mk === 6
        ? state.campaign?.boss?.mk6?.enraged
          ? "mk6Phase2"
          : "mk6"
        : state.boss
          ? "boss"
          : "flight",
    );
    return () => audio.setMusicOverride(null);
  }, [state?.boss?.mk, state?.campaign?.boss?.mk6?.enraged, state?.phase]);

  if (
    session &&
    room &&
    state &&
    me &&
    teammateId &&
    (room.phase === "running" || room.phase === "finished")
  ) {
    if (!state.campaign)
      return (
        <div className="coop-screen">
          <h2>Multiplayer update required</h2>
          <p>
            The game server is running an older version. Ask the server owner to update it, then
            reconnect.
          </p>
          <button onClick={back}>Back</button>
        </div>
      );
    const ended = state.phase === "victory" || state.phase === "defeat";
    return (
      <section className="coop-game" aria-label="Online cooperative match">
        <header className="coop-game-header">
          <div>
            <p className="deploy-eyebrow">Team score</p>
            <strong>{Math.floor(state.team.score).toLocaleString()}</strong>
          </div>
          <div className="coop-wave">
            <span>Wave {String(state.team.wave).padStart(2, "0")}</span>
            <small>
              Sector {state.team.sector} ·{" "}
              {state.team.directive ? directiveNames[state.team.directive] : "Stand by"}
            </small>
          </div>
          <div className={`coop-link is-${connectionState}`}>
            <Radio size={14} /> {statusLabel[connectionState]}
          </div>
          <button onClick={leave} className="coop-quiet-button">
            Leave
          </button>
        </header>
        <div className="coop-hud-row">
          <PilotHud name={me.callsign} playerId={session.playerId} player={me} local />
          <div className="coop-overdrive">
            <span>Shared overdrive</span>
            <div>
              <i style={{ width: `${state.team.overdrive}%` }} />
            </div>
            <button
              disabled={state.team.overdrive < 100 || ended}
              onClick={() => sendCommand({ type: "activateOverdrive" })}
            >
              {state.team.overdriveRemaining > 0
                ? `${state.team.overdriveRemaining.toFixed(1)}s`
                : "Activate · Q"}
            </button>
          </div>
          <PilotHud
            name={teammate?.callsign ?? "Teammate"}
            playerId={teammateId!}
            player={teammate}
          />
        </div>
        {snapshot && (
          <CoopArena
            snapshot={snapshot}
            playerId={session.playerId}
            send={(message) => connection.current?.send(message) ?? false}
            onOverdrive={() => sendCommand({ type: "activateOverdrive" })}
            active={state.phase === "running"}
          />
        )}
        <div className="coop-game-actions">
          <span>WASD move · Pointer aim/fire · E missile · F hold to revive</span>
          {teammate?.disabled && !me.disabled && (
            <strong className={reviveDistance <= 92 ? "is-close" : ""}>
              {reviveDistance <= 92
                ? `Hold F · Reviving ${Math.round(teammate.reviveProgress / 0.03)}%`
                : "Move close to revive your teammate"}
            </strong>
          )}
          <button onClick={() => setShopOpen(true)}>Loadout · {me.credits} CR</button>
        </div>
        {state.phase === "bonusOffer" && (
          <div className="coop-modal">
            <div>
              <p className="deploy-eyebrow">Bonus encounter</p>
              <h2>THE METEOR AWAITS</h2>
              <p>Either pilot may commit the team to MK6, or bank the completed campaign.</p>
              <button onClick={() => sendCommand({ type: "startBonusBoss" })}>Face MK6</button>
              <button onClick={() => sendCommand({ type: "declineBonusBoss" })}>Finish run</button>
            </div>
          </div>
        )}
        {shopOpen && me && (
          <CoopShop player={me} onClose={() => setShopOpen(false)} send={sendCommand} />
        )}
        {ended && (
          <div className="coop-modal">
            <div className="coop-results">
              <p className="deploy-eyebrow">Authoritative flight record finalized</p>
              <h2>{state.phase === "victory" ? "CO-OP VICTORY" : "SIGNAL LOST"}</h2>
              <dl>
                <div>
                  <dt>Team score</dt>
                  <dd>{Math.floor(state.team.score).toLocaleString()}</dd>
                </div>
                <div>
                  <dt>Highest wave</dt>
                  <dd>{state.team.wave}</dd>
                </div>
                <div>
                  <dt>Survival</dt>
                  <dd>{duration(state.team.elapsedSeconds)}</dd>
                </div>
                <div>
                  <dt>Bosses</dt>
                  <dd>{state.team.bossesDefeated}</dd>
                </div>
                <div>
                  <dt>{me.callsign} damage</dt>
                  <dd>{Math.floor(me.stats.damage).toLocaleString()}</dd>
                </div>
                <div>
                  <dt>{teammate?.callsign} revives</dt>
                  <dd>{teammate?.stats.revives ?? 0}</dd>
                </div>
              </dl>
              <button onClick={leave}>Return to flight deck</button>
            </div>
          </div>
        )}
      </section>
    );
  }

  return (
    <section className="coop-menu" aria-label="Online co-op deployment">
      <div className="coop-menu-bar">
        <button onClick={back}>
          <ArrowLeft size={18} /> Back
        </button>
        <span>
          <Users size={18} /> Online co-op
        </span>
        {session && (
          <span className={`coop-link is-${connectionState}`}>
            <Radio size={13} /> {statusLabel[connectionState]}
          </span>
        )}
      </div>
      {!configured ? (
        <div className="coop-empty">
          <Radio size={42} />
          <h2>CO-OP RELAY NOT CONFIGURED</h2>
          <p>Set VITE_MULTIPLAYER_URL to the multiplayer Worker API before publishing this mode.</p>
          <button onClick={onExit}>Return to modes</button>
        </div>
      ) : session && room ? (
        <ReadyRoom
          room={room}
          playerId={session.playerId}
          connectionState={connectionState}
          notice={notice}
          onReady={(ready) => sendCommand({ type: "ready", ready })}
          onStart={() => sendCommand({ type: "start" })}
          onLeave={leave}
          bothReady={bothReady}
        />
      ) : screen === "home" ? (
        <div className="coop-home">
          <div className="coop-home-copy">
            <p className="deploy-eyebrow">Two pilots / one authoritative campaign</p>
            <h1>
              FLY TOGETHER.
              <br />
              <span>SURVIVE THE DRIFT.</span>
            </h1>
            <p>Separate loadouts. Shared waves, Overdrive, directives and victory.</p>
            <div className={`coop-host-gate${hostingUnlocked ? " is-unlocked" : ""}`}>
              {hostingUnlocked ? (
                <>
                  <strong>Developer hosting unlocked</strong>
                  <span>You can create private or public rooms during the closed alpha.</span>
                </>
              ) : (
                <form onSubmit={authorizeHosting}>
                  <label htmlFor="coop-developer-code">Developer code to host</label>
                  <div>
                    <input
                      id="coop-developer-code"
                      type="password"
                      value={developerCode}
                      maxLength={256}
                      required
                      autoComplete="current-password"
                      disabled={developerPending || !isLeaderboardConfigured()}
                      onChange={(event) => setDeveloperCode(event.target.value)}
                    />
                    <button disabled={developerPending || !isLeaderboardConfigured()}>
                      {developerPending ? "Checking…" : "Unlock hosting"}
                    </button>
                  </div>
                  <span>
                    Creating rooms is developer-only for now. Anyone can browse, join, or reconnect.
                  </span>
                </form>
              )}
              {developerNotice && <small role="status">{developerNotice}</small>}
            </div>
            {recovered && (
              <button className="coop-recover" onClick={() => enterSession(recovered)}>
                Reconnect to {recovered.roomCode} <Radio size={16} />
              </button>
            )}
          </div>
          <div className="coop-actions-grid">
            <button
              onClick={() =>
                void run(() => createPrivateRoom(callsign, developerSession?.token ?? ""))
              }
              disabled={pending || !hostingUnlocked}
            >
              <Shield /> <strong>Create private</strong>
              <span>
                {hostingUnlocked ? "Share a six-character code" : "Developer code required"}
              </span>
            </button>
            <button onClick={() => setScreen("create")} disabled={pending || !hostingUnlocked}>
              <Users /> <strong>Create public</strong>
              <span>
                {hostingUnlocked ? "List a named waiting room" : "Developer code required"}
              </span>
            </button>
            <button
              onClick={() => {
                setScreen("browse");
                void loadRooms();
              }}
              disabled={pending}
            >
              <Radio /> <strong>Browse rooms</strong>
              <span>Choose an open patrol</span>
            </button>
            <button onClick={() => void run(() => quickJoinRoom(callsign))} disabled={pending}>
              <ArrowRight /> <strong>Quick join</strong>
              <span>Claim the oldest open slot</span>
            </button>
            <button onClick={() => setScreen("join")} disabled={pending}>
              <span className="coop-code-icon">#</span>
              <strong>Join by code</strong>
              <span>Enter a private room code</span>
            </button>
            <button
              onClick={() => void loadBoard()}
              disabled={!isLeaderboardConfigured() || pending}
            >
              <span className="coop-code-icon">★</span>
              <strong>Co-op records</strong>
              <span>Authoritative team results</span>
            </button>
          </div>
        </div>
      ) : screen === "create" ? (
        <CoopForm
          title="Create public room"
          notice={notice}
          pending={pending}
          onSubmit={(event) => {
            event.preventDefault();
            void run(() => createPublicRoom(callsign, roomName, developerSession?.token ?? ""));
          }}
        >
          <label>
            Room name
            <input
              value={roomName}
              minLength={3}
              maxLength={32}
              required
              onChange={(event) => setRoomName(event.target.value)}
            />
          </label>
          <button disabled={pending}>
            Open public room <ArrowRight size={18} />
          </button>
        </CoopForm>
      ) : screen === "join" ? (
        <CoopForm
          title="Join by room code"
          notice={notice}
          pending={pending}
          onSubmit={(event) => {
            event.preventDefault();
            void run(() => joinRoom(callsign, roomCode));
          }}
        >
          <label>
            Six-character code
            <input
              className="coop-code-input"
              value={roomCode}
              minLength={6}
              maxLength={6}
              required
              pattern="[23456789A-HJ-NP-Z]{6}"
              onChange={(event) => setRoomCode(event.target.value.toUpperCase())}
            />
          </label>
          <button disabled={pending}>
            Join room <ArrowRight size={18} />
          </button>
        </CoopForm>
      ) : screen === "browse" ? (
        <div className="coop-browser">
          <div className="coop-section-title">
            <div>
              <p className="deploy-eyebrow">Public relay</p>
              <h2>OPEN PATROLS</h2>
            </div>
            <button onClick={() => void loadRooms()} disabled={pending}>
              <RefreshCw size={16} /> Refresh
            </button>
          </div>
          {notice && (
            <p className="coop-notice" role="status">
              {notice}
            </p>
          )}
          <div className="coop-room-list">
            {publicRooms.map((listed) => (
              <button
                key={listed.code}
                disabled={!listed.joinable || pending}
                onClick={() => void run(() => joinRoom(callsign, listed.code))}
              >
                <span>
                  <strong>{listed.name}</strong>
                  <small>{listed.code}</small>
                </span>
                <span>
                  {listed.playerCount}/{listed.capacity} pilots
                </span>
                <span>
                  {listed.joinable ? "Join" : "Full"} <ArrowRight size={16} />
                </span>
              </button>
            ))}
            {!pending && !publicRooms.length && (
              <p>No public patrols are waiting. Create one or try Quick Join later.</p>
            )}
          </div>
          {nextCursor && (
            <button
              className="coop-load-more"
              onClick={() => void loadRooms(nextCursor)}
              disabled={pending}
            >
              Load more
            </button>
          )}
        </div>
      ) : (
        <CoopBoard
          page={board}
          notice={notice}
          pending={pending}
          onRefresh={() => void loadBoard()}
        />
      )}
      {notice && screen !== "browse" && screen !== "leaderboard" && (
        <p className="coop-notice" role="status">
          {notice}
        </p>
      )}
    </section>
  );
}

function PilotHud({
  name,
  playerId,
  player,
  local = false,
}: {
  name: string;
  playerId: CoopPlayerId;
  player: AuthoritativeSnapshot["state"]["players"][CoopPlayerId] | null;
  local?: boolean;
}) {
  const hull = player ? Math.max(0, (player.ship.hull / player.ship.maxHull) * 100) : 0;
  return (
    <div className={`coop-pilot-hud coop-pilot-${playerId}`}>
      <span>
        {local ? "You" : "Teammate"} · {name}
      </span>
      <div>
        <i style={{ width: `${hull}%` }} />
      </div>
      <small>
        {player?.disabled ? "Disabled" : `${Math.ceil(player?.ship.hull ?? 0)} hull`} · LVL{" "}
        {player?.level ?? 1}
      </small>
    </div>
  );
}

function ReadyRoom({
  room,
  playerId,
  connectionState,
  notice,
  onReady,
  onStart,
  onLeave,
  bothReady,
}: {
  room: MultiplayerRoomView;
  playerId: CoopPlayerId;
  connectionState: CoopConnectionState;
  notice: string;
  onReady: (ready: boolean) => void;
  onStart: () => void;
  onLeave: () => void;
  bothReady: boolean;
}) {
  const current = room.players[playerId];
  return (
    <div className="coop-ready">
      <p className="deploy-eyebrow">{room.visibility} room / waiting for launch</p>
      <h1>{room.name ?? "PRIVATE PATROL"}</h1>
      <div className="coop-room-code">
        <span>Room code</span>
        <strong>{room.code}</strong>
        <button onClick={() => void navigator.clipboard?.writeText(room.code)}>Copy</button>
      </div>
      <div className="coop-ready-pilots">
        {(["p1", "p2"] as const).map((id) => {
          const pilot = room.players[id];
          return (
            <div key={id} className={`coop-ready-pilot coop-pilot-${id}`}>
              <span>Pilot {id === "p1" ? "01" : "02"}</span>
              <strong>{pilot?.callsign ?? "Awaiting signal…"}</strong>
              <small>
                {pilot
                  ? `${pilot.connected ? "Connected" : "Reconnecting"} · ${pilot.ready ? "Ready" : "Not ready"}`
                  : "Open slot"}
              </small>
            </div>
          );
        })}
      </div>
      {notice && <p className="coop-notice">{notice}</p>}
      <div className="coop-ready-actions">
        <button
          className="primary"
          disabled={!current || connectionState !== "connected"}
          onClick={() => onReady(!current?.ready)}
        >
          {current?.ready ? "Stand down" : "Ready up"}
        </button>
        <button disabled={!bothReady || connectionState !== "connected"} onClick={onStart}>
          Start match <ArrowRight size={18} />
        </button>
        <button onClick={onLeave}>Leave room</button>
      </div>
      <p className="coop-help">Either ready pilot may launch once both signals are green.</p>
    </div>
  );
}

function CoopForm({
  title,
  notice,
  pending,
  onSubmit,
  children,
}: {
  title: string;
  notice: string;
  pending: boolean;
  onSubmit: (event: FormEvent) => void;
  children: ReactNode;
}) {
  return (
    <form className="coop-form" onSubmit={onSubmit}>
      <p className="deploy-eyebrow">Co-op relay</p>
      <h2>{title}</h2>
      {children}
      {notice && <p className="coop-notice">{notice}</p>}
      {pending && <p className="coop-help">Contacting relay…</p>}
    </form>
  );
}

function CoopBoard({
  page,
  notice,
  pending,
  onRefresh,
}: {
  page: CoopLeaderboardPage | null;
  notice: string;
  pending: boolean;
  onRefresh: () => void;
}) {
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
      {notice && <p className="coop-notice">{notice}</p>}
      <div className="coop-board-head">
        <span>Rank / team</span>
        <span>Progress</span>
        <span>Score</span>
        <span>Time</span>
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
          </span>
        </div>
      ))}
      {!pending && !page?.entries.length && (
        <p className="coop-help">No authoritative co-op results have been recorded yet.</p>
      )}
    </div>
  );
}

function CoopShop({
  player,
  onClose,
  send,
}: {
  player: AuthoritativeSnapshot["state"]["players"][CoopPlayerId];
  onClose: () => void;
  send: (message: UiCommand) => boolean;
}) {
  return (
    <div className="coop-modal">
      <div className="coop-shop">
        <div className="coop-section-title">
          <div>
            <p className="deploy-eyebrow">Personal credits · {player.credits} CR</p>
            <h2>CO-OP LOADOUT</h2>
          </div>
          <button onClick={onClose}>Close</button>
        </div>
        <h3>Weapons</h3>
        <div className="coop-shop-grid">
          {WEAPON_ORDER.map((id) => {
            const level = player.ship.weapons[id];
            const price = weaponPrice(player.ship, id);
            return (
              <div className="coop-shop-card" key={id}>
                <strong>{WEAPON_DEFS[id].short}</strong>
                <span>{level ? `Level ${level}/${weaponMaxLevel(id)}` : "Not owned"}</span>
                <div>
                  <button
                    disabled={!level || player.ship.primary === id}
                    onClick={() => send({ type: "selectWeapon", weapon: id })}
                  >
                    {player.ship.primary === id ? "Equipped" : "Equip"}
                  </button>
                  <button
                    disabled={price === null || player.credits < price}
                    onClick={() => send({ type: "buyWeapon", weapon: id })}
                  >
                    {price === null ? "Max" : `${level ? "Upgrade" : "Acquire"} · ${price}`}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
        {player.upgradePoints > 0 && (
          <>
            <h3>Upgrade points · {player.upgradePoints}</h3>
            <div className="coop-shop-grid">
              {(player.campaign?.choices ?? []).map((upgrade) => (
                <button
                  key={upgrade.id}
                  onClick={() => send({ type: "chooseUpgrade", upgrade: upgrade.id })}
                >
                  <strong>{upgrade.name}</strong>
                  <span>{upgrade.desc}</span>
                  <small>
                    {upgrade.rarity} · {player.upgrades[upgrade.id] ?? 0}/
                    {STAT_UPGRADES.find((entry) => entry.id === upgrade.id)?.max}
                  </small>
                </button>
              ))}
            </div>
            <button
              disabled={player.credits < (player.campaign?.rerollCost ?? Infinity)}
              onClick={() => send({ type: "rerollUpgrades" })}
            >
              Reroll · {player.campaign?.rerollCost ?? 0} CR
            </button>
          </>
        )}
        <h3>Salvage drone</h3>
        {!player.drone.purchased ? (
          <button className="coop-shop-wide" onClick={() => send({ type: "buyDrone" })}>
            Deploy salvage drone · {SALVAGE_BASE_PRICE} CR
          </button>
        ) : (
          <div className="coop-shop-grid">
            {SALVAGE_UPGRADE_ORDER.map((id: SalvageUpgradeId) => (
              <button
                key={id}
                disabled={
                  player.drone.upgrades[id] >= SALVAGE_UPGRADES[id].max ||
                  player.credits < (salvageUpgradePrice(player.drone, id) ?? Infinity)
                }
                onClick={() => send({ type: "buyDroneUpgrade", upgrade: id })}
              >
                <strong>{SALVAGE_UPGRADES[id].name}</strong>
                <span>{SALVAGE_UPGRADES[id].desc}</span>
                <small>
                  {player.drone.upgrades[id]}/{SALVAGE_UPGRADES[id].max} ·{" "}
                  {salvageUpgradePrice(player.drone, id) ?? "MAX"} CR
                </small>
              </button>
            ))}
          </div>
        )}
        {player.drone.purchased && (
          <>
            <h3>Drone weapon mount</h3>
            <div className="coop-drone-mounts">
              <button onClick={() => send({ type: "equipDroneWeapon", weapon: null })}>
                Unarmed
              </button>
              {WEAPON_ORDER.filter((id) => player.ship.weapons[id] > 0).map((id) => (
                <button
                  key={id}
                  disabled={player.drone.weapon === id}
                  onClick={() => send({ type: "equipDroneWeapon", weapon: id })}
                >
                  {WEAPON_DEFS[id].short}
                  {player.drone.weapon === id ? " · Mounted" : ""}
                </button>
              ))}
            </div>
          </>
        )}
        <p className="coop-help">
          Purchases are accepted only after server validation. Combat continues while this panel is
          open.
        </p>
      </div>
    </div>
  );
}

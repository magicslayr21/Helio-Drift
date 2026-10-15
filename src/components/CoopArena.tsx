import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { ClientPrediction, SnapshotInterpolator } from "../game/network/client-sync";
import type { AuthoritativeSnapshot, ClientInputMessage } from "../game/network/protocol";
import type { CoopPlayerId } from "../game/simulation/coop-types";
import { COOP_CONFIG } from "../game/simulation/coop-config";
import { CoopRenderer } from "../game/coop-renderer";
import { CampaignBanner } from "./CampaignBanner";
import type { FlightSettings } from "../game/preferences";

const WIDTH = COOP_CONFIG.arena.width;
const HEIGHT = COOP_CONFIG.arena.height;

export function CoopArena({
  snapshot,
  playerId,
  send,
  onOverdrive,
  active = true,
  settings,
}: {
  snapshot: AuthoritativeSnapshot;
  playerId: CoopPlayerId;
  send: (message: ClientInputMessage) => boolean;
  onOverdrive: () => void;
  active?: boolean;
  settings: FlightSettings;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<CoopRenderer | null>(null);
  const prediction = useRef(new ClientPrediction(playerId, WIDTH, HEIGHT));
  const interpolation = useRef(new SnapshotInterpolator());
  const latest = useRef(snapshot);
  const receivedAt = useRef(performance.now());
  const keys = useRef(new Set<string>());
  const aim = useRef(snapshot.state.players[playerId].ship.angle);
  const firing = useRef(false);
  const missile = useRef(false);
  const touchMove = useRef({ x: 0, y: 0 });
  const sampledAt = useRef(performance.now());
  const handlers = useRef({ send, onOverdrive, active, settings });
  handlers.current = { send, onOverdrive, active, settings };

  useEffect(() => {
    keys.current.clear();
    firing.current = false;
    missile.current = false;
    touchMove.current = { x: 0, y: 0 };
    if (active) canvasRef.current?.focus({ preventScroll: true });
    else
      handlers.current.send(
        prediction.current.sample({
          moveX: 0,
          moveY: 0,
          aimAngle: aim.current,
          fire: false,
          missile: false,
          interact: false,
        }),
      );
  }, [active]);

  useEffect(() => {
    latest.current = snapshot;
    receivedAt.current = performance.now();
    interpolation.current.push(snapshot);
    prediction.current.reconcile(snapshot);
  }, [snapshot]);

  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (!handlers.current.active) return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) ||
          target.isContentEditable ||
          Boolean(target.closest("[data-developer-console]")))
      )
        return;
      // Preserve keyboard activation of UI buttons without swallowing flight keys.
      if (target?.closest("button, a") && ["Space", "Enter", "Tab"].includes(event.code)) return;
      keys.current.add(event.code);
      if (event.code === "KeyE" && !event.repeat) missile.current = true;
      if (event.code === "KeyQ" && !event.repeat) handlers.current.onOverdrive();
      if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.code))
        event.preventDefault();
    };
    const up = (event: KeyboardEvent) => keys.current.delete(event.code);
    const clear = () => {
      keys.current.clear();
      firing.current = false;
      missile.current = false;
      touchMove.current = { x: 0, y: 0 };
    };
    // Deploy's modal stops bubbling keys to protect the underlying campaign.
    // Handle flight in capture phase, before that boundary consumes the event.
    window.addEventListener("keydown", down, true);
    window.addEventListener("keyup", up, true);
    window.addEventListener("blur", clear);
    return () => {
      window.removeEventListener("keydown", down, true);
      window.removeEventListener("keyup", up, true);
      window.removeEventListener("blur", clear);
    };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (!handlers.current.active) return;
      const pressed = keys.current;
      let moveX =
        touchMove.current.x +
        Number(pressed.has("KeyD") || pressed.has("ArrowRight")) -
        Number(pressed.has("KeyA") || pressed.has("ArrowLeft"));
      let moveY =
        touchMove.current.y +
        Number(pressed.has("KeyS") || pressed.has("ArrowDown")) -
        Number(pressed.has("KeyW") || pressed.has("ArrowUp"));
      const preferences = handlers.current.settings;
      const touchMoving = touchMove.current.x !== 0 || touchMove.current.y !== 0;
      if (preferences.legacyMovement && !touchMoving) {
        aim.current += moveX * 0.1;
        const thrust = pressed.has("KeyW") || pressed.has("ArrowUp") ? 1 : 0;
        moveX = Math.cos(aim.current) * thrust;
        moveY = Math.sin(aim.current) * thrust;
      } else if (preferences.mouseControl && !touchMoving) {
        moveX = Math.cos(aim.current) * Number(firing.current);
        moveY = Math.sin(aim.current) * Number(firing.current);
      }
      const message = prediction.current.sample({
        moveX,
        moveY,
        aimAngle: aim.current,
        fire:
          preferences.autoFire ||
          preferences.trackpad ||
          (!preferences.mouseControl && firing.current) ||
          pressed.has("Space"),
        missile: missile.current,
        interact: pressed.has("KeyF") || pressed.has("KeyR"),
      });
      sampledAt.current = performance.now();
      missile.current = false;
      handlers.current.send(message);
    }, 1000 / 30);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let frame = 0;
    if (!canvasRef.current) return;
    const renderer = new CoopRenderer(canvasRef.current);
    rendererRef.current = renderer;
    let pausedSnapshot: AuthoritativeSnapshot | null = null;
    let renderedSettings = handlers.current.settings;
    const resize = () => {
      renderer.resizeDisplay();
      pausedSnapshot = null;
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvasRef.current.parentElement!);
    window.addEventListener("resize", resize);
    let displayDensity = window.devicePixelRatio || 1;
    renderer.resizeDisplay();
    let renderTick: number | null = null;
    let renderedAt = performance.now();
    const render = () => {
      renderer.settings = handlers.current.settings;
      if (renderedSettings !== renderer.settings) {
        renderedSettings = renderer.settings;
        pausedSnapshot = null;
      }
      // Monitor/zoom changes can update DPR without firing resize or media events.
      // This inexpensive scalar check also refreshes a paused canvas after a switch.
      if (displayDensity !== (window.devicePixelRatio || 1)) {
        displayDensity = window.devicePixelRatio || 1;
        resize();
      }
      if (latest.current.pause && pausedSnapshot === latest.current) {
        frame = requestAnimationFrame(render);
        return;
      }
      pausedSnapshot = latest.current.pause ? latest.current : null;
      const context = canvasRef.current?.getContext("2d");
      if (context) {
        const now = performance.now();
        const dt = Math.min(0.1, (now - renderedAt) / 1000);
        renderedAt = now;
        const elapsedTicks = Math.min(3, ((now - receivedAt.current) / 1000) * 30);
        const targetTick = latest.current.serverTick - 3 + elapsedTicks;
        // Keep a continuous presentation clock instead of jumping on every packet arrival.
        if (renderTick === null || Math.abs(targetTick - renderTick) > 9) renderTick = targetTick;
        else
          renderTick = Math.min(
            latest.current.serverTick,
            renderTick + dt * 30 + Math.max(-1, Math.min(1, targetTick - renderTick)) * dt * 3,
          );
        if (latest.current.pause) renderTick = latest.current.serverTick;
        const state = interpolation.current.sample(renderTick) ?? latest.current.state;
        renderer.draw(
          state,
          playerId,
          prediction.current.renderShip((performance.now() - sampledAt.current) / 1000),
        );
      }
      frame = requestAnimationFrame(render);
    };
    frame = requestAnimationFrame(render);
    return () => {
      rendererRef.current = null;
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", resize);
    };
  }, [playerId]);

  const point = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (handlers.current.settings.legacyMovement) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const point = rendererRef.current?.worldPoint(
      event.clientX - rect.left,
      event.clientY - rect.top,
    ) ?? { x: 0, y: 0 };
    const { x, y } = point;
    const ship = prediction.current.ship ?? latest.current.state.players[playerId].ship;
    aim.current = Math.atan2(y - ship.y, x - ship.x);
  };
  const moveButton = (x: number, y: number) => ({
    onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (!handlers.current.active) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      touchMove.current = { x, y };
    },
    onPointerUp: () => (touchMove.current = { x: 0, y: 0 }),
    onPointerCancel: () => (touchMove.current = { x: 0, y: 0 }),
    onLostPointerCapture: () => (touchMove.current = { x: 0, y: 0 }),
  });

  return (
    <div className="coop-arena-shell">
      <canvas
        ref={canvasRef}
        width={WIDTH}
        height={HEIGHT}
        className="coop-arena"
        tabIndex={0}
        aria-label="Online cooperative Helios Drift arena"
        onPointerMove={point}
        onPointerDown={(event) => {
          if (!handlers.current.active) return;
          event.currentTarget.focus({ preventScroll: true });
          point(event);
          firing.current = true;
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerUp={(event) => {
          firing.current = false;
          event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onPointerCancel={() => (firing.current = false)}
      />
      <CampaignBanner
        banner={snapshot.state.campaign?.banner ?? ""}
        subtitle={snapshot.state.campaign?.bannerSub ?? ""}
        visible={snapshot.state.phase === "running" && (snapshot.state.campaign?.bannerT ?? 0) > 0}
      />
      <div className="coop-touch-controls" aria-label="Touch flight controls">
        <div className="coop-touch-move">
          <button {...moveButton(0, -1)} aria-label="Move up">
            ▲
          </button>
          <button {...moveButton(-1, 0)} aria-label="Move left">
            ◀
          </button>
          <button {...moveButton(1, 0)} aria-label="Move right">
            ▶
          </button>
          <button {...moveButton(0, 1)} aria-label="Move down">
            ▼
          </button>
        </div>
        <button
          className="coop-touch-fire"
          onPointerDown={() => (firing.current = true)}
          onPointerUp={() => (firing.current = false)}
          onPointerCancel={() => (firing.current = false)}
        >
          Fire
        </button>
      </div>
    </div>
  );
}

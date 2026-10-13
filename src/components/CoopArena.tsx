import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { ClientPrediction, SnapshotInterpolator } from "../game/network/client-sync";
import type { AuthoritativeSnapshot, ClientInputMessage } from "../game/network/protocol";
import type { CoopPlayerId } from "../game/simulation/coop-types";
import { CoopRenderer } from "../game/coop-renderer";
import { CampaignBanner } from "./CampaignBanner";

const WIDTH = 1000;
const HEIGHT = 700;

export function CoopArena({
  snapshot,
  playerId,
  send,
  onOverdrive,
  active = true,
}: {
  snapshot: AuthoritativeSnapshot;
  playerId: CoopPlayerId;
  send: (message: ClientInputMessage) => boolean;
  onOverdrive: () => void;
  active?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const prediction = useRef(new ClientPrediction(playerId, WIDTH, HEIGHT));
  const interpolation = useRef(new SnapshotInterpolator());
  const latest = useRef(snapshot);
  const receivedAt = useRef(performance.now());
  const keys = useRef(new Set<string>());
  const aim = useRef(snapshot.state.players[playerId].ship.angle);
  const firing = useRef(false);
  const missile = useRef(false);
  const touchMove = useRef({ x: 0, y: 0 });

  useEffect(() => {
    latest.current = snapshot;
    receivedAt.current = performance.now();
    interpolation.current.push(snapshot);
    prediction.current.reconcile(snapshot);
  }, [snapshot]);

  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (["INPUT", "BUTTON", "TEXTAREA"].includes((event.target as HTMLElement)?.tagName)) return;
      keys.current.add(event.code);
      if (event.code === "KeyE" && !event.repeat) missile.current = true;
      if (event.code === "KeyQ") onOverdrive();
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
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", clear);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", clear);
    };
  }, [onOverdrive]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (!active) return;
      const pressed = keys.current;
      const moveX =
        touchMove.current.x +
        Number(pressed.has("KeyD") || pressed.has("ArrowRight")) -
        Number(pressed.has("KeyA") || pressed.has("ArrowLeft"));
      const moveY =
        touchMove.current.y +
        Number(pressed.has("KeyS") || pressed.has("ArrowDown")) -
        Number(pressed.has("KeyW") || pressed.has("ArrowUp"));
      const message = prediction.current.sample({
        moveX,
        moveY,
        aimAngle: aim.current,
        fire: firing.current || pressed.has("Space"),
        missile: missile.current,
        interact: pressed.has("KeyF") || pressed.has("KeyR"),
      });
      missile.current = false;
      send(message);
    }, 1000 / 30);
    return () => window.clearInterval(timer);
  }, [active, send]);

  useEffect(() => {
    let frame = 0;
    if (!canvasRef.current) return;
    const renderer = new CoopRenderer(canvasRef.current);
    const render = () => {
      const context = canvasRef.current?.getContext("2d");
      if (context) {
        const elapsedTicks = Math.min(2, ((performance.now() - receivedAt.current) / 1000) * 30);
        const state =
          interpolation.current.sample(latest.current.serverTick - 2 + elapsedTicks) ??
          latest.current.state;
        renderer.draw(state, playerId, prediction.current.ship);
      }
      frame = requestAnimationFrame(render);
    };
    frame = requestAnimationFrame(render);
    return () => cancelAnimationFrame(frame);
  }, [playerId]);

  const point = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * WIDTH;
    const y = ((event.clientY - rect.top) / rect.height) * HEIGHT;
    const ship = prediction.current.ship ?? latest.current.state.players[playerId].ship;
    aim.current = Math.atan2(y - ship.y, x - ship.x);
  };
  const moveButton = (x: number, y: number) => ({
    onPointerDown: () => (touchMove.current = { x, y }),
    onPointerUp: () => (touchMove.current = { x: 0, y: 0 }),
    onPointerCancel: () => (touchMove.current = { x: 0, y: 0 }),
  });

  return (
    <div className="coop-arena-shell">
      <canvas
        ref={canvasRef}
        width={WIDTH}
        height={HEIGHT}
        className="coop-arena"
        aria-label="Online cooperative Helios Drift arena"
        onPointerMove={point}
        onPointerDown={(event) => {
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

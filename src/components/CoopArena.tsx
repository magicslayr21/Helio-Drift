import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { ClientPrediction, SnapshotInterpolator } from "../game/network/client-sync";
import type { AuthoritativeSnapshot, ClientInputMessage } from "../game/network/protocol";
import type { CoopPlayerId } from "../game/simulation/coop-types";
import type { CoopWireState } from "../game/network/wire-state";

const WIDTH = 1000;
const HEIGHT = 700;
const PLAYER_ACCENTS: Record<CoopPlayerId, string> = { p1: "#ffb03a", p2: "#6fe7ff" };

function polygon(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  sides: number,
  rotation = 0,
) {
  context.beginPath();
  for (let index = 0; index < sides; index++) {
    const angle = rotation + (index / sides) * Math.PI * 2;
    const px = x + Math.cos(angle) * radius;
    const py = y + Math.sin(angle) * radius;
    if (index === 0) context.moveTo(px, py);
    else context.lineTo(px, py);
  }
  context.closePath();
}

function drawShip(
  context: CanvasRenderingContext2D,
  player: CoopWireState["players"][CoopPlayerId],
  accent: string,
  local: boolean,
) {
  const { ship } = player;
  context.save();
  context.translate(ship.x, ship.y);
  context.rotate(ship.angle + Math.PI / 2);
  context.strokeStyle = player.disabled ? "#596170" : accent;
  context.fillStyle = player.disabled ? "#252a35" : `${accent}24`;
  context.lineWidth = local ? 3 : 2;
  context.shadowColor = accent;
  context.shadowBlur = player.disabled ? 0 : local ? 14 : 8;
  context.beginPath();
  context.moveTo(0, -20);
  context.lineTo(14, 17);
  context.lineTo(0, 11);
  context.lineTo(-14, 17);
  context.closePath();
  context.fill();
  context.stroke();
  if (ship.thrusting && !player.disabled) {
    context.beginPath();
    context.moveTo(-6, 15);
    context.lineTo(0, 28 + Math.random() * 4);
    context.lineTo(6, 15);
    context.strokeStyle = "#ffe0a3";
    context.stroke();
  }
  context.restore();
  if (player.disabled) {
    context.strokeStyle = "#ff3d6e";
    context.lineWidth = 2;
    context.setLineDash([6, 5]);
    context.beginPath();
    context.arc(ship.x, ship.y, 38, 0, Math.PI * 2);
    context.stroke();
    context.setLineDash([]);
  }
}

function drawState(
  context: CanvasRenderingContext2D,
  state: CoopWireState,
  playerId: CoopPlayerId,
  predicted: CoopWireState["players"][CoopPlayerId]["ship"] | null,
) {
  context.clearRect(0, 0, WIDTH, HEIGHT);
  const gradient = context.createRadialGradient(500, 350, 40, 500, 350, 650);
  gradient.addColorStop(0, "rgba(27,35,54,.35)");
  gradient.addColorStop(1, "rgba(3,5,12,.92)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, WIDTH, HEIGHT);
  context.strokeStyle = "rgba(111,231,255,.055)";
  context.lineWidth = 1;
  for (let x = 0; x <= WIDTH; x += 50) {
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x, HEIGHT);
    context.stroke();
  }
  for (let y = 0; y <= HEIGHT; y += 50) {
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(WIDTH, y);
    context.stroke();
  }

  for (const tether of state.tethers) {
    const source = state.enemies.find((enemy) => enemy.id === tether.sourceId);
    const target = state.players[tether.targetPlayerId].ship;
    if (!source) continue;
    context.strokeStyle = "rgba(255,61,110,.7)";
    context.setLineDash([8, 6]);
    context.beginPath();
    context.moveTo(source.x, source.y);
    context.lineTo(target.x, target.y);
    context.stroke();
    context.setLineDash([]);
  }
  for (const hazard of state.hazards) {
    context.strokeStyle = hazard.kind === "singularity" ? "#b76cff" : "#ff6b3d";
    context.globalAlpha = 0.55;
    context.lineWidth = 3;
    context.beginPath();
    context.arc(hazard.x, hazard.y, hazard.radius, 0, Math.PI * 2);
    context.stroke();
    context.globalAlpha = 1;
  }
  for (const rock of state.rocks) {
    const color =
      rock.trait === "boom"
        ? "#ff6b3d"
        : rock.trait === "homing"
          ? "#ff3d6e"
          : rock.trait === "fast"
            ? "#6fe7ff"
            : "#a58b69";
    context.strokeStyle = color;
    context.fillStyle = `${color}18`;
    context.lineWidth = 2;
    polygon(context, rock.x, rock.y, rock.radius, 7, rock.id);
    context.fill();
    context.stroke();
  }
  for (const mine of state.mines) {
    context.strokeStyle = mine.armTimer > 0 ? "#ffb03a" : "#ff3d6e";
    context.lineWidth = 2;
    polygon(context, mine.x, mine.y, mine.radius, 8, Math.PI / 8);
    context.stroke();
    if (mine.triggerTimer > 0) {
      context.globalAlpha = 0.25;
      context.beginPath();
      context.arc(mine.x, mine.y, mine.blastRadius, 0, Math.PI * 2);
      context.stroke();
      context.globalAlpha = 1;
    }
  }
  for (const enemy of state.enemies) {
    const spiky = enemy.kind === "spiker" || enemy.kind === "tetherSentinel";
    context.strokeStyle = enemy.warningTimer > 0 ? "#ffe0a3" : "#ff3d6e";
    context.fillStyle = "rgba(255,61,110,.1)";
    context.lineWidth = 2;
    polygon(context, enemy.x, enemy.y, enemy.radius, spiky ? 10 : 6, enemy.angle);
    context.fill();
    context.stroke();
  }
  if (state.boss) {
    const boss = state.boss;
    context.strokeStyle = "#ffb03a";
    context.fillStyle = "rgba(255,176,58,.12)";
    context.lineWidth = 5;
    polygon(context, boss.x, boss.y, boss.radius, 12, state.tick / 90);
    context.fill();
    context.stroke();
  }
  for (const pickup of state.pickups) {
    context.fillStyle = pickup.kind === "repair" ? "#64ff9b" : "#ffb03a";
    context.fillRect(pickup.x - 5, pickup.y - 5, 10, 10);
  }
  for (const projectile of state.projectiles) {
    context.fillStyle = PLAYER_ACCENTS[projectile.ownerId];
    context.beginPath();
    context.arc(projectile.x, projectile.y, Math.max(2, projectile.radius), 0, Math.PI * 2);
    context.fill();
  }
  for (const projectile of state.hostileProjectiles) {
    context.fillStyle = "#ff3d6e";
    context.beginPath();
    context.arc(projectile.x, projectile.y, Math.max(3, projectile.radius), 0, Math.PI * 2);
    context.fill();
  }
  for (const id of ["p1", "p2"] as const) {
    const player = structuredClone(state.players[id]);
    if (id === playerId && predicted) player.ship = predicted;
    drawShip(context, player, PLAYER_ACCENTS[id], id === playerId);
  }
}

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
      if (event.code === "KeyE") missile.current = true;
      if (event.code === "KeyQ") onOverdrive();
      if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.code))
        event.preventDefault();
    };
    const up = (event: KeyboardEvent) => keys.current.delete(event.code);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
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
    const render = () => {
      const context = canvasRef.current?.getContext("2d");
      if (context) {
        const elapsedTicks = Math.min(2, ((performance.now() - receivedAt.current) / 1000) * 30);
        const state =
          interpolation.current.sample(latest.current.serverTick - 2 + elapsedTicks) ??
          latest.current.state;
        drawState(context, state, playerId, prediction.current.ship);
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

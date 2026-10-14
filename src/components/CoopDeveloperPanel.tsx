import { useState } from "react";
import type { DeveloperCommand } from "../game/developer-command";

export function CoopDeveloperPanel({ send }: { send: (command: DeveloperCommand) => void }) {
  const [count, setCount] = useState(1);
  const [size, setSize] = useState<1 | 2 | 3>(2);
  return (
    <div className="coop-settings">
      <h3>Developer console</h3>
      <p>
        Commands affect the shared match. Using this console excludes the run from competitive
        records.
      </p>
      <div className="coop-dev-actions">
        {(
          [
            ["heal", "Repair hull"],
            ["credits", "+10,000 credits"],
            ["weapons", "Max weapons"],
            ["drone", "Deploy drone"],
            ["clear", "Clear hostiles"],
            ["nextWave", "Next wave"],
          ] as const
        ).map(([action, label]) => (
          <button key={action} onClick={() => send({ action })}>
            {label}
          </button>
        ))}
      </div>
      <label>
        Spawn count
        <input
          type="number"
          min={1}
          max={50}
          value={count}
          onChange={(event) =>
            setCount(Math.max(1, Math.min(50, Math.floor(Number(event.target.value) || 1))))
          }
        />
      </label>
      <label>
        Size
        <select value={size} onChange={(event) => setSize(Number(event.target.value) as 1 | 2 | 3)}>
          <option value={1}>Small</option>
          <option value={2}>Medium</option>
          <option value={3}>Large</option>
        </select>
      </label>
      <h4>Asteroids</h4>
      <div className="coop-dev-actions">
        {(["none", "homing", "bounce", "boom", "fast", "meteor", "meteorite"] as const).map(
          (kind) => (
            <button key={kind} onClick={() => send({ action: "rock", kind, count, size })}>
              {kind === "none" ? "Normal" : kind}
            </button>
          ),
        )}
      </div>
      <h4>Enemies</h4>
      <div className="coop-dev-actions">
        {(["sentinel", "warden", "spiker"] as const).map((kind) => (
          <button key={kind} onClick={() => send({ action: "enemy", kind, count, size })}>
            {kind}
          </button>
        ))}
      </div>
      <h4>Bosses</h4>
      <div className="coop-dev-actions">
        {[1, 2, 3, 4, 5, 6].map((mk) => (
          <button key={mk} onClick={() => send({ action: "boss", mk })}>
            MK{mk}
          </button>
        ))}
      </div>
    </div>
  );
}

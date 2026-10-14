export type DeveloperCommand =
  | { action: "heal" | "credits" | "clear" | "nextWave" | "weapons" | "drone" }
  | {
      action: "rock";
      kind: "none" | "homing" | "bounce" | "boom" | "fast" | "meteor" | "meteorite";
      count: number;
      size: 1 | 2 | 3;
    }
  | { action: "enemy"; kind: "sentinel" | "warden" | "spiker"; count: number; size: 1 | 2 | 3 }
  | { action: "boss"; mk: number };

export function validDeveloperCommand(value: unknown): value is DeveloperCommand {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const c = value as Record<string, unknown>;
  if (typeof c.action !== "string") return false;
  if (["heal", "credits", "clear", "nextWave", "weapons", "drone"].includes(c.action)) return true;
  if (c.action === "boss") return Number.isInteger(c.mk) && Number(c.mk) >= 1 && Number(c.mk) <= 6;
  if (
    !Number.isInteger(c.count) ||
    Number(c.count) < 1 ||
    Number(c.count) > 50 ||
    ![1, 2, 3].includes(Number(c.size)) ||
    typeof c.size !== "number"
  )
    return false;
  if (typeof c.kind !== "string") return false;
  return c.action === "rock"
    ? ["none", "homing", "bounce", "boom", "fast", "meteor", "meteorite"].includes(c.kind)
    : c.action === "enemy" && ["sentinel", "warden", "spiker"].includes(c.kind);
}

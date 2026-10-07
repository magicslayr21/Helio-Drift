export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const weapons = new Set(["pulse", "spread", "seeker", "ricochet", "flak", "arc", "laser", "rail"]);
const upgrades = new Set(["overclock", "hollow", "thruster", "hull", "armor", "twin", "pierce", "crit"]);
const droneUpgrades = new Set(["twinCannons", "overcharge", "piercing", "armor", "repairPulse", "magnet", "scan", "speed"]);
export const stages = ["sectors", "mk6", "mk6-cleared"];
const statuses = new Set(["active", "paused", "dead", "victory", "abandoned"]);

function requireCondition(condition, message) {
  if (!condition) throw new HttpError(400, message);
}

export function object(value, label = "Body") {
  requireCondition(value !== null && typeof value === "object" && !Array.isArray(value), `${label} must be an object.`);
  return value;
}

export function integer(value, label, minimum = 0, maximum = 1_000_000_000_000) {
  requireCondition(Number.isSafeInteger(value) && value >= minimum && value <= maximum, `${label} is out of range.`);
  return value;
}

export function identifier(value, label = "Run ID") {
  requireCondition(typeof value === "string" && /^[a-zA-Z0-9_-]{16,80}$/.test(value), `${label} is invalid.`);
  return value;
}

function enumValue(value, values, label) {
  requireCondition(values.has(value), `${label} is invalid.`);
  return value;
}

function record(value, allowed, label) {
  object(value, label);
  const result = {};
  for (const [key, level] of Object.entries(value)) {
    requireCondition(allowed.has(key), `Unknown ${label} ID.`);
    result[key] = integer(level, `${label} level`, 0, 1000);
  }
  return result;
}

export function validateReport(value, runId) {
  object(value);
  requireCondition(value.runId === runId, "Run ID does not match its URL.");
  object(value.drone, "Drone");
  requireCondition(typeof value.assisted === "boolean", "Assisted flag is required.");
  requireCondition(typeof value.drone.purchased === "boolean", "Drone purchased flag is required.");
  requireCondition(value.deathCause === null || (typeof value.deathCause === "string" && value.deathCause.length <= 160 && !/[\x00-\x1f\x7f]/.test(value.deathCause)), "Death cause is invalid.");
  const report = {
    runId: identifier(runId),
    revision: integer(value.revision, "Revision", 1, Number.MAX_SAFE_INTEGER),
    score: integer(value.score, "Score"),
    credits: integer(value.credits, "Credits"),
    wave: integer(value.wave, "Wave", 1, 1_000_000),
    level: integer(value.level, "Level", 1, 1_000_000),
    stage: enumValue(value.stage, new Set(stages), "Stage"),
    status: enumValue(value.status, statuses, "Status"),
    durationSeconds: integer(value.durationSeconds, "Duration", 0, 31_536_000),
    sector: integer(value.sector, "Sector", 1, 7),
    primary: enumValue(value.primary, weapons, "Weapon"),
    weapons: record(value.weapons, weapons, "Weapon"),
    upgrades: record(value.upgrades, upgrades, "Upgrade"),
    deathCause: value.deathCause,
    assisted: value.assisted,
    drone: {
      purchased: value.drone.purchased,
      weapon: value.drone.weapon === null ? null : enumValue(value.drone.weapon, weapons, "Drone weapon"),
      upgrades: record(value.drone.upgrades, droneUpgrades, "Drone upgrade"),
    },
  };
  requireCondition(report.weapons[report.primary] > 0, "The equipped weapon must be owned.");
  requireCondition(report.stage !== "mk6-cleared" || report.status === "victory", "An MK6 clear must be a victory.");
  return report;
}

export function validateEdit(value) {
  object(value);
  requireCondition(Object.keys(value).length > 0, "Provide at least one edit.");
  const allowed = new Set(["username", "score", "credits", "wave", "level", "stage", "status"]);
  for (const key of Object.keys(value)) requireCondition(allowed.has(key), "Unknown edit field.");
  const result = {};
  for (const field of ["score", "credits", "wave", "level"]) {
    if (field in value) result[field] = integer(value[field], field, field === "wave" || field === "level" ? 1 : 0, field === "wave" || field === "level" ? 1_000_000 : 1_000_000_000_000);
  }
  if ("stage" in value) result.stage = enumValue(value.stage, new Set(stages), "Stage");
  if ("status" in value) result.status = enumValue(value.status, statuses, "Status");
  if ("username" in value) {
    requireCondition(typeof value.username === "string" && value.username.length <= 160, "Username is invalid.");
    result.username = value.username;
  }
  return result;
}

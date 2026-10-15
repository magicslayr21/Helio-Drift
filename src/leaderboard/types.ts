import type { WeaponId } from "../game/types";

export type RunStage = "sectors" | "mk6" | "mk6-cleared";
export type RunStatus = "active" | "paused" | "dead" | "victory" | "abandoned";
export interface RunReport {
  runId: string;
  revision: number;
  score: number;
  credits: number;
  wave: number;
  level: number;
  stage: RunStage;
  status: RunStatus;
  durationSeconds: number;
  sector: number;
  primary: WeaponId;
  weapons: Record<WeaponId, number>;
  upgrades: Record<string, number>;
  deathCause: string | null;
  assisted: boolean;
  drone: { purchased: boolean; weapon: WeaponId | null; upgrades: Record<string, number> };
}
export interface LeaderboardEntry {
  id: string;
  playerId: string;
  username: string;
  score: number;
  credits: number;
  wave: number;
  level: number;
  stage: RunStage;
  status: RunStatus;
  assisted: boolean;
  updatedAt: string;
  rank: number;
}
export interface RunDetails extends LeaderboardEntry {
  report: RunReport;
  createdAt: string;
  moderated: boolean;
}
export interface LeaderboardPage {
  entries: LeaderboardEntry[];
  total: number;
  updatedAt: string;
}
export type CoopRunStatus = "victory" | "defeat" | "abandoned";
export interface CoopLeaderboardEntry {
  id: string;
  playerOne: string;
  playerTwo: string;
  score: number;
  wave: number;
  sector: number;
  durationSeconds: number;
  bossesDefeated: number;
  status: CoopRunStatus;
  completed: boolean;
  finishedAt: string;
  rank: number;
}
export interface CoopLeaderboardPage {
  entries: CoopLeaderboardEntry[];
  total: number;
}
export interface PlayerIdentity {
  playerId: string;
  playerToken: string;
  username: string;
}
export interface AdminSession {
  token: string;
  expiresAt: string;
}
export type RunEdit = Pick<
  LeaderboardEntry,
  "username" | "score" | "credits" | "wave" | "level" | "stage" | "status"
>;

export interface CoopPilotTelemetry {
  callsign: string;
  level: number;
  credits: number;
  hull: number;
  maxHull: number;
  primary: WeaponId;
  weapons: Record<WeaponId, number>;
  upgrades: Record<string, number>;
  stats: import("../game/simulation/coop-types").CoopPlayerStats;
  drone: RunReport["drone"];
}
export interface CoopRunDetails extends CoopLeaderboardEntry {
  roomCode: string;
  createdAt: string;
  updatedAt: string;
  revision: number;
  moderated: boolean;
  telemetry: {
    pilots: Record<"p1" | "p2", CoopPilotTelemetry>;
    directive: string | null;
    bonusDefeated: boolean;
  } | null;
}
export type CoopRunEdit = Pick<
  CoopLeaderboardEntry,
  | "playerOne"
  | "playerTwo"
  | "score"
  | "wave"
  | "sector"
  | "durationSeconds"
  | "bossesDefeated"
  | "status"
> & { revision: number };

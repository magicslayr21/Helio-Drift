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

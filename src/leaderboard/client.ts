import type {
  AdminSession,
  LeaderboardPage,
  PlayerIdentity,
  RunDetails,
  RunEdit,
  RunReport,
} from "./types";

const configuredUrl = (import.meta.env.VITE_LEADERBOARD_URL || "").trim().replace(/\/$/, "");
const API = configuredUrl || (import.meta.env.DEV ? "/api" : "");
const IDENTITY_KEY = "helios-leaderboard-player-v1";
const QUEUE_KEY = "helios-leaderboard-pending-v1";
let identity: PlayerIdentity | null = null;
let registration: Promise<PlayerIdentity> | null = null;
let admin: AdminSession | null = null;
let flushing = false;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retryDelay = 2000;
let pendingMemory: RunReport[] = [];
let syncStatus: "offline" | "syncing" | "saved" | "disabled" | "idle" = API ? "idle" : "disabled";

class LeaderboardError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export const isLeaderboardConfigured = () => Boolean(API);
export const getSyncStatus = () => syncStatus;

export function getIdentity(): PlayerIdentity | null {
  try {
    const saved = JSON.parse(localStorage.getItem(IDENTITY_KEY) || "null");
    if (
      saved &&
      typeof saved.playerId === "string" &&
      typeof saved.playerToken === "string" &&
      typeof saved.username === "string"
    )
      identity = saved;
  } catch {
    /* Keep the in-memory profile if browser storage is unavailable. */
  }
  return identity;
}
function saveIdentity(next: PlayerIdentity) {
  identity = next;
  try {
    localStorage.setItem(IDENTITY_KEY, JSON.stringify(next));
  } catch {
    /* Gameplay works without storage. */
  }
}

async function request<T>(path: string, options: RequestInit = {}, token?: string): Promise<T> {
  if (!API) throw new Error("The global leaderboard is not available yet.");
  const controller = new AbortController();
  const abort = () => controller.abort();
  options.signal?.addEventListener("abort", abort, { once: true });
  if (options.signal?.aborted) controller.abort();
  const timeout = setTimeout(abort, 8000);
  try {
    const response = await fetch(`${API}${path}`, {
      ...options,
      signal: controller.signal,
      cache: "no-store",
      credentials: "omit",
      headers: {
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers,
      },
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      if (response.status === 401 && token === admin?.token) admin = null;
      throw new LeaderboardError(
        typeof body?.error === "string"
          ? body.error
          : "The leaderboard could not complete that request. Please try again.",
        response.status,
      );
    }
    if (body === null)
      throw new Error("The leaderboard returned an invalid response. Please try again shortly.");
    return body as T;
  } catch (error) {
    if (options.signal?.aborted) throw error;
    if (controller.signal.aborted)
      throw new Error("The leaderboard took too long to respond. Your game is still available.");
    if (error instanceof TypeError)
      throw new Error("Unable to reach the leaderboard. Check your connection and try again.");
    throw error;
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", abort);
  }
}

async function ensureIdentity(username = ""): Promise<PlayerIdentity> {
  const existing = getIdentity();
  if (existing) return existing;
  if (!registration) {
    const register = async () => {
      const shared = getIdentity();
      if (shared) return shared;
      const created = await request<PlayerIdentity>("/players", {
        method: "POST",
        body: JSON.stringify({ username }),
      });
      saveIdentity(created);
      return created;
    };
    // Two game tabs share one pilot profile when the browser supports Web Locks.
    const lockedRegister = async (): Promise<PlayerIdentity> =>
      navigator.locks
        ? await navigator.locks.request("helios-leaderboard-profile", register)
        : await register();
    registration = lockedRegister().finally(() => {
      registration = null;
    });
  }
  return registration;
}

export async function setUsername(username: string): Promise<PlayerIdentity> {
  const player = await ensureIdentity(username);
  const updated = await request<{ username: string }>(
    "/players/me",
    { method: "PATCH", body: JSON.stringify({ username }) },
    player.playerToken,
  );
  const next = { ...player, username: updated.username };
  saveIdentity(next);
  return next;
}
export const getLeaderboard = (offset = 0, limit = 25, signal?: AbortSignal) =>
  request<LeaderboardPage>(`/leaderboard?offset=${offset}&limit=${limit}`, { signal });
export function getAdminSession(): AdminSession | null {
  if (admin && Date.parse(admin.expiresAt) <= Date.now()) admin = null;
  return admin;
}
export async function authenticateDeveloper(code: string): Promise<AdminSession> {
  admin = await request<AdminSession>("/admin/session", {
    method: "POST",
    body: JSON.stringify({ code }),
  });
  return admin;
}
export function clearDeveloperSession() {
  admin = null;
}
function adminToken() {
  const session = getAdminSession();
  if (!session) throw new Error("Enter the developer code to manage leaderboard records.");
  return session.token;
}
export const getRunDetails = (id: string) =>
  request<RunDetails>(`/admin/runs/${encodeURIComponent(id)}`, {}, adminToken());
export async function editRun(id: string, edit: Partial<RunEdit>) {
  await request(
    `/admin/runs/${encodeURIComponent(id)}`,
    { method: "PATCH", body: JSON.stringify(edit) },
    adminToken(),
  );
}
export async function deleteRun(id: string) {
  await request(`/admin/runs/${encodeURIComponent(id)}`, { method: "DELETE" }, adminToken());
}

function readPending(): RunReport[] {
  try {
    const saved = JSON.parse(localStorage.getItem(QUEUE_KEY) || "[]");
    if (Array.isArray(saved)) {
      const merged = new Map(pendingMemory.map((report) => [report.runId, report]));
      for (const report of saved) {
        if (report && typeof report.runId === "string" && Number.isSafeInteger(report.revision)) {
          const existing = merged.get(report.runId);
          if (!existing || existing.revision < report.revision) merged.set(report.runId, report);
        }
      }
      return [...merged.values()].slice(-12);
    }
  } catch {
    /* Retain queued reports in memory. */
  }
  return pendingMemory;
}
function writePending(reports: RunReport[]) {
  pendingMemory = reports.slice(-12);
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(pendingMemory));
  } catch {
    /* Bounded in-memory retry remains available. */
  }
}

// The engine never waits for I/O. Keep only the latest report per run and retry outages.
export function queueRun(report: RunReport | null) {
  if (!report || report.wave < 1) return;
  const reports = readPending();
  const index = reports.findIndex((r) => r.runId === report.runId);
  if (index < 0) reports.push(report);
  else if (reports[index].revision < report.revision) reports[index] = report;
  writePending(reports);
  if (!retryTimer) void flushPendingRuns();
}
export async function flushPendingRuns() {
  if (!API || flushing || !readPending().length) return;
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
  flushing = true;
  syncStatus = "syncing";
  try {
    const player = await ensureIdentity();
    for (const report of readPending()) {
      try {
        await request(
          `/runs/${encodeURIComponent(report.runId)}`,
          { method: "PUT", body: JSON.stringify(report) },
          player.playerToken,
        );
      } catch (error) {
        if (error instanceof LeaderboardError && error.status === 401) {
          identity = null;
          try {
            localStorage.removeItem(IDENTITY_KEY);
          } catch {
            /* Retry with a new profile. */
          }
        }
        // Invalid or no-longer-owned reports must not block every later run.
        if (
          !(error instanceof LeaderboardError) ||
          ![400, 403, 404, 409, 413, 422].includes(error.status)
        )
          throw error;
      }
      writePending(
        readPending().filter((r) => r.runId !== report.runId || r.revision > report.revision),
      );
    }
    retryDelay = 2000;
    syncStatus = "saved";
  } catch {
    syncStatus = "offline";
    if (!retryTimer) {
      retryTimer = setTimeout(() => {
        retryTimer = null;
        void flushPendingRuns();
      }, retryDelay);
      retryDelay = Math.min(60000, retryDelay * 2);
    }
  } finally {
    flushing = false;
    // A death/restart can queue a newer snapshot while an older request is in flight.
    // Drain it immediately instead of waiting for the next periodic report.
    if (!retryTimer && readPending().length) {
      retryTimer = setTimeout(() => {
        retryTimer = null;
        void flushPendingRuns();
      }, 0);
    }
  }
}

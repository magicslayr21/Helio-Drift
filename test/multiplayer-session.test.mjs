import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import ts from "typescript";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith(".") && context.parentURL) {
      const candidate = new URL(`${specifier}.ts`, context.parentURL);
      if (existsSync(candidate)) return nextResolve(candidate.href);
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.endsWith(".ts")) {
      return {
        format: "module",
        shortCircuit: true,
        source: ts.transpileModule(readFileSync(new URL(url), "utf8"), {
          compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
        }).outputText,
      };
    }
    return nextLoad(url, context);
  },
});

const values = new Map();
globalThis.window = {
  location: { href: "https://game.example/Helio-Drift/" },
};
globalThis.localStorage = {
  getItem: (key) => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, value),
  removeItem: (key) => values.delete(key),
};

const { apiToWebSocketUrl, clearCoopSession, loadCoopSession, saveCoopSession } = await import(
  "../src/multiplayer/client.ts"
);

const room = {
  code: "ABC234",
  visibility: "private",
  name: null,
  phase: "waiting",
  playerCount: 1,
  capacity: 2,
  joinable: true,
  createdAt: 1,
  expiresAt: 2,
  players: {
    p1: { id: "p1", callsign: "Alpha", ready: false, connected: false, left: false },
    p2: null,
  },
};

test("co-op reconnect sessions survive refresh but reject malformed capabilities", () => {
  const session = {
    roomCode: "ABC234",
    playerId: "p1",
    reconnectToken: "A".repeat(43),
    room,
  };
  saveCoopSession(session);
  assert.deepEqual(loadCoopSession(), session);
  values.set("helios-coop-session-v1", JSON.stringify({ ...session, reconnectToken: "unsafe" }));
  assert.equal(loadCoopSession(), null);
  clearCoopSession();
  assert.equal(loadCoopSession(), null);
});

test("HTTP multiplayer API locations convert to same-origin WebSocket routes", () => {
  assert.equal(
    apiToWebSocketUrl("https://relay.example/api", "/rooms/ABC234/socket?ticket=token"),
    "wss://relay.example/api/rooms/ABC234/socket?ticket=token",
  );
  assert.equal(
    apiToWebSocketUrl("/multiplayer-api", "/rooms/ABC234/socket?ticket=token"),
    "wss://game.example/multiplayer-api/rooms/ABC234/socket?ticket=token",
  );
});

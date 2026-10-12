import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";

export async function multiplayerFixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "helio-multiplayer-test-"));
  const options = convertV4MiniflareOptions({
    modules: true,
    scriptPath: fileURLToPath(new URL("../../multiplayer-dist/worker.js", import.meta.url)),
    compatibilityDate: "2026-10-12",
    compatibilityFlags: ["nodejs_compat"],
    bindings: { MULTIPLAYER_ORIGINS: "http://localhost:5173" },
    durableObjects: {
      MATCH_ROOMS: { className: "MatchRoom", useSQLite: true },
      LOBBY_INDEX: { className: "LobbyIndex", useSQLite: true },
    },
    resourcePersistencePath: directory,
    telemetry: { enabled: false },
  });
  let mf = new Miniflare(options);
  const sockets = new Set();
  const inboxes = new WeakMap();
  t.after(async () => {
    for (const socket of sockets) {
      try {
        socket.close(1000, "test complete");
      } catch {}
    }
    await mf.dispose();
    await rm(directory, { recursive: true, force: true });
  });

  async function request(path, { method = "GET", token, body, rawBody, headers = {} } = {}) {
    const response = await mf.dispatchFetch(`https://multiplayer.example/api${path}`, {
      method,
      headers: {
        ...(body === undefined && rawBody === undefined
          ? {}
          : { "Content-Type": "application/json" }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      ...(rawBody === undefined
        ? body === undefined
          ? {}
          : { body: JSON.stringify(body) }
        : { body: rawBody }),
    });
    const text = await response.text();
    return {
      status: response.status,
      headers: response.headers,
      data: text ? JSON.parse(text) : null,
    };
  }

  async function create(callsign = "Comet One") {
    const response = await request("/rooms/private", { method: "POST", body: { callsign } });
    assert.equal(response.status, 201, JSON.stringify(response.data));
    return response.data;
  }

  async function joinRoom(roomCode, callsign = "Comet Two") {
    return request(`/rooms/${roomCode}/join`, { method: "POST", body: { callsign } });
  }

  async function createPublic(name = "Open Patrol", callsign = "Comet One") {
    const response = await request("/rooms/public", {
      method: "POST",
      body: { name, callsign },
    });
    assert.equal(response.status, 201, JSON.stringify(response.data));
    return response.data;
  }

  async function connect(identity) {
    const ticket = await request(`/rooms/${identity.roomCode}/tickets`, {
      method: "POST",
      token: identity.reconnectToken,
    });
    assert.equal(ticket.status, 200, JSON.stringify(ticket.data));
    const response = await mf.dispatchFetch(
      `https://multiplayer.example/api/rooms/${identity.roomCode}/socket?ticket=${ticket.data.socketTicket}`,
      { headers: { Upgrade: "websocket" } },
    );
    assert.equal(response.status, 101);
    assert.ok(response.webSocket);
    const socket = response.webSocket;
    sockets.add(socket);
    const inbox = { messages: [], waiters: [] };
    inboxes.set(socket, inbox);
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      const index = inbox.waiters.findIndex((waiter) => waiter.predicate(message));
      if (index < 0) {
        inbox.messages.push(message);
        return;
      }
      const [waiter] = inbox.waiters.splice(index, 1);
      clearTimeout(waiter.timeout);
      waiter.resolve(message);
    });
    socket.accept();
    return { socket, ticket: ticket.data.socketTicket };
  }

  function nextMessage(socket, predicate = () => true, timeoutMs = 3000) {
    const inbox = inboxes.get(socket);
    const index = inbox?.messages.findIndex(predicate) ?? -1;
    if (index >= 0) return Promise.resolve(inbox.messages.splice(index, 1)[0]);
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        const waiterIndex = inbox.waiters.findIndex((waiter) => waiter.resolve === resolve);
        if (waiterIndex >= 0) inbox.waiters.splice(waiterIndex, 1);
        reject(new Error("Timed out waiting for WebSocket message"));
      }, timeoutMs);
      inbox.waiters.push({ predicate, resolve, timeout });
    });
  }

  function nextClose(socket, timeoutMs = 3000) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("Timed out waiting for WebSocket close")),
        timeoutMs,
      );
      socket.addEventListener(
        "close",
        (event) => {
          clearTimeout(timeout);
          resolve(event);
        },
        { once: true },
      );
    });
  }

  return {
    request,
    create,
    createPublic,
    joinRoom,
    connect,
    nextMessage,
    nextClose,
    async restart() {
      for (const socket of sockets) {
        try {
          socket.close(1000, "restart");
        } catch {}
      }
      sockets.clear();
      await mf.dispose();
      mf = new Miniflare(options);
    },
  };
}

import assert from "node:assert/strict";
import test from "node:test";
import { waitForDevtools } from "../scripts/chromium-startup.mjs";

const endpoint = "ws://127.0.0.1:42569/devtools/browser/browser-id";
const options = () => ({
  port: 42569,
  process: { exitCode: null, signalCode: null },
  diagnostics: () => "",
  launchError: () => null,
});

test("DevTools can become ready after the former 30 second limit", async (t) => {
  let now = 0,
    diagnostic = "",
    calls = 0;
  t.mock.method(Date, "now", () => now);
  const result = await waitForDevtools({
    ...options(),
    diagnostics: () => diagnostic,
    fetchVersion: async () => {
      calls++;
      now = 31_000;
      diagnostic = `D-Bus warning\nDevTools listening on ${endpoint}\n`;
      throw new Error("HTTP discovery not responding yet");
    },
  });
  assert.equal(result, endpoint);
  assert.equal(calls, 1);
});

test("announcement during the final HTTP probe wins over the startup deadline", async (t) => {
  let now = 0,
    diagnostic = "";
  t.mock.method(Date, "now", () => now);
  assert.equal(
    await waitForDevtools({
      ...options(),
      timeoutMs: 100,
      diagnostics: () => diagnostic,
      fetchVersion: async () => {
        now = 100;
        diagnostic = `DevTools listening on ${endpoint}\n`;
        throw new Error("Discovery timed out");
      },
    }),
    endpoint,
  );
});

test("HTTP discovery still supports browsers that omit the stderr announcement", async () => {
  assert.equal(
    await waitForDevtools({
      ...options(),
      fetchVersion: async () => ({
        ok: true,
        json: async () => ({ webSocketDebuggerUrl: endpoint }),
      }),
    }),
    endpoint,
  );
});

test("a crashed browser fails promptly even if old diagnostics contain an endpoint", async () => {
  await assert.rejects(
    waitForDevtools({
      ...options(),
      process: { exitCode: 1, signalCode: null },
      diagnostics: () => `DevTools listening on ${endpoint}\n`,
      fetchVersion: async () => {
        throw new Error("must not fetch");
      },
    }),
    /Chromium exited \(1\)/,
  );
});

test("launch errors are reported immediately", async () => {
  await assert.rejects(
    waitForDevtools({ ...options(), launchError: () => new Error("ENOENT") }),
    /failed to launch: ENOENT/,
  );
});

test("missing or unrelated endpoints fail with bounded startup diagnostics", async (t) => {
  let now = 0;
  t.mock.method(Date, "now", () => now);
  await assert.rejects(
    waitForDevtools({
      ...options(),
      timeoutMs: 100,
      diagnostics: () => "DevTools listening on ws://127.0.0.1:9999/devtools/browser/other\n",
      fetchVersion: async () => {
        now = 100;
        return { ok: false };
      },
    }),
    /did not become ready within 0.1 seconds/,
  );
});

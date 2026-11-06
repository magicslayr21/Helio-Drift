const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

/** Chromium announces the socket before its HTTP discovery route is always responsive. */
export async function waitForDevtools({
  port,
  process: browserProcess,
  diagnostics,
  launchError,
  timeoutMs = 90_000,
  fetchVersion = fetch,
  onSlowStartup = () => {},
}) {
  const deadline = Date.now() + timeoutMs;
  const slowAt = Date.now() + 30_000;
  let reportedSlow = false;
  const announcedEndpoint = () => {
    const match = diagnostics().match(/DevTools listening on (ws:\/\/[^\s]+)\r?\n/);
    if (!match) return null;
    try {
      const url = new URL(match[1]);
      return url.hostname === "127.0.0.1" &&
        url.port === String(port) &&
        url.pathname.startsWith("/devtools/browser/")
        ? url.href
        : null;
    } catch {
      return null;
    }
  };
  const checkProcess = () => {
    const error = launchError();
    if (error) throw new Error(`Chromium failed to launch: ${error.message}`);
    if (browserProcess.exitCode !== null || browserProcess.signalCode != null) {
      throw new Error(
        `Chromium exited (${browserProcess.signalCode ?? browserProcess.exitCode}) before DevTools became ready.\n${diagnostics().trim()}`,
      );
    }
  };
  while (Date.now() < deadline) {
    checkProcess();
    const announced = announcedEndpoint();
    if (announced) return announced;
    if (!reportedSlow && Date.now() >= slowAt) {
      reportedSlow = true;
      onSlowStartup();
    }
    try {
      const response = await fetchVersion(`http://127.0.0.1:${port}/json/version`, {
        signal: AbortSignal.timeout(Math.max(1, Math.min(2_000, deadline - Date.now()))),
      });
      if (response.ok) {
        const metadata = await response.json();
        const url = new URL(metadata.webSocketDebuggerUrl);
        if (
          url.protocol === "ws:" &&
          url.hostname === "127.0.0.1" &&
          url.port === String(port) &&
          url.pathname.startsWith("/devtools/browser/")
        )
          return url.href;
      }
    } catch {
      /* Keep waiting while the browser process is starting. */
    }
    // Check again after discovery: stderr may have announced readiness during the request.
    checkProcess();
    const ready = announcedEndpoint();
    if (ready) return ready;
    await delay(Math.max(0, Math.min(100, deadline - Date.now())));
  }
  checkProcess();
  const ready = announcedEndpoint();
  if (ready) return ready;
  throw new Error(
    `Chromium DevTools endpoint did not become ready within ${timeoutMs / 1000} seconds.\n${diagnostics().trim()}`,
  );
}

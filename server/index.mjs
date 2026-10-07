import { createLeaderboardServer } from "./app.mjs";

const port = Number(process.env.PORT ?? 8787);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT must be between 1 and 65535.");
const app = createLeaderboardServer({
  databasePath: process.env.LEADERBOARD_DB ?? "server/data/leaderboard.sqlite",
  adminCode: process.env.LEADERBOARD_ADMIN_CODE,
  allowedOrigins: process.env.LEADERBOARD_ORIGINS?.split(",").map((origin) => origin.trim()).filter(Boolean),
  trustProxy: process.env.LEADERBOARD_TRUST_PROXY === "1",
});
app.server.listen(port, process.env.HOST ?? "0.0.0.0", () => {
  console.log(`Helio Drift leaderboard listening on port ${port}.`);
});
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, async () => {
    await app.close();
    process.exit(0);
  });
}

import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parse } from "jsonc-parser";

const errors = [];
const configuration = parse(
  readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8"),
  errors,
  { allowTrailingComma: true },
);
const id = configuration?.d1_databases?.find((database) => database.binding === "DB")?.database_id;
if (
  errors.length ||
  typeof id !== "string" ||
  !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id) ||
  id === "00000000-0000-0000-0000-000000000000"
) {
  console.error(
    "Create your D1 database, then replace database_id in wrangler.jsonc with its ID. See docs/cloudflare.md.",
  );
  process.exit(1);
}

const cli = new URL("../node_modules/wrangler/bin/wrangler.js", import.meta.url);
for (const args of [["d1", "migrations", "apply", "DB", "--remote"], ["deploy"]]) {
  const result = spawnSync(process.execPath, [fileURLToPath(cli), ...args], { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

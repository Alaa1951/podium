import { copyFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
// The local error page needs the same official bridge runtime as the installed app.
await copyFile("node_modules/@capacitor/core/dist/capacitor.js", "capacitor-web/capacitor.js");
const result = spawnSync(process.execPath, ["node_modules/@capacitor/cli/bin/capacitor", "sync", ...process.argv.slice(2)], { stdio: "inherit" });
process.exitCode = result.status ?? 1;

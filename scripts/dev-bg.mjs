/**
 * Starts `next dev` in the background, with its output tee'd to
 * `dev-server.log` so `npm run otp` can read the sign-in code out of it.
 *
 * Use `npm run dev` instead when you want the server in your own terminal —
 * then the code is printed in front of you and this is unnecessary.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const logPath = path.join(process.cwd(), "dev-server.log");
fs.writeFileSync(logPath, "");

const child = spawn("npx", ["next", "dev"], {
  stdio: ["ignore", "pipe", "pipe"],
  shell: process.platform === "win32",
});

const log = fs.createWriteStream(logPath, { flags: "a" });
child.stdout.pipe(log);
child.stderr.pipe(log);
child.stdout.pipe(process.stdout);
child.stderr.pipe(process.stderr);

console.log(`\n[dev:bg] output is also being written to ${path.basename(logPath)}`);
console.log("[dev:bg] read a sign-in code with:  npm run otp\n");

const stop = () => {
  child.kill();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
child.on("exit", (code) => process.exit(code ?? 0));

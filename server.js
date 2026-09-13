// The entrypoint runs on plain Node before any bundler, and hands over to
// Next's own CommonJS standalone server. Conditional require() here is the
// whole point of this file.


/**
 * The production entrypoint.
 *
 * `next build` with `output: "standalone"` produces `.next/standalone/server.js`
 * carrying its own minimal node_modules, so the app runs on a plain Node host
 * without the full dependency tree installed there. This file hands over to it
 * when it exists, and falls back to booting Next directly when it does not —
 * so `node server.js` is a correct way to start the app either way.
 *
 * Run with `npm start`.
 */
const fs = require("node:fs");
const path = require("node:path");

const standalone = path.join(__dirname, ".next", "standalone", "server.js");

if (fs.existsSync(standalone)) {
  // The standalone server reads PORT and HOSTNAME itself.
  process.env.PORT ||= "3000";
  process.env.HOSTNAME ||= "0.0.0.0";
  require(standalone);
} else {
  const { createServer } = require("node:http");
  const next = require("next");

  const port = Number.parseInt(process.env.PORT || "3000", 10);
  const hostname = process.env.HOSTNAME || "0.0.0.0";
  const app = next({ dev: false, dir: __dirname });
  const handle = app.getRequestHandler();

  app
    .prepare()
    .then(() => {
      createServer((req, res) => handle(req, res)).listen(port, hostname, () => {
        console.log(`PODIUM listening on http://${hostname}:${port}`);
      });
    })
    .catch((error) => {
      console.error("[server] failed to start", error);
      process.exit(1);
    });
}

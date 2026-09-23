/**
 * WHERE THE DATABASE CREDENTIALS COME FROM, for backup-db.mjs and
 * restore-db.mjs.
 *
 * THE BUG THIS EXISTS TO FIX. Both scripts read `MYSQL_USER` /
 * `MYSQL_PASSWORD` / `MYSQL_DATABASE` and nothing else. That works on a
 * developer's machine, whose `.env` carries them for the local Docker
 * container — and it does not work on the production server, whose `.env`
 * carries `DATABASE_URL` and no `MYSQL_*` at all. So `backup-db.mjs`, whose
 * own first line calls it "event-day insurance", exited with
 * "MYSQL_PASSWORD is not set" on the one machine it exists to protect. Nobody
 * noticed until the first time somebody tried to take a backup there.
 *
 * `DATABASE_URL` is now the primary source, deliberately: it is the string the
 * application itself connects with, so a dump taken from it is a dump of the
 * database the app is actually using — not of whatever a second, unrelated set
 * of variables happens to point at. Two sources of truth for "which database"
 * is how a backup ends up being taken of the wrong one.
 *
 * Explicit `MYSQL_*` variables still win, field by field, so an existing local
 * setup keeps working exactly as it did.
 *
 * IT ALSO DECIDES WHICH CLIENT TO RUN, and redacts the password out of any
 * message either script prints. Both of those were found the hard way during a
 * production deploy: the default path tried a developer's Docker container on a
 * server that has none, and the failure it printed carried the database
 * password in the command line it echoed.
 */

/** Pull what a URL carries. Returns an empty object when there is no URL. */
function parseDatabaseUrl(value) {
  if (!value) return {};

  let url;
  try {
    url = new URL(value);
  } catch {
    // Loud, not silent: falling back to defaults here would take a backup of
    // some other database and report success.
    throw new Error("DATABASE_URL is set but is not a valid URL — check .env");
  }

  return {
    // Credentials in a URL are percent-encoded, and a password with an @ or a
    // / in it is ordinary. Decoding is not optional.
    user: url.username ? decodeURIComponent(url.username) : "",
    password: url.password ? decodeURIComponent(url.password) : "",
    database: decodeURIComponent(url.pathname.replace(/^\//, "")),
    host: url.hostname,
    port: url.port,
  };
}

/**
 * The credentials the dump and restore commands should use.
 *
 * Takes the environment as an argument so this is testable without touching
 * `process.env` — the same shape the rest of the scripts use.
 */
export function readDbCredentials(env = process.env) {
  const url = parseDatabaseUrl(env.DATABASE_URL);

  return {
    user: env.MYSQL_USER || url.user || "pudem",
    password: env.MYSQL_PASSWORD || url.password || "",
    database: env.MYSQL_DATABASE || url.database || "pudem",
    // THE HOST IS READ, not assumed. Both scripts hardcoded `127.0.0.1` on the
    // `--host` path, which is right only as long as the database happens to be
    // on the same machine as the script.
    host: env.MYSQL_HOST || url.host || "127.0.0.1",
    port: env.MYSQL_PORT || url.port || "3306",
    container: env.MYSQL_CONTAINER || "pudem-mysql",
  };
}

/**
 * Refuse to run without a password, and say where one is looked for.
 *
 * The old message named a single variable that production does not set, which
 * is why the failure read as a misconfiguration rather than as this bug.
 */
export function requirePassword(credentials) {
  if (credentials.password) return credentials;
  throw new Error(
    "No database password found — set DATABASE_URL (the app's own connection string) or MYSQL_PASSWORD in .env"
  );
}

/**
 * How the password reaches the client, and why it is built here.
 *
 * ON THE DIRECT PATH THE PASSWORD IS NEVER IN argv. Every process's command
 * line is world-readable through `ps`, and the direct path is the one that
 * runs on the production server; `MYSQL_PWD` is read from the environment
 * instead. (`mysqldump` says as much itself: "Using a password on the command
 * line interface can be insecure.")
 *
 * The Docker path still passes `--password`, because `docker exec` forwards an
 * environment variable only by naming it on that command line — which puts it
 * straight back into argv, of a command that runs on a developer's own machine
 * against a local container. Worth stating rather than quietly differing.
 *
 * This is a pure function so that property can be TESTED rather than asserted
 * in a comment: see db-credentials.test.mjs.
 *
 * @param client "mysqldump" to read, "mysql" to write.
 * @param transport "direct" or "container", from chooseTransport.
 */
export function clientCommand(client, credentials, { useHost, transport }) {
  const { user, password, database, host, port, container } = credentials;
  const tail =
    client === "mysqldump"
      ? ["--single-transaction", "--quick", "--default-character-set=utf8mb4", database]
      : ["--default-character-set=utf8mb4", database];

  // `useHost` is still accepted so the existing callers and tests read the
  // same; `transport` is what the scripts now pass.
  if (transport === "direct" || (transport === undefined && useHost)) {
    return {
      command: client,
      args: [`--host=${host}`, `--port=${port}`, `--user=${user}`, ...tail],
      env: { ...process.env, MYSQL_PWD: password },
    };
  }

  return {
    command: "docker",
    args: [
      "exec",
      ...(client === "mysql" ? ["-i"] : []),
      container,
      client,
      `--user=${user}`,
      `--password=${password}`,
      ...tail,
    ],
    env: process.env,
  };
}

/**
 * WHICH CLIENT TO RUN: the one on this machine, not the one on the last one.
 *
 * THE BUG THIS FIXES. The default used to be the Docker container, so on the
 * production server — which has no container — `node scripts/backup-db.mjs`
 * failed and wrote no file at all, and the operator had to already know to pass
 * `--host`. "Event-day insurance" that needs a flag the runbook remembers is
 * insurance that is not there on the day somebody else takes the backup.
 *
 * So it is DETECTED, with both answers still forceable. Pure, because the
 * choice is the part worth testing; the caller does the looking.
 *
 * @param clientOnPath did a real `mysqldump`/`mysql` answer on this machine?
 */
export function chooseTransport({ useHost, useContainer, clientOnPath }) {
  // An explicit flag is an instruction, and beats anything detected — including
  // on a machine where the detection would have been right.
  if (useHost && useContainer) {
    throw new Error("--host and --container contradict each other; pass one");
  }
  if (useHost) return { transport: "direct", why: "asked for with --host" };
  if (useContainer) return { transport: "container", why: "asked for with --container" };

  return clientOnPath
    ? { transport: "direct", why: "the client is installed here" }
    : { transport: "container", why: "no client here, trying Docker" };
}

/**
 * The same text with the password taken out of it, wherever it appears.
 *
 * WHY THIS EXISTS. `execFileSync` puts the whole command line into the error it
 * throws, and the Docker path passes `--password=…` on that line — so printing
 * the error printed the database password. It reached a terminal during a
 * production deploy. Nothing this module builds may be printed raw again.
 *
 * It replaces the password rather than dropping the whole message, because the
 * rest of the message is the only clue to why a backup failed.
 */
export function redactSecrets(text, credentials) {
  let out = String(text ?? "");
  const password = credentials?.password;
  if (password) {
    // Split-and-join, not a regex: a password is allowed to contain $, \ and
    // every other character a replacement pattern would eat.
    out = out.split(password).join("********");
  }
  // And a belt for the braces: an argument SHAPED like a password goes too,
  // even if it is not the one we hold — the value may have come from elsewhere.
  return out.replace(/(--password=)\S+/g, "$1********");
}

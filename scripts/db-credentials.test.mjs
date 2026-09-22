import { describe, expect, it } from "vitest";

import { clientCommand, readDbCredentials, requirePassword } from "./db-credentials.mjs";

// The production shape: DATABASE_URL and nothing else. This is the case that
// used to exit with "MYSQL_PASSWORD is not set" on the server the backup
// script exists to protect.
const PRODUCTION = { DATABASE_URL: "mysql://podium:s3cret@127.0.0.1:3306/podium" };

// The developer shape: MYSQL_* for the local Docker container.
const LOCAL = {
  MYSQL_USER: "pudem",
  MYSQL_PASSWORD: "devpass",
  MYSQL_DATABASE: "pudem",
  MYSQL_CONTAINER: "pudem-mysql",
};

describe("readDbCredentials", () => {
  it("reads everything from DATABASE_URL when no MYSQL_* are set", () => {
    const credentials = readDbCredentials(PRODUCTION);
    expect(credentials).toMatchObject({
      user: "podium",
      password: "s3cret",
      database: "podium",
      host: "127.0.0.1",
      port: "3306",
    });
  });

  // THE REGRESSION. An environment carrying only DATABASE_URL must produce a
  // password, or backup-db.mjs refuses to run on production — which is exactly
  // what it did.
  it("finds a password on an environment that has only DATABASE_URL", () => {
    expect(() => requirePassword(readDbCredentials(PRODUCTION))).not.toThrow();
  });

  it("keeps working for a local setup that has only MYSQL_*", () => {
    const credentials = readDbCredentials(LOCAL);
    expect(credentials).toMatchObject({
      user: "pudem",
      password: "devpass",
      database: "pudem",
      container: "pudem-mysql",
    });
  });

  it("lets an explicit MYSQL_* variable win over the URL, field by field", () => {
    const credentials = readDbCredentials({ ...PRODUCTION, MYSQL_DATABASE: "podium_staging" });
    expect(credentials.database).toBe("podium_staging");
    // Everything else still comes from the URL.
    expect(credentials.user).toBe("podium");
    expect(credentials.password).toBe("s3cret");
  });

  // A password with an @ or a / in it is ordinary, and it arrives
  // percent-encoded. Not decoding it authenticates with the wrong string.
  it("percent-decodes credentials out of the URL", () => {
    const credentials = readDbCredentials({
      DATABASE_URL: "mysql://od%40in:p%40ss%2Fword@db.internal:3307/podium",
    });
    expect(credentials.user).toBe("od@in");
    expect(credentials.password).toBe("p@ss/word");
  });

  // Both scripts used to hardcode 127.0.0.1 on the --host path, which is right
  // only while the database sits on the same machine as the script.
  it("takes the host and port from the URL rather than assuming localhost", () => {
    const credentials = readDbCredentials({ DATABASE_URL: "mysql://u:p@db.internal:3307/podium" });
    expect(credentials.host).toBe("db.internal");
    expect(credentials.port).toBe("3307");
  });

  it("falls back to localhost:3306 when there is no URL at all", () => {
    expect(readDbCredentials(LOCAL)).toMatchObject({ host: "127.0.0.1", port: "3306" });
  });

  // Loud, not silent: a malformed URL that fell back to defaults would take a
  // backup of some other database and report success.
  it("refuses a DATABASE_URL that is not a URL", () => {
    expect(() => readDbCredentials({ DATABASE_URL: "not a url" })).toThrow(/not a valid URL/);
  });
});

describe("requirePassword", () => {
  it("refuses an environment with no password anywhere", () => {
    expect(() => requirePassword(readDbCredentials({}))).toThrow(/DATABASE_URL/);
  });

  // The old message named MYSQL_PASSWORD alone, so the failure read as a
  // misconfiguration rather than as the bug it was.
  it("names both places a password is looked for", () => {
    expect(() => requirePassword(readDbCredentials({}))).toThrow(/MYSQL_PASSWORD/);
  });
});

describe("clientCommand", () => {
  const credentials = readDbCredentials(PRODUCTION);

  // THE ONE THAT MATTERS. `ps` is readable by every user on the box, and this
  // is the path that runs on the production server. If a later edit reaches
  // for `--password` again because it is the obvious flag, this fails.
  it("never puts the password in argv on the direct path", () => {
    for (const client of ["mysqldump", "mysql"]) {
      const { args } = clientCommand(client, credentials, { useHost: true });
      expect(args.join(" ")).not.toContain(credentials.password);
      expect(args.some((arg) => arg.startsWith("--password"))).toBe(false);
    }
  });

  it("passes the password through MYSQL_PWD on the direct path instead", () => {
    const { env } = clientCommand("mysqldump", credentials, { useHost: true });
    expect(env.MYSQL_PWD).toBe("s3cret");
  });

  it("targets the host and port from the credentials, not a hardcoded localhost", () => {
    const remote = readDbCredentials({ DATABASE_URL: "mysql://u:p@db.internal:3307/podium" });
    const { command, args } = clientCommand("mysqldump", remote, { useHost: true });
    expect(command).toBe("mysqldump");
    expect(args).toContain("--host=db.internal");
    expect(args).toContain("--port=3307");
  });

  // Documented, not accidental: docker exec forwards an environment variable
  // only by naming it on the command line, so this path keeps the flag.
  it("goes through docker, with the flag, when not using --host", () => {
    const { command, args } = clientCommand("mysqldump", credentials, { useHost: false });
    expect(command).toBe("docker");
    expect(args.slice(0, 3)).toEqual(["exec", "pudem-mysql", "mysqldump"]);
    expect(args).toContain("--password=s3cret");
  });

  // Restoring reads the dump from stdin; without -i the container gets nothing
  // and the restore silently does nothing at all.
  it("keeps docker's stdin open for a restore but not for a dump", () => {
    expect(clientCommand("mysql", credentials, { useHost: false }).args).toContain("-i");
    expect(clientCommand("mysqldump", credentials, { useHost: false }).args).not.toContain("-i");
  });

  it("dumps in one transaction so a backup mid-wave does not lock score entry", () => {
    expect(clientCommand("mysqldump", credentials, { useHost: true }).args).toContain(
      "--single-transaction"
    );
  });
});

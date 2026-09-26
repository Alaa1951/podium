import { describe, expect, it } from "vitest";

import { isTestAccount, testAccountEmails } from "@/lib/test-accounts";

describe("test accounts — named by the server, never by the code", () => {
  const env = { TEST_ACCOUNT_EMAILS: " Test_Judge@bftmiddleeast.com, test_organiser@bftmiddleeast.com ,," };

  it("reads the configured list, trimmed and case-insensitive", () => {
    expect([...testAccountEmails(env)].sort()).toEqual([
      "test_judge@bftmiddleeast.com",
      "test_organiser@bftmiddleeast.com",
    ]);
    expect(isTestAccount(env, "TEST_JUDGE@bftmiddleeast.com ")).toBe(true);
  });

  it("is an exact list, not a pattern — a look-alike address is an ordinary account", () => {
    expect(isTestAccount(env, "test_admin@bftmiddleeast.com")).toBe(false);
    expect(isTestAccount(env, "test_judge@bftmiddleeast.com.evil.com")).toBe(false);
  });

  it("makes nobody a test account when the list is empty or missing", () => {
    expect(isTestAccount({}, "test_judge@bftmiddleeast.com")).toBe(false);
    expect(isTestAccount({ TEST_ACCOUNT_EMAILS: "" }, "")).toBe(false);
  });
});

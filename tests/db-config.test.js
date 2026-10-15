import { describe, expect, it } from "vitest";
import { readDbConfig } from "../shared/db-config.js";

describe("database configuration", () => {
  it("uses fixed restricted Auth identity and default host settings", () => {
    const config = readDbConfig("auth", { AUTH_DB_PASSWORD: "auth-test-password-long" });
    expect(config.user).toBe("forgeflow_auth");
    expect(config.host).toBe("127.0.0.1");
    expect(config.port).toBe(5433);
    expect(config.password).toBe("auth-test-password-long");
  });

  it("rejects missing and too-short credentials without leaking values", () => {
    expect(() => readDbConfig("core", {})).toThrow("Invalid core database configuration");
    expect(() => readDbConfig("core", { CORE_DB_PASSWORD: "bad" })).toThrow(
      "Invalid core database configuration"
    );
  });

  it("rejects unknown identity and invalid port", () => {
    expect(() => readDbConfig("admin", {})).toThrow("Unknown database account");
    expect(() => readDbConfig("auth", {
      AUTH_DB_PASSWORD: "auth-test-password-long", DB_PORT: "invalid",
    })).toThrow("Invalid auth database configuration");
  });
});

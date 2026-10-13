import { describe, expect, it } from "vitest";
import { loadServiceConfig } from "../shared/config.js";

describe("service environment configuration", () => {
  it("uses the expected local defaults", () => {
    expect(loadServiceConfig({ portVariable: "CORE_PORT", defaultPort: 3003, source: {} }))
      .toEqual({ environment: "development", host: "127.0.0.1", port: 3003 });
  });

  it("rejects invalid and out-of-range ports", () => {
    for (const value of ["nope", "0", "65536", "3000.5"]) {
      expect(() => loadServiceConfig({
        portVariable: "CORE_PORT",
        defaultPort: 3003,
        source: { CORE_PORT: value },
      })).toThrow("Invalid service configuration");
    }
  });

  it("accepts a configured development port", () => {
    expect(loadServiceConfig({
      portVariable: "GATEWAY_PORT",
      defaultPort: 3001,
      source: { NODE_ENV: "test", HOST: "localhost", GATEWAY_PORT: "3456" },
    }).port).toBe(3456);
  });
});

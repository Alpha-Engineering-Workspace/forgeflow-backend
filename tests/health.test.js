import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp as createGatewayApp } from "../apps/api-gateway/src/app.js";
import { createApp as createAuthApp } from "../apps/auth-service/src/app.js";
import { createApp as createCoreApp } from "../apps/core-service/src/app.js";

const services = [
  ["api-gateway", createGatewayApp],
  ["auth-service", createAuthApp],
  ["core-service", createCoreApp],
];

describe.each(services)("%s HTTP skeleton", (service, createApp) => {
  it("exposes a liveness endpoint with a fresh request ID", async () => {
    const app = createApp();
    const first = await request(app).get("/health/live").expect(200);
    const second = await request(app).get("/health/live").expect(200);
    expect(first.body).toEqual({ service, status: "alive" });
    expect(first.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/i);
    expect(first.headers["x-request-id"]).not.toBe(second.headers["x-request-id"]);
    expect(first.headers["x-powered-by"]).toBeUndefined();
  });

  it("reports process-only readiness (not database health)", async () => {
    const response = await request(createApp()).get("/health/ready").expect(200);
    expect(response.body).toEqual({ service, status: "ready", checks: "process-only" });
  });

  it("returns a safe JSON 404", async () => {
    const response = await request(createApp()).get("/missing").expect(404);
    expect(response.body.error.code).toBe("NOT_FOUND");
    expect(response.body.requestId).toBe(response.headers["x-request-id"]);
  });

  it("rejects malformed JSON without exposing internals", async () => {
    const response = await request(createApp())
      .post("/missing")
      .set("Content-Type", "application/json")
      .send('{"invalid":')
      .expect(400);
    expect(response.body.error.code).toBe("INVALID_JSON");
    expect(response.text).not.toContain("SyntaxError");
  });

  it("enforces the request body limit", async () => {
    const response = await request(createApp())
      .post("/missing")
      .set("Content-Type", "application/json")
      .send(JSON.stringify({ data: "a".repeat(70_000) }))
      .expect(413);
    expect(response.body.error.code).toBe("PAYLOAD_TOO_LARGE");
  });
});

import { randomUUID } from "node:crypto";

const base = "http://127.0.0.1:3001/api/auth";
const bffKey = process.env.GATEWAY_BFF_KEY;

if (!bffKey) {
  throw new Error("GATEWAY_BFF_KEY missing in .env");
}

const email = `smoke-${randomUUID()}@example.test`;
const password = "DevSmoke#2026abc";

async function call(path, method, body, accessToken) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      "x-forgeflow-bff-key": bffKey,
      ...(accessToken
        ? { authorization: `Bearer ${accessToken}` }
        : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  const data =
    response.status === 204 ? null : await response.json();

  return { status: response.status, data };
}

function verify(label, result, expected) {
  if (result.status !== expected) {
    throw new Error(
      `${label}: expected ${expected}, got ${result.status}`
    );
  }
  console.log(`PASS ${label}: HTTP ${result.status}`);
}

const registerBody = {
  name: "Smoke Test User",
  email,
  password,
};

verify(
  "Register",
  await call("/register", "POST", registerBody),
  201
);

verify(
  "Duplicate registration",
  await call("/register", "POST", registerBody),
  409
);

const login = await call("/login", "POST", {
  email,
  password,
});
verify("Login", login, 200);

const me = await call(
  "/me",
  "GET",
  null,
  login.data.accessToken
);
verify("Current user", me, 200);

const refresh = await call("/refresh", "POST", {
  refreshToken: login.data.refreshToken,
});
verify("Refresh", refresh, 200);

verify(
  "Logout",
  await call("/logout", "POST", {
    refreshToken: refresh.data.refreshToken,
  }),
  204
);

verify(
  "Revoked refresh",
  await call("/refresh", "POST", {
    refreshToken: refresh.data.refreshToken,
  }),
  401
);

console.log("All authentication smoke checks passed.");

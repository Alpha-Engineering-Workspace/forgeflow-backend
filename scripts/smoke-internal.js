// Run INSIDE the Gateway container to verify Docker service-name DNS.
// This is a connectivity test, not API Gateway routing.
async function checkHealth(serviceName, url) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(3000),
  });

  if (!response.ok) {
    throw new Error(`${serviceName} returned HTTP ${response.status}`);
  }

  const data = await response.json();

  if (data.service !== serviceName || data.status !== "alive") {
    throw new Error(`${serviceName} returned an unexpected health response`);
  }

  console.log(`${serviceName}: reachable and alive`);
}

try {
  await checkHealth("auth-service", "http://auth:3002/health/live");
  await checkHealth("core-service", "http://core:3003/health/live");
} catch (error) {
  console.error("Internal connectivity smoke test failed:", error.message);
  process.exitCode = 1;
}

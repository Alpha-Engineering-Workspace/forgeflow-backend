import { loadServiceConfig } from "../../../shared/config.js";
import { startServer } from "../../../shared/start-server.js";
import { createApp } from "./app.js";

const config = loadServiceConfig({
  portVariable: "GATEWAY_PORT",
  defaultPort: 3001,
});

startServer(createApp(), config, "api-gateway");

import { loadServiceConfig } from "../../../shared/config.js";
import { startServer } from "../../../shared/start-server.js";
import { createApp } from "./app.js";

const config = loadServiceConfig({
  portVariable: "AUTH_PORT",
  defaultPort: 3002,
});

startServer(createApp(), config, "auth-service");

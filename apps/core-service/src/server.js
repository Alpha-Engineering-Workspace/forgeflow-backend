import { loadServiceConfig } from "../../../shared/config.js";
import { startServer } from "../../../shared/start-server.js";
import { createApp } from "./app.js";

const config = loadServiceConfig({
  portVariable: "CORE_PORT",
  defaultPort: 3003,
});

startServer(createApp(), config, "core-service");

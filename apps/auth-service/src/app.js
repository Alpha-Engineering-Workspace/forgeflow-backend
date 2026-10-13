import { createHttpApp } from "../../../shared/http.js";

export function createApp() {
  return createHttpApp("auth-service");
}

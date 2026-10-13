import { z } from "zod";

/**
 * Parse configuration at process startup rather than trusting unvalidated env.
 * The injected source also lets tests avoid editing process.env.
 */
export function loadServiceConfig({ portVariable, defaultPort, source = process.env }) {
  const schema = z.object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    HOST: z.string().min(1).default("127.0.0.1"),
    [portVariable]: z.coerce.number().int().min(1).max(65535).default(defaultPort),
  });

  const result = schema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid service configuration: ${issues}`);
  }

  return {
    environment: result.data.NODE_ENV,
    host: result.data.HOST,
    port: result.data[portVariable],
  };
}

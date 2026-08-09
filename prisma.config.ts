// Keep Prisma CLI commands on the same database as the Next.js runtime.
import { config as loadEnv } from "dotenv";
import { defineConfig } from "prisma/config";

loadEnv({ path: ".env.local" });
loadEnv();

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "ts-node --compiler-options {\"module\":\"CommonJS\"} prisma/seed.ts",
  },
  datasource: {
    url:
      process.env["WAYSTAY_DATABASE_URL_UNPOOLED"] ??
      process.env["WAYSTAY_DATABASE_URL"] ??
      process.env["DIRECT_URL"] ??
      process.env["DATABASE_URL"],
  },
});

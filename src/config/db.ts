import { Pool } from "pg";
import dotenv from "dotenv";
dotenv.config();

const pool = new Pool(
  process.env.DATABASE_URL
    ? {
        connectionString: process.env.DATABASE_URL,
        // SSL is enabled by default to keep Render/RDS deploys working out of
        // the box. Set PGSSLMODE=disable for local Docker/plain connections.
        ...(process.env.PGSSLMODE === "disable"
          ? {}
          : { ssl: { rejectUnauthorized: false } }),
      }
    : {
        host: process.env.DB_HOST,
        port: parseInt(process.env.DB_PORT || "5432"),
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
      }
);

pool.on("connect", () => console.log("✅ Connected to PostgreSQL"));
pool.on("error", (err) => console.error("❌ PostgreSQL error:", err.message));

export default pool;
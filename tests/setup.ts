import { testDbUrl } from "./helpers/config";

// Runs in the worker process before the test file (and therefore before the
// app) is imported. Environment set here is NOT overridden by dotenv, because
// dotenv only fills in variables that are missing.
process.env.NODE_ENV = "test";
process.env.DATABASE_URL = testDbUrl();
process.env.PGSSLMODE = "disable"; // local/CI Postgres has no SSL

process.env.JWT_SECRET ||= "test_jwt_secret";
process.env.REFRESH_SECRET ||= "test_refresh_secret";
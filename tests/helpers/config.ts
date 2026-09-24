export const testDbUrl = (): string =>
  process.env.DATABASE_URL_TEST || "postgres://postgres:postgres@127.0.0.1:5433/payflow_test";

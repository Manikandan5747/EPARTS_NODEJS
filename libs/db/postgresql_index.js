
const { Pool } = require("pg");

const pool = new Pool({
  host: process.env.DB_HOST || "host.docker.internal",
  port: process.env.DB_PORT || 5432,
  user: process.env.DB_USER || "postgres",
  password: process.env.DB_PASSWORD || "admin",
  database: process.env.DB_NAME || "eparts_development",
});

pool.on("connect", () => {
  console.log("✅ PostgreSQL connected successfully");
});

pool.on("error", (err) => {
  console.error("❌ PostgreSQL connection error", err);
});

module.exports = pool;

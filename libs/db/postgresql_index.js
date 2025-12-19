
const { Pool } = require("pg");

const pool = new Pool({
  host: process.env.DB_HOST || "10.33.30.5",
  port: process.env.DB_PORT || 5432,
  user: process.env.DB_USER || "postgres",
  password: process.env.DB_PASSWORD || "ExZ3naPw@32!perts",
  database: process.env.DB_NAME || "eparts_core",
});

pool.on("connect", () => {
  console.log("✅ PostgreSQL connected successfully");
});

pool.on("error", (err) => {
  console.error("❌ PostgreSQL connection error", err);
});

module.exports = pool;

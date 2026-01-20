const { Pool } = require("pg");

const connectionString = 'postgresql://postgres:SysAdmin1@localhost:5433/eparts_development';

const pool = new Pool({
  connectionString: connectionString,
});


pool.on("connect", () => {
  console.log("✅ PostgreSQL connected successfully");
});

pool.on("error", (err) => {
  console.error("❌ PostgreSQL connection error", err);
});

module.exports = pool;
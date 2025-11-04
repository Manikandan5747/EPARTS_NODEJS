
require('module-alias/register');
const cote = require('cote');
const pool = require('@libs/db/postgresql_index');

const responder = new cote.Responder({ name: 'role responder', key: 'role' });



responder.on('list', async (req, cb) => {
  console.log("📥 Received request: list");

  try {
    const result = await pool.query('SELECT * FROM roles');
    console.log("✅ Sending result:", result.rows.length);
    // return Promise.resolve(result);


     return Promise.resolve({
      status: 1,
      message: 'Role list fetched successfully',
      data: result.rows,
    })
  } catch (err) {
    console.error("❌ Error fetching data:", err);

    // ✅ Even errors should respond (so Requester doesn’t hang)
    cb({
      status: 0,
      message: 'Database error occurred',
      error: err,
    });
  }
});

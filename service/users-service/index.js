// require('module-alias/register');
// const cote = require('cote');
// const pool = require('@libs/db/postgresql_index');

// const responder = new cote.Responder({ name: 'users responder', key: 'users' });


// responder.on('list', async (req, cb) => {
//   console.log("list");
//   const result = await pool.query('SELECT * FROM restaurants');
//   console.log("result list", result.rows);
//   return Promise.resolve(result.rows)
// });


require('module-alias/register');
const cote = require('cote');
const pool = require('@libs/db/postgresql_index');

const redisHost = process.env.COTE_DISCOVERY_REDIS_HOST || '127.0.0.1';
const redisPort = process.env.COTE_DISCOVERY_REDIS_PORT || 6379;

const responder = new cote.Responder({
  name: 'users responder',
  key: 'users',
  redis: {
    host: redisHost,
    port: redisPort
  }
});



responder.on('ready', () => {
  console.log('✅ Users responder is ready and listening for requests...');
});


responder.on('list', async (req, cb) => {
  console.log("📥 Received request: list");

  try {
    const result = await pool.query('SELECT * FROM users');
    console.log("✅ Sending result:", result.rows.length);

    // return Promise.resolve({
    //   status: 1,
    //   message: 'User list fetched successfully',
    //   data: result.rows,
    // })
    return Promise.resolve(result)
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


// 🟢 Get user by ID
responder.on('getById', async (req, cb) => {
  let user_id = req.id;

  const result = await pool.query(
    'SELECT * FROM users WHERE id = $1',
    [user_id]
  );

  console.log("✅ Sending result:", result.rows.length);

  return Promise.resolve({
    status: 1,
    message: 'User list fetched successfully',
    data: result.rows,
  });
});




// 🟢 Delete user by ID
responder.on('delete', async (req, cb) => {
  try {
    const user_id = req.id;

    // Correct SQL syntax — no '*'
    const result = await pool.query(
      'DELETE FROM users WHERE id = $1',
      [user_id]
    );

    // console.log(`✅ Deleted user ID: ${user_id}, Rows affected: ${result.rowCount}`);

    return Promise.resolve({
      status: 1,
      message:  'User deleted successfully' ,
      // data: result.rows,
    });


  } catch (err) {
    console.error('❌ Error deleting user:', err);
    cb({
      status: 0,
      message: 'Database error while deleting user',
      error: err.message,
    });
  }
});


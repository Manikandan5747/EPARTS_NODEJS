const pool = require('@libs/db/postgresql_index');

exports.logActivity = async ({
    req,
    app_type,
    action,
    description,
    entity_id,
    old_data,
    new_data,
    created_by
}) => {
    const client = await pool.connect();

    try {
        /* ---------------- 1. USER + SESSION ---------------- */
        const userResult = await client.query(
            `
      SELECT
        u.user_id,
        u.role_id,
        us.user_session_id
      FROM users u
      LEFT JOIN users_login ul
        ON ul.user_id = u.user_id
       AND u.is_active = TRUE
      LEFT JOIN user_session us
        ON us.login_id = ul.login_id
      WHERE u.user_uuid = $1
      LIMIT 1
      `,
            [created_by]
        );

        if (!userResult.rows.length) {
            console.error("Invalid or inactive user for activity log");
            return;
        }

        const user_id = userResult.rows[0].user_id;
        const role_id = userResult.rows[0].role_id;
        const session_id = userResult.rows[0].user_session_id || null;

        /* ---------------- 2. ROLE NAME ---------------- */
        const roleResult = await client.query(
            `SELECT role_name FROM user_role WHERE role_id = $1`,
            [role_id]
        );

        const user_role = roleResult.rows[0]?.role_name || null;

        /* ---------------- 3. MODULE FROM ROUTE ---------------- */
        const baseRoute = '/' + req.originalUrl.split('/')[2];

        const moduleRes = await client.query(
            `
      SELECT module_id, routename, modulename
      FROM module
      WHERE routename = $1
        AND is_active = TRUE
      `,
            [baseRoute]
        );

        if (!moduleRes.rows.length) {
            console.error("Module not registered for activity log:", baseRoute);
            return;
        }

        const { module_id, routename, modulename } = moduleRes.rows[0];

        /* ---------------- 4. INSERT ACTIVITY LOG ---------------- */
        await client.query(
            `
      INSERT INTO activity_log (
        app_type, module_id, module, action, description,
        entity_type, entity_id, user_id, user_role, session_id,
        request_method, endpoint, ip_address, device_info,
        old_data, new_data, created_by
      ) VALUES (
        $1,$2,$3,$4,$5,
        $6,$7,$8,$9,$10,
        $11,$12,$13,$14,
        $15,$16,$17
      )
      `,
            [
                app_type,
                module_id,
                routename,
                action,
                description,
                modulename,
                entity_id,
                user_id,
                user_role,
                session_id,
                req.method,
                req.originalUrl,
                req.ip,
                req.headers['user-agent'],
                old_data,
                new_data,
                created_by
            ]
        );

    } catch (err) {
        console.error("Activity log error:", err.message);
    } finally {
        client.release();
    }
};

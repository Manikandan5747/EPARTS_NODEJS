require('module-alias/register');
const cote = require('cote');
const pool = require('@libs/db/postgresql_index');
const logger = require('@libs/logger/logger');
const { buildAdvancedSearchQuery } = require('@libs/advanced-search/advance-filter');
const { saveErrorLog } = require('@libs/common/common-util');

// REDIS CONNECTION & COTE RESPONDER SETUP
const redisHost = process.env.COTE_DISCOVERY_REDIS_HOST || '127.0.0.1';
const redisPort = process.env.COTE_DISCOVERY_REDIS_PORT || 6379;

const responder = new cote.Responder({
    name: 'reports responder',
    key: 'reports',
    redis: { host: redisHost, port: redisPort }
});



responder.on('report-master', async (req, cb) => {
    try {


        const result = await pool.query(`SELECT * FROM report_master`);

        return cb(null, {
            status: true, code: 1000,
            message: "Role list fetched successfully",
            count: result.rowCount,
            data: result.rows
        });

    } catch (err) {
        logger.error("Responder Error (list roles):", err);
        // Save log to table
        await saveErrorLog(pool, {
            api_name: 'list-role',
            method: 'GET',
            payload: null,
            message: err.message,
            stack: err.stack,
            error_code: 2004
        });
        return cb(null, { status: false, code: 2004, error: err.message });
    }
});

responder.on('show-report', async (req, cb) => {

    try {
        const reportId = 1;

        // Build dynamic SQL
        const sqlQuery = await buildDynamicQuery(reportId);

        console.log("Generated SQL:\n", sqlQuery);

        // Run the query
        const result = await pool.query(sqlQuery);
        console.log("result", result.rows);

        return cb(null, {
            status: true, code: 1000,
            message: "list fetched successfully",
            count: result.rowCount,
            data: result.rows
        });

        // res.json({
        //     status: true,
        //     report_id: reportId,
        //     query: sqlQuery,   // For debugging
        //     data: result.rows
        // });
    } catch (err) {
        console.error("Report Run Error:", err);
        res.status(500).json({
            status: false,
            message: "Failed to run report",
            error: err.message
        });
    }
    // try {
    //     const { role_uuid } = req;

    //     const result = await pool.query(
    //         `SELECT role_id,role_uuid,role_name, dept_id,is_deleted,deleted_at,deleted_by, cmp_id, is_active
    //          FROM user_role
    //          WHERE role_uuid = $1 AND is_deleted = FALSE`,
    //         [role_uuid]
    //     );

    //     if (result.rowCount === 0) {
    //         // Save log to table
    //         await saveErrorLog(pool, {
    //             api_name: 'getById-role',  // the API name
    //             method: 'GET',
    //             payload: { role_uuid: role_uuid },  // or req body/query params
    //             message: "Role not found",
    //             stack: null,
    //             error_code: 2003
    //         });
    //         return cb(null, { status: false, code: 2003, error: "Role not found" });
    //     }

    //     return cb(null, { status: true, code: 1000, data: result.rows[0] });

    // } catch (err) {
    //     logger.error("Responder Error (getById role):", err);
    //     // Save log to table
    //     await saveErrorLog(pool, {
    //         api_name: 'getById-role',
    //         method: 'GET',
    //         payload: { role_uuid: role_uuid },
    //         message: err.message,
    //         stack: err.stack,
    //         error_code: 2004
    //     });
    //     return cb(null, { status: false, code: 2004, error: err.message });
    // }
});


// --------------------------------------------
// GET REPORT MASTER
// --------------------------------------------
responder.on('report-master', async (req, cb) => {
    try {
        const result = await pool.query(`SELECT * FROM report_master ORDER BY report_id`);

        return cb(null, {
            status: true,
            code: 1000,
            message: "Report list fetched successfully",
            count: result.rowCount,
            data: result.rows
        });

    } catch (err) {
        await saveErrorLog(pool, {
            api_name: 'report-master',
            method: 'GET',
            payload: null,
            message: err.message,
            stack: err.stack,
            error_code: 2004
        });

        return cb(null, { status: false, code: 2004, error: err.message });
    }
});

// --------------------------------------------
// GET FIELDS
// --------------------------------------------
responder.on('report-fields-list', async (req, cb) => {
    try {
        const result = await pool.query(
            `SELECT * FROM report_fields WHERE report_id=$1 ORDER BY sort_order ASC`,
            [req.report_id]
        );

        return cb(null, {
            status: true,
            code: 1000,
            message: "Fields fetched successfully",
            count: result.rowCount,
            data: result.rows
        });

    } catch (err) {
        await saveErrorLog(pool, {
            api_name: 'report-fields-list',
            method: 'GET',
            payload: req,
            message: err.message,
            stack: err.stack,
            error_code: 2004
        });
        return cb(null, { status: false, code: 2004, error: err.message });
    }
});

// --------------------------------------------
// INSERT FIELD
// --------------------------------------------
responder.on('report-field-insert', async (req, cb) => {
    try {
        const body = req.body;

        // const result = await pool.query(
        //     `INSERT INTO report_fields (report_id, column_name, display_name, is_selected, sort_order, source_table) 
        //      VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        //     [body.reportId, body.column_name, body.display_name, body.is_selected, body.sort_order, body.source_table]
        // );

        const result = await pool.query(
            `INSERT INTO report_fields (report_id, column_name, display_name, is_selected, sort_order) 
             VALUES ($1,$2,$3,$4,$5) RETURNING report_field_id`,
            [body.reportId, body.column_name, body.display_name, body.is_selected, body.sort_order,]
        );

        return cb(null, {
            status: true,
            code: 1000,
            message: "Field added successfully",
            data: { id: result.rows[0].id }
        });

    } catch (err) {
        await saveErrorLog(pool, {
            api_name: 'report-field-insert',
            method: 'POST',
            payload: req.body,
            message: err.message,
            stack: err.stack,
            error_code: 2004
        });
        return cb(null, { status: false, code: 2004, error: err.message });
    }
});

// --------------------------------------------
// UPDATE FIELD
// --------------------------------------------
responder.on('report-field-update', async (req, cb) => {
    try {
        const body = req.body;
        delete body.report_field_id
        console.log("body", body);

        const fields = Object.keys(body).map((k, i) => `${k}=$${i + 1}`);
        const values = Object.values(body);
        console.log("fields", fields);
        console.log("values", values);
        console.log("values", `UPDATE report_fields SET ${fields.join(", ")} WHERE report_field_id=$${values.length + 1}`);
        await pool.query(
            `UPDATE report_fields SET ${fields.join(", ")} WHERE report_field_id=$${values.length + 1}`,
            [...values, req.id]
        );

        return cb(null, { status: true, code: 1000, message: "Field updated successfully" });

    } catch (err) {
        await saveErrorLog(pool, {
            api_name: 'report-field-update',
            method: 'PUT',
            payload: req.body,
            message: err.message,
            stack: err.stack,
            error_code: 2004
        });
        return cb(null, { status: false, code: 2004, error: err.message });
    }
});

// --------------------------------------------
// DELETE FIELD
// --------------------------------------------
responder.on('report-field-delete', async (req, cb) => {
    try {
        await pool.query(`DELETE FROM report_fields WHERE report_field_id=$1`, [req.id]);

        return cb(null, { status: true, code: 1000, message: "Field deleted successfully" });

    } catch (err) {
        await saveErrorLog(pool, {
            api_name: 'report-field-delete',
            method: 'DELETE',
            payload: req,
            message: err.message,
            stack: err.stack,
            error_code: 2004
        });
        return cb(null, { status: false, code: 2004, error: err.message });
    }
});

// --------------------------------------------
// MAPPINGS CRUD
// --------------------------------------------
responder.on('report-mappings-list', async (req, cb) => {
    try {
        const result = await pool.query(
            `SELECT * FROM report_foreign_mappings WHERE report_id=$1 ORDER BY mapping_id`,
            [req.report_id]
        );

        return cb(null, {
            status: true,
            code: 1000,
            message: "Mappings fetched successfully",
            count: result.rowCount,
            data: result.rows
        });

    } catch (err) {
        return cb(null, { status: false, code: 2004, error: err.message });
    }
});

responder.on('report-mapping-insert', async (req, cb) => {
    try {
        const body = req.body;
        console.log("body", body);

        const result = await pool.query(
            `INSERT INTO report_foreign_mappings 
             (report_id, base_table_column, reference_table, reference_column, display_column)
             VALUES ($1,$2,$3,$4,$5)
             RETURNING mapping_id`,
            [body.reportId, body.base_table_column, body.reference_table, body.reference_column, body.display_column]
        );

        return cb(null, {
            status: true,
            code: 1000,
            message: "Mapping added successfully",
            data: { id: result.rows[0].id }
        });

    } catch (err) {
        console.log("err", err);
        return cb(null, { status: false, code: 2004, error: err.message });
    }
});

responder.on('report-mapping-update', async (req, cb) => {
    try {
        const body = req.body;

        const keys = Object.keys(body).map((key, i) => `${key}=$${i + 1}`);
        const values = Object.values(body);

        await pool.query(
            `UPDATE report_foreign_mappings SET ${keys.join(", ")} WHERE id=$${values.length + 1}`,
            [...values, req.id]
        );

        return cb(null, { status: true, code: 1000, message: "Mapping updated successfully" });

    } catch (err) {
        return cb(null, { status: false, code: 2004, error: err.message });
    }
});

responder.on('report-mapping-delete', async (req, cb) => {
    try {
        await pool.query(`DELETE FROM report_foreign_mappings WHERE id=$1`, [req.id]);

        return cb(null, { status: true, code: 1000, message: "Mapping deleted successfully" });

    } catch (err) {
        return cb(null, { status: false, code: 2004, error: err.message });
    }
});

// --------------------------------------------
// META TABLES + COLUMNS
// --------------------------------------------
responder.on('meta-tables', async (req, cb) => {
    try {
        const result = await pool.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema='public'
        `);

        return cb(null, {
            status: true,
            code: 1000,
            message: "Tables fetched successfully",
            count: result.rowCount,
            data: result.rows
        });

    } catch (err) {
        return cb(null, { status: false, code: 2004, error: err.message });
    }
});

responder.on('meta-columns', async (req, cb) => {
    try {
        const result = await pool.query(
            `SELECT column_name 
             FROM information_schema.columns 
             WHERE table_name=$1`,
            [req.table]
        );

        return cb(null, {
            status: true,
            code: 1000,
            message: "Columns fetched successfully",
            count: result.rowCount,
            data: result.rows
        });

    } catch (err) {
        return cb(null, { status: false, code: 2004, error: err.message });
    }
});


/////////////////////////////////////////////////////////////////////////////////////////////////////////////////

// ----------------------------
// Helper: Fetch Report Master
// ----------------------------
async function getReportMaster(reportId) {
    const res = await pool.query(
        `SELECT * FROM report_master WHERE report_id = $1`,
        [reportId]
    );
    return res.rows[0];
}

// ----------------------------
// Helper: Fetch Selected Fields
// ----------------------------
async function getReportFields(reportId) {
    const res = await pool.query(
        `SELECT column_name, display_name 
         FROM report_fields 
         WHERE report_id = $1 AND is_selected = TRUE
         ORDER BY sort_order ASC`,
        [reportId]
    );
    return res.rows;
}

// ----------------------------
// Helper: Fetch Foreign Mappings
// ----------------------------
async function getForeignMappings(reportId) {
    const res = await pool.query(
        `SELECT * FROM report_foreign_mappings WHERE report_id = $1`,
        [reportId]
    );
    return res.rows;
}


// ----------------------------
// Dynamic Query Builder
// ----------------------------
// ----------------------------
// Fully Dynamic Query Builder
// ----------------------------
async function buildDynamicQuery(reportId) {
    const report = await getReportMaster(reportId);
    const baseTable = report.base_table;
    const baseAlias = "b";

    // Fetch selected fields and foreign key mappings
    const fields = await getReportFields(reportId);           // report_fields
    const mappings = await getForeignMappings(reportId);      // report_foreign_mappings

    // Assign unique aliases for each join table
    const joinAliases = {};
    mappings.forEach((m, index) => {
        if (!joinAliases[m.reference_table]) {
            joinAliases[m.reference_table] = `t${index + 1}`;
            m.alias = joinAliases[m.reference_table];
        } else {
            m.alias = joinAliases[m.reference_table];
        }
    });

    // ----------------------
    // Build SELECT section
    // ----------------------
    const selectParts = fields.map(field => {
        // Try to find a foreign key mapping for this field
        const mapping = mappings.find(m => m.display_column === field.column_name);
        if (mapping) {
            // Column comes from a joined table
            return `${mapping.alias}.${mapping.display_column} AS "${field.display_name}"`;
        } else {
            // Column comes from base table
            return `${baseAlias}.${field.column_name} AS "${field.display_name}"`;
        }
    });

    const selectSQL = "SELECT " + selectParts.join(", ");

    // ----------------------
    // FROM section
    // ----------------------
    const fromSQL = `FROM ${baseTable} ${baseAlias}`;

    // ----------------------
    // JOIN section
    // ----------------------
    const joinSQL = mappings
        .filter((m, i, self) => self.findIndex(x => x.reference_table === m.reference_table) === i) // unique joins
        .map(m => {
            return `LEFT JOIN ${m.reference_table} ${m.alias} ON ${baseAlias}.${m.base_table_column} = ${m.alias}.${m.reference_column}`;
        })
        .join("\n");

    // ----------------------
    // Combine full query
    // ----------------------
    const finalQuery = `${selectSQL}\n${fromSQL}\n${joinSQL}`;
    return finalQuery;
}




// ----------------------------
// Dynamic Query Builder
// ----------------------------
// async function buildDynamicQuery(reportId) {
//     const report = await getReportMaster(reportId);
//     const baseTable = report.base_table;

//     const fields = await getReportFields(reportId);
//     const mappings = await getForeignMappings(reportId);

//     // Assign aliases
//     const baseAlias = "b";
//     mappings.forEach((m, index) => {
//         m.alias = `t${index + 1}`; // t1, t2, t3 ...
//     });

//     // SELECT section
//     let selectParts = [];

//     fields.forEach(field => {
//         const mapping = mappings.find(m => m.base_table_column === field.column_name);

//         if (mapping) {
//             // JOIN field: select using alias
//             selectParts.push(
//                 `${mapping.alias}.${mapping.display_column} AS "${field.display_name}"`
//             );
//         } else {
//             // Base field: use base alias (IMPORTANT FIX)
//             selectParts.push(
//                 `${baseAlias}.${field.column_name} AS "${field.display_name}"`
//             );
//         }
//     });

//     const selectSQL = "SELECT " + selectParts.join(", ");

//     // FROM section with alias
//     const fromSQL = `FROM ${baseTable} ${baseAlias}`;

//     // JOIN section
//     let joinSQL = "";

//     mappings.forEach(m => {
//         joinSQL += `
// LEFT JOIN ${m.reference_table} ${m.alias}
//        ON ${baseAlias}.${m.base_table_column} = ${m.alias}.${m.reference_column}
// `;
//     });

//     return `
// ${selectSQL}
// ${fromSQL}
// ${joinSQL}
// `.trim();
// }














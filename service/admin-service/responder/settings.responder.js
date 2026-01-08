require('module-alias/register');
const cote = require('cote');
const pool = require('@libs/db/postgresql_index');
const logger = require('@libs/logger/logger');
const { buildAdvancedSearchQuery } = require('@libs/advanced-search/advance-filter');

// --------------------------------------------------
// COTE RESPONDER
// --------------------------------------------------
const responder = new cote.Responder({
    name: 'settings responder',
    key: 'settings'
});


// --------------------------------------------------
// CREATE SETTING
// --------------------------------------------------
responder.on('create-setting', async (req, cb) => {
    try {
        const {
            setcategory,
            setparameter,
            setparametervalue,
            settingdate,
            settingexpirydate,
            created_by
        } = req.body;

        if (!setcategory || !setparameter) {
            return cb(null, { status: false, code: 2001, error: 'Category and Parameter are required' });
        }

        // DUPLICATE CHECK
        const check = await pool.query(
            `
            SELECT setting_id
            FROM settings
            WHERE 
            LOWER(setcategory) = LOWER($1)
            AND LOWER(setparameter) = LOWER($2)
            AND is_deleted = FALSE
        `,
            [setcategory.trim(), setparameter.trim()]
        );


        if (check.rowCount > 0) {
            return cb(null, { status: false, code: 2002, error: 'Setting already exists' });
        }

        const insert = await pool.query(`
            INSERT INTO settings
            (setcategory, setparameter, setparametervalue, settingdate, settingexpirydate, created_by)
            VALUES ($1,$2,$3,$4,$5,$6)
            RETURNING *
        `, [
            setcategory,
            setparameter,
            setparametervalue,
            settingdate,
            settingexpirydate,
            created_by
        ]);

        cb(null, {
            status: true,
            code: 1000,
            message: 'Setting created successfully',
            data: insert.rows[0]
        });

    } catch (err) {
        logger.error('Responder Error (create-setting):', err);
        cb(null, { status: false, code: 2004, error: err.message });
    }
});


// --------------------------------------------------
// LIST SETTINGS
// --------------------------------------------------
responder.on('list-setting', async (req, cb) => {
  try {
    const query = `
      SELECT 
        s.setting_id,
        s.setting_uuid,
        s.setcategory,
        s.setparameter,
        s.setparametervalue,
        s.settingdate,
        s.settingexpirydate,
        s.is_active,
        s.assigned_to,
        s.assigned_at,
        s.created_at,
        s.created_by,
        s.modified_at,
        s.modified_by,
        s.deleted_at,
        s.deleted_by,
        s.is_deleted,
        creators.username AS createdByName,
        updaters.username AS updatedByName
      FROM settings s
      LEFT JOIN users creators ON s.created_by = creators.user_uuid
      LEFT JOIN users updaters ON s.modified_by = updaters.user_uuid
      WHERE s.is_deleted = FALSE
      ORDER BY s.created_at ASC
    `;

    const result = await pool.query(query);

    return cb(null, {
      status: true,
      code: 1000,
      message: "Settings list fetched successfully",
      count: result.rowCount,
      data: result.rows
    });

  } catch (err) {
    logger.error("Responder Error (list settings):", err);
    return cb(null, { status: false, code: 2004, error: err.message });
  }
});



// --------------------------------------------------
// GET SETTING BY ID
// --------------------------------------------------
responder.on('getById-setting', async (req, cb) => {
    try {
        const { setting_uuid } = req;

        const result = await pool.query(`
            SELECT *
            FROM settings
            WHERE setting_uuid=$1
              AND is_deleted=FALSE
        `, [setting_uuid]);

        if (result.rowCount === 0) {
            return cb(null, { status: false, code: 2003, error: 'Setting not found' });
        }

        cb(null, {
            status: true,
            code: 1000,
            data: result.rows[0]
        });

    } catch (err) {
        logger.error('Responder Error (getById-setting):', err);
        cb(null, { status: false, code: 2004, error: err.message });
    }
});


// --------------------------------------------------
// UPDATE SETTING
// --------------------------------------------------
responder.on('update-setting', async (req, cb) => {
    try {
        const { setting_uuid, body } = req;
        const {
            setcategory,
            setparameter,
            setparametervalue,
            settingdate,
            settingexpirydate,
            modified_by
        } = body;

        // DUPLICATE CHECK (EXCLUDE CURRENT)
        const check = await pool.query(`
            SELECT setting_uuid
            FROM settings
            WHERE setcategory=$1
              AND setparameter=$2
              AND is_deleted=FALSE
              AND setting_uuid != $3
        `, [setcategory, setparameter, setting_uuid]);

        if (check.rowCount > 0) {
            return cb(null, { status: false, code: 2002, error: 'Setting already exists' });
        }

        const update = await pool.query(`
            UPDATE settings
            SET setcategory=$1,
                setparameter=$2,
                setparametervalue=$3,
                settingdate=$4,
                settingexpirydate=$5,
                modified_by=$6,
                modified_at=NOW()
            WHERE setting_uuid=$7
            RETURNING *
        `, [
            setcategory,
            setparameter,
            setparametervalue,
            settingdate,
            settingexpirydate,
            modified_by,
            setting_uuid
        ]);

        cb(null, {
            status: true,
            code: 1000,
            message: 'Setting updated successfully',
            data: update.rows[0]
        });

    } catch (err) {
        logger.error('Responder Error (update-setting):', err);
        cb(null, { status: false, code: 2004, error: err.message });
    }
});


// --------------------------------------------------
// DELETE SETTING (SOFT DELETE)
// --------------------------------------------------
responder.on('delete-setting', async (req, cb) => {
    try {
        const { setting_uuid } = req;
        const { deleted_by } = req.body;

        await pool.query(`
            UPDATE settings
            SET is_deleted=TRUE,
                is_active=FALSE,
                deleted_at=NOW(),
                deleted_by=$1
            WHERE setting_uuid=$2
        `, [deleted_by, setting_uuid]);

        cb(null, {
            status: true,
            code: 1000,
            message: 'Setting deleted successfully'
        });

    } catch (err) {
        logger.error('Responder Error (delete-setting):', err);
        cb(null, { status: false, code: 2004, error: err.message });
    }
});


// --------------------------------------------------
// STATUS CHANGE
// --------------------------------------------------
responder.on('status-setting', async (req, cb) => {
    try {
        const { setting_uuid } = req;
        const { is_active, modified_by } = req.body;

        await pool.query(`
            UPDATE settings
            SET is_active=$1,
                modified_by=$2,
                modified_at=NOW()
            WHERE setting_uuid=$3
        `, [is_active, modified_by, setting_uuid]);

        cb(null, {
            status: true,
            code: 1000,
            message: 'Setting status updated'
        });

    } catch (err) {
        logger.error('Responder Error (status-setting):', err);
        cb(null, { status: false, code: 2004, error: err.message });
    }
});


// --------------------------------------------------
// ADVANCED FILTER — SETTINGS
// --------------------------------------------------
responder.on('advancefilter-setting', async (req, cb) => {
    try {
        const result = await buildAdvancedSearchQuery({
            pool,
            reqBody: req.body,

            table: 'settings',
            alias: 'S',
            defaultSort: 'created_at',

            joinSql: `
                LEFT JOIN users creators ON S.created_by = creators.user_uuid
                LEFT JOIN users updaters ON S.modified_by = updaters.user_uuid
            `,

            allowedFields: [
                'setcategory',
                'setparameter',
                'setparametervalue',
                'is_active',
                'created_at',
                'modified_at',
                'createdByName',
                'updatedByName'
            ],

            customFields: {
                createdByName: {
                    select: 'creators.username',
                    search: 'creators.username',
                    sort: 'creators.username'
                },
                updatedByName: {
                    select: 'updaters.username',
                    search: 'updaters.username',
                    sort: 'updaters.username'
                }
            },

            baseWhere: `
                S.is_deleted = FALSE
            `
        });

        return cb(null, { status: true, code: 1000, result });

    } catch (err) {
        console.error('[advancefilter-setting] error:', err);
        return cb(null, { status: false, code: 2004, error: err.message });
    }
});


// --------------------------------------------------
// FIND SETTING CATEGORY BY NAME
// --------------------------------------------------
responder.on('setcategory-setting', async (req, cb) => {
    try {
        const { setcategory } = req;

        const result = await pool.query(`
            SELECT *
            FROM settings
            WHERE setcategory=$1
              AND is_deleted=FALSE
        `, [setcategory]);

        if (result.rowCount === 0) {
            return cb(null, { status: false, code: 2003, error: 'Setting not found' });
        }

        cb(null, {
            status: true,
            code: 1000,
            data: result.rows
        });

    } catch (err) {
        logger.error('Responder Error (setcategory-setting):', err);
        cb(null, { status: false, code: 2004, error: err.message });
    }
});


module.exports = responder;

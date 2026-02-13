require('module-alias/register');
const pool = require('@libs/db/postgresql_index');
const express = require('express');
const logger = require('@libs/logger/logger');
const { saveErrorLog } = require('@libs/common/common-util');
const validateMaster = require('@libs/common/validate-master');


const multipart = require('connect-multiparty');
const path = require('path');




module.exports = function createMasterRoutes({
    requester,
    entityName,
    foreignKeyMap,
    fileFields = [],
    uploadFolder = '',
    filterKey = null,
}) {
    const router = express.Router();

    const api = (action) => `${action}-${entityName}`;


    const uploadDir = path.join('/app/assets', uploadFolder);

    const multipartMiddleware = multipart({
        uploadDir,
        maxFilesSize: 5 * 1024 * 1024 // 5MB
    });


    /* ---------------- CREATE ---------------- */
    router.post('/create', multipartMiddleware, async (req, res) => {
        try {
            console.log("entityName", entityName);

            const error = validateMaster(entityName, 'create', req.body);
            if (error) {
                return res.status(500).json({
                    header_type: "ERROR",
                    message_visibility: true,
                    status: false,
                    code: 2001,
                    error,
                    message: "Validation failed"
                });
            }

            // 🔹 attach uploaded files
            if (fileFields.length > 0) {
                const fileData = extractFiles(req, fileFields);
                req.body = { ...req.body, ...fileData };
            }

            console.log("req.body", req.body);

            // 🔹 Resolve FK generically
            req.body = await resolveForeignKeys(req.body, pool, foreignKeyMap);
            console.log("body1 req.body", req.body);
            const baseRoute = '/' + req.originalUrl.split('/')[2];
            /* ---------------- CALL RESPONDER ---------------- */
            const result = await requester.send({
                type: api('create'),
                body: req.body,
                meta: {
                    method: req.method,
                    endpoint: req.originalUrl,
                    ip: req.ip,
                    user_agent: req.headers['user-agent'],
                    baseRoute
                }
            });

            if (!result.status) {
                await saveErrorLog({
                    api_name: api('create'),
                    method: 'POST',
                    payload: req.body,
                    message: result.error,
                    stack: result.stack || '',
                    error_code: result.code || 2004
                });
                return res.status(500).json(result);
            }

            res.status(201).json(result);

        } catch (err) {
            logger.error(err.message);
            res.status(500).json({
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2004,
                message: err.message,
                error: err.message
            });
        }
    });

    /* ---------------- LIST ---------------- */
    router.get('/list', async (req, res) => {
        try {
            const result = await requester.send({ type: api('list') });

            if (!result.status) {
                await saveErrorLog({
                    api_name: api('list'),
                    method: 'GET',
                    payload: null,
                    message: result.error,
                    stack: result.stack || '',
                    error_code: result.code || 2004
                });
                return res.status(500).json(result);
            }

            res.json(result);
        } catch (err) {
            res.status(500).json({
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2004,
                message: err.message,
                error: err.message
            });
        }
    });

    /* ---------------- FIND BY ID ---------------- */
    router.get('/findbyid/:id', async (req, res) => {
        try {

            const mode = req.query.mode || 'view';
            const user_id = req.query.user_id;

            const result = await requester.send({
                type: api('getById'),
                uuid: req.params.id,
                mode,
                body: { user_id }
            });

            if (!result.status) {
                await saveErrorLog({
                    api_name: api('getById'),
                    method: 'GET',
                    payload: { uuid: req.params.id },
                    message: result.error,
                    stack: result.stack || '',
                    error_code: result.code || 2004
                });
                return res.status(500).json(result);
            }

            res.json(result);
        } catch (err) {
            res.status(500).json({
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2004,
                message: err.message,
                error: err.message
            });
        }
    });

    /* ---------------- UPDATE ---------------- */
    router.post('/update/:id', multipartMiddleware, async (req, res) => {
        try {

            // 🔹 attach uploaded files
            if (fileFields.length > 0 && req.files) {
                const fileData = extractFiles(req, fileFields);

                // remove null values → keep old image
                Object.keys(fileData).forEach(key => {
                    if (!fileData[key]) delete fileData[key];
                });

                req.body = { ...req.body, ...fileData };
            }


            console.log("req.body", req.body);

            // 🔹 Resolve FK generically
            req.body = await resolveForeignKeys(req.body, pool, foreignKeyMap);
            const baseRoute = '/' + req.originalUrl.split('/')[2];
            const result = await requester.send({
                type: api('update'),
                uuid: req.params.id,
                body: req.body,
                meta: {
                    method: req.method,
                    endpoint: req.originalUrl,
                    ip: req.ip,
                    user_agent: req.headers['user-agent'],
                    baseRoute
                }
            });

            if (!result.status) {
                await saveErrorLog({
                    api_name: api('update'),
                    method: 'POST',
                    payload: req.body,
                    message: result.error,
                    stack: result.stack || '',
                    error_code: result.code || 2004
                });
                return res.status(500).json(result);
            }

            res.json(result);
        } catch (err) {
            res.status(500).json({
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2004,
                message: err.message,
                error: err.message
            });
        }
    });

    /* ---------------- DELETE ---------------- */
    router.post('/delete/:id', async (req, res) => {
        try {
            const result = await requester.send({
                type: api('delete'),
                uuid: req.params.id,
                body: req.body
            });

            if (!result.status) {
                await saveErrorLog({
                    api_name: api('delete'),
                    method: 'POST',
                    payload: { uuid: req.params.id },
                    message: result.error,
                    stack: result.stack || '',
                    error_code: result.code || 2004
                });
                return res.status(500).json(result);
            }

            res.json(result);
        } catch (err) {
            res.status(500).json({
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2004,
                message: err.message,
                error: err.message
            });
        }
    });

    /* ---------------- STATUS ---------------- */
    router.post('/status/:id', async (req, res) => {
        try {
            const result = await requester.send({
                type: api('status'),
                uuid: req.params.id,
                body: req.body
            });

            res.json(result);
        } catch (err) {
            res.status(500).json({
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2004,
                message: err.message,
                error: err.message
            });
        }
    });

    /* ---------------- ADVANCE FILTER ---------------- */
    router.post('/pagination-list', async (req, res) => {
        try {
            const result = await requester.send({
                type: `advancefilter-${entityName}`,
                body: req.body
            });

            res.json(result);
        } catch (err) {
            res.status(500).json({
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2004,
                message: err.message,
                error: err.message
            });
        }
    });

    /* ---------------- LIST + SEARCH + PAGINATION ---------------- */
    router.get('/listpagination', async (req, res) => {
        try {

            const {
                search = '',
                page = 1,
                limit = 10
            } = req.query;

            let payload = {
                type: `${entityName}-listpagination`,
                search,
                page: Number(page),
                limit: Number(limit)
            }
            if (filterKey == 'state_uuid') {
                let state_uuid = req.query && req.query.state_uuid;
                if (!state_uuid) {
                    return cb(null, {
                        status: false,
                        code: 2001,
                        error: "State UUID is required"
                    });
                }
                payload.state_uuid = req.query.state_uuid
            }
            const result = await requester.send(payload);


            if (!result.status) {
                await saveErrorLog({
                    api_name: `${entityName}-listpagination`,
                    method: 'GET',
                    payload: { search, page, limit },
                    message: result.error,
                    stack: result.stack || '',
                    error_code: result.code || 2004
                });

                return res.status(500).json(result);
            }

            return res.status(200).json(result);

        } catch (err) {
            logger.error(`Error in ${entityName} listpagination:`, err);
            return res.status(500).json({
                status: false,
                code: 2004,
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2004,
                message: err.message,
                error: err.message
            });
        }
    });

    router.post('/lock/:id', async (req, res) => {
        try {
            const result = await requester.send({
                type: `lock-${entityName}`,
                uuid: req.params.id,
                body: { user_id: req.body.user_id }
            });

            if (!result.status) {
                await saveErrorLog({
                    api_name: `lock-${entityName}`,
                    method: 'POST',
                    payload: {
                        uuid: req.params.id,
                        user_id: req.body.user_id
                    },
                    message: result.error,
                    stack: result.stack || '',
                    error_code: result.code || 2004
                });

                return res.status(500).json(result);
            }

            return res.json(result);

        } catch (err) {
            logger.error(err.message);
            return res.status(500).json({
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2004,
                message: err.message,
                error: err.message
            });
        }
    });

    router.post('/unlock/:id', async (req, res) => {
        try {
            const result = await requester.send({
                type: `unlock-${entityName}`,
                uuid: req.params.id,
                body: { user_id: req.body.user_id }
            });

            if (!result.status) {
                await saveErrorLog({
                    api_name: `unlock-${entityName}`,
                    method: 'POST',
                    payload: {
                        uuid: req.params.id,
                        user_id: req.body.user_id
                    },
                    message: result.error,
                    stack: result.stack || '',
                    error_code: result.code || 2004
                });

                return res.status(500).json(result);
            }

            return res.json(result);

        } catch (err) {
            logger.error(err.message);
            return res.status(500).json({
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2004,
                message: err.message,
                error: err.message
            });
        }
    });

    async function resolveForeignKeys(body, pool, foreignKeyMap = {}) {

        for (const field in foreignKeyMap) {
            const { table, uuidColumn, idColumn, targetField } = foreignKeyMap[field];

            if (!body[field]) continue;

            const result = await pool.query(
                `SELECT ${idColumn} FROM ${table}
             WHERE ${uuidColumn} = $1 AND is_deleted = FALSE`,
                [body[field]]
            );

            if (result.rowCount === 0) {
                throw new Error(`${table} not found`);
            }

            body[targetField] = result.rows[0][idColumn];
            delete body[field];
        }

        return body;
    }

    function extractFiles(req, fileFields) {
        const filesData = {};

        const getPath = (file) =>
            file?.path ? file.path.replace(/\\/g, '/') : null;

        fileFields.forEach(field => {
            filesData[field] = getPath(req.files?.[field]);
        });

        return filesData;
    }


    return router;
};

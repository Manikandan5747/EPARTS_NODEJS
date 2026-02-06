require('module-alias/register');
const pool = require('@libs/db/postgresql_index');
const express = require('express');
const logger = require('@libs/logger/logger');
const { saveErrorLog } = require('@libs/common/common-util');
const validateMaster = require('@libs/common/validate-master');

module.exports = function createMasterRoutes({
    requester,
    entityName
}) {
    const router = express.Router();

    const api = (action) => `${action}-${entityName}`;

    /* ---------------- CREATE ---------------- */
    router.post('/create', async (req, res) => {
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

            /* ------------------------------------------
               Convert brand_id → brand_uuid for MODEL
            ------------------------------------------- */
            if (entityName === 'model') {
                const { brand_uuid } = req.body;

                if (!brand_uuid) {
                    return res.status(400).json({
                        status: false,
                        code: 2001,
                        message: "brand_uuid is required"
                    });
                }

                const brandResult = await pool.query(
                    `SELECT brand_id FROM brand WHERE brand_uuid = $1 AND is_deleted = FALSE`,
                    [brand_uuid]
                );

                if (brandResult.rowCount === 0) {
                    return res.status(404).json({
                        status: false,
                        code: 2003,
                        message: "Brand not found"
                    });
                }

                // Replace brand_id with brand_uuid
                req.body.brand_id = brandResult.rows[0].brand_id;
                delete req.body.brand_uuid;
            }

            /* ---------------- CALL RESPONDER ---------------- */
            const result = await requester.send({
                type: api('create'),
                body: req.body
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
    router.post('/update/:id', async (req, res) => {
        try {


            /* ------------------------------------------
            Convert brand_id → brand_uuid for MODEL
         ------------------------------------------- */
            if (api('update') === 'update-model') {
                const { brand_uuid } = req.body;

                if (!brand_uuid) {
                    return res.status(400).json({
                        status: false,
                        code: 2001,
                        message: "brand_uuid is required"
                    });
                }

                const brandResult = await pool.query(
                    `SELECT brand_id FROM brand WHERE brand_uuid = $1 AND is_deleted = FALSE`,
                    [brand_uuid]
                );

                if (brandResult.rowCount === 0) {
                    return res.status(404).json({
                        status: false,
                        code: 2003,
                        message: "Brand not found"
                    });
                }

                // Replace brand_id with brand_uuid
                req.body.brand_id = brandResult.rows[0].brand_id;
                delete req.body.brand_uuid;
            }

            const result = await requester.send({
                type: api('update'),
                uuid: req.params.id,
                body: req.body
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

            const result = await requester.send({
                type: `${entityName}-listpagination`,
                search,
                page: Number(page),
                limit: Number(limit)
            });

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


    return router;
};

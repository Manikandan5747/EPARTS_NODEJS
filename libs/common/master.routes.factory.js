require('module-alias/register');

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
                    status: false,
                    code: 2001,
                    error
                });
            }

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
            res.status(500).json({ error: err.message });
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
            res.status(500).json({ error: err.message });
        }
    });

    /* ---------------- FIND BY ID ---------------- */
    router.get('/findbyid/:id', async (req, res) => {
        try {
            const result = await requester.send({
                type: api('getById'),
                uuid: req.params.id
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
            res.status(500).json({ error: err.message });
        }
    });

    /* ---------------- UPDATE ---------------- */
    router.post('/update/:id', async (req, res) => {
        try {
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
            res.status(500).json({ error: err.message });
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
            res.status(500).json({ error: err.message });
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
            res.status(500).json({ error: err.message });
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
            res.status(500).json({ error: err.message });
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
                error: err.message
            });
        }
    });


    return router;
};

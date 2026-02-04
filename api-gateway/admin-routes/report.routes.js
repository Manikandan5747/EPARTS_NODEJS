require('module-alias/register');

const express = require('express');
const router = express.Router();
const reportRequester = require('@libs/requesters/admin-requesters/report-requester');
const logger = require('@libs/logger/logger');

// --------------------------------------
// LIST ALL REPORT MASTER
// --------------------------------------
router.get('/report-master', async (req, res) => {
    try {
        const result = await reportRequester.send({ type: 'report-master' });
        res.send(result);
    } catch (err) {
        logger.error("Error in report-master/list:", err.message);
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


// --------------------------------------
// LIST ALL SHOW REPORT 
// --------------------------------------
router.get('/show-report', async (req, res) => {
    try {
        const result = await reportRequester.send({ type: 'show-report' });
        res.send(result);
    } catch (err) {
        logger.error("Error in show-report/list:", err.message);
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



// ----------------------------
// GET ALL REPORT MASTER
// ----------------------------
router.get('/reports/list', async (req, res) => {
    try {
        const result = await reportRequester.send({ type: 'report-master' });
        res.send(result);
    } catch (err) {
        logger.error("Error in GET /reports/list:", err.message);
        res.status(500).json({ status: false, code: 2004, error: err.message });
    }
});

// ----------------------------
// GET FIELDS BY REPORT ID
// ----------------------------
router.get('/report-admin/fields/:reportId', async (req, res) => {
    try {
        const result = await reportRequester.send({
            type: 'report-fields-list',
            report_id: req.params.reportId
        });
        res.send(result);
    } catch (err) {
        logger.error("Error in GET /fields:", err.message);
        res.status(500).json({ status: false, code: 2004, error: err.message });
    }
});

// ADD REPORT FIELD
router.post('/report-admin/fields', async (req, res) => {
    try {
        const result = await reportRequester.send({
            type: 'report-field-insert',
            body: req.body
        });
        res.send(result);
    } catch (err) {
        logger.error("Error in POST /fields:", err.message);
        res.status(500).json({ status: false, code: 2004, error: err.message });
    }
});

// UPDATE FIELD
router.put('/report-admin/fields/:id', async (req, res) => {
    try {
        const result = await reportRequester.send({
            type: 'report-field-update',
            id: req.params.id,
            body: req.body
        });
        res.send(result);
    } catch (err) {
        logger.error("Error in PUT /fields:", err.message);
        res.status(500).json({ status: false, code: 2004, error: err.message });
    }
});

// DELETE FIELD
router.delete('/report-admin/fields/:id', async (req, res) => {
    try {
        const result = await reportRequester.send({
            type: 'report-field-delete',
            id: req.params.id
        });
        res.send(result);
    } catch (err) {
        logger.error("Error in DELETE /fields:", err.message);
        res.status(500).json({ status: false, code: 2004, error: err.message });
    }
});

// ----------------------------
// MAPPINGS
// ----------------------------
router.get('/report-admin/mappings/:reportId', async (req, res) => {
    try {
        const result = await reportRequester.send({
            type: 'report-mappings-list',
            report_id: req.params.reportId
        });
        res.send(result);
    } catch (err) {
        logger.error("Error GET /mappings:", err.message);
        res.status(500).json({ status: false, code: 2004, error: err.message });
    }
});

router.post('/report-admin/mappings', async (req, res) => {
    try {
        const result = await reportRequester.send({
            type: 'report-mapping-insert',
            body: req.body
        });
        res.send(result);
    } catch (err) {
        logger.error("Error POST /mappings:", err.message);
        res.status(500).json({ status: false, code: 2004, error: err.message });
    }
});

router.put('/report-admin/mappings/:id', async (req, res) => {
    try {
        const result = await reportRequester.send({
            type: 'report-mapping-update',
            id: req.params.id,
            body: req.body
        });
        res.send(result);
    } catch (err) {
        logger.error("Error PUT /mappings:", err.message);
        res.status(500).json({ status: false, code: 2004, error: err.message });
    }
});

router.delete('/report-admin/mappings/:id', async (req, res) => {
    try {
        const result = await reportRequester.send({
            type: 'report-mapping-delete',
            id: req.params.id
        });
        res.send(result);
    } catch (err) {
        logger.error("Error DELETE /mappings:", err.message);
        res.status(500).json({ status: false, code: 2004, error: err.message });
    }
});

// ----------------------------
// META TABLES + COLUMNS
// ----------------------------
router.get('/meta/tables', async (req, res) => {
    try {
        const result = await reportRequester.send({ type: 'meta-tables' });
        res.send(result);
    } catch (err) {
        logger.error("Error GET /meta/tables:", err);
        res.status(500).json({ status: false, code: 2004, error: err.message });
    }
});

router.get('/meta/columns/:table', async (req, res) => {
    try {
        const result = await reportRequester.send({
            type: 'meta-columns',
            table: req.params.table
        });
        res.send(result);
    } catch (err) {
        logger.error("Error GET /meta/columns:", err);
        res.status(500).json({ status: false, code: 2004, error: err.message });
    }
});

module.exports = router;

require('module-alias/register');

const express = require('express');
const router = express.Router();
const profilePrivilegeRequester = require('@libs/requesters/admin-requesters/role-data-access-requester');
const logger = require('@libs/logger/logger');
const { saveErrorLog } = require('@libs/common/common-util');


/* ======================================================
  // CREATE | UPDATE ROLE DATA ACCESS  (SAVE API)
====================================================== */
router.post('/save', async (req, res) => {
    try {
        const result = await profilePrivilegeRequester.send({
            type: 'create-update-role-data-access',
            body: req.body
        });

        if (!result.status) {
            await saveErrorLog({
                api_name: 'create-update-role-data-access',
                method: 'POST',
                payload: req.body,
                message: result.error,
                stack: result.stack || '',
                error_code: result.code || 2004
            });
            return res.status(500).json(result);
        }

        return res.status(200).json(result);

    } catch (err) {
        logger.error("Error in create-update-role-data-access/save:", err.message);
        res.status(500).json({ error: err.message });
    }
});


/* ======================================================
   FETCH ROLE DATA ACCESS DETAILS
====================================================== */
router.post('/fetch-details', async (req, res) => {
    try {
        const result = await profilePrivilegeRequester.send({
            type: 'fetch-role-data-access-details',
            body: req.body
        });

        if (!result.status) {
            await saveErrorLog({
                api_name: 'fetch-role-data-access-details',
                method: 'POST',
                payload: req.body,
                message: result.error,
                stack: result.stack || '',
                error_code: result.code || 2004
            });
            return res.status(500).json(result);
        }

        return res.json(result);

    } catch (err) {
        logger.error("Error in fetch-role-data-access-details:", err.message);
        res.status(500).json({ error: err.message });
    }
});





module.exports = router;

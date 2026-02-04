require('module-alias/register');

const express = require('express');
const router = express.Router();
const profilePrivilegeRequester = require('@libs/requesters/admin-requesters/profile-privilege-requester');
const logger = require('@libs/logger/logger');
const { saveErrorLog } = require('@libs/common/common-util');


/* ======================================================
   CREATE / UPDATE (Same API)
====================================================== */
router.post('/save', async (req, res) => {
    try {
        const result = await profilePrivilegeRequester.send({
            type: 'save-profile_privilege',
            body: req.body
        });

        if (!result.status) {
            await saveErrorLog({
                api_name: 'save-profile_privilege',
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
        logger.error("Error in profile-privilege/save:", err.message);
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


/* ======================================================
   LIST ALL PRIVILEGES
====================================================== */
router.get('/list', async (req, res) => {
    try {
        const result = await profilePrivilegeRequester.send({
            type: 'list-profile_privilege'
        });

        if (!result.status) {
            await saveErrorLog({
                api_name: 'list-profile_privilege',
                method: 'GET',
                payload: null,
                message: result.error,
                stack: result.stack || '',
                error_code: result.code || 2004
            });
            return res.status(500).json(result);
        }

        return res.json(result);

    } catch (err) {
        logger.error("Error in profile-privilege/list:", err.message);
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


/* ======================================================
   LIST BY PROFILE ID
====================================================== */
router.get('/list/:profile_id', async (req, res) => {
    try {
        const result = await profilePrivilegeRequester.send({
            type: 'listByProfile-profile_privilege',
            profile_id: req.params.profile_id
        });

        if (!result.status) {
            await saveErrorLog({
                api_name: 'listByProfile-profile_privilege',
                method: 'GET',
                payload: { profile_id: req.params.profile_id },
                message: result.error,
                stack: result.stack || '',
                error_code: result.code || 2004
            });
            return res.status(500).json(result);
        }

        return res.json(result);

    } catch (err) {
        logger.error("Error in profile-privilege/listByProfile:", err.message);
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


module.exports = router;

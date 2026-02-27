// require('module-alias/register');

// const express = require('express');
// const router = express.Router();
// const buyerRequester = require('@libs/requesters/admin-requesters/buyer-requester');
// const logger = require('@libs/logger/logger');
// const { saveErrorLog } = require('@libs/common/common-util');
// const multipart = require("connect-multiparty");
// const path = require('path');
// //test
// const uploadDir = path.join('/app/assets', 'users_icon');
// const multipartMiddleware = multipart({ uploadDir });


// // --------------------------------------
// // CREATE USERS
// // --------------------------------------
// router.post('/create', multipartMiddleware, async (req, res) => {
//     try {

//         // FILE
//         const profileIconPath = req.files?.profile_icon_path?.path || null;

//         const result = await buyerRequester.send({
//             type: 'create-buyer-full',
//             body: {
//                 ...req.body,
//                 profile_icon: profileIconPath
//             }
//         });

//         if (!result.status) {
//             // SAVE ERROR LOG
//             await saveErrorLog({
//                 api_name: 'create-buyer-full',
//                 method: 'POST',
//                 payload: req.body,
//                 message: result.error,
//                 stack: result.stack || '',
//                 error_code: result.code || 2004
//             });
//             return res.status(500).json(result);
//         }

//         res.status(201).send(result);

//     } catch (err) {
//         logger.error("Error in users/create:", err.message);
//         await saveErrorLog({
//             api_name: 'create-buyer-full',
//             method: 'POST',
//             payload: req.body,
//             message: err.message,
//             stack: err.stack,
//             error_code: 2004
//         });
//         res.status(500).json({
//     header_type: "ERROR",
//     message_visibility: true,
//     status: false,
//     code: 2004,
//     message: err.message,
//     error: err.message
// });
//     }
// });

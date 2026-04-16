require('module-alias/register');

const express = require('express');
const router = express.Router();
const cmsRequester = require('@libs/requesters/admin/cms-requesters/cms-requesters');
const logger = require('@libs/logger/logger');
const { saveErrorLog } = require('@libs/common/common-util');
const multipart = require("connect-multiparty");
const path = require('path');
const uploadDir = path.join('/app/assets','cms');
const multipartMiddleware = multipart({ uploadDir });


// --------------------------------------
// UPLOAD FILE (IMAGE / VIDEO)
// --------------------------------------


router.post('/filesave', multipartMiddleware, async (req, res) => {
    try {

        const result = await cmsRequester.send({
            type: 'cms-filesave',
            body: req.body,
            files: req.files
        });

        if (!result.status) {

            await saveErrorLog({
                api_name: 'cms-filesave',
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

        logger.error("Error in filesave:", err.message);

        await saveErrorLog({
            api_name: 'cms-filesave',
            method: 'POST',
            payload: req.body,
            message: err.message,
            stack: err.stack,
            error_code: 2004
        });

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


// --------------------------------------
// DELETE 
// --------------------------------------
router.post('/delete/:id', async (req, res) => {
    try {
        const result = await cmsRequester.send({
            type: 'delete-cms',
            item_uuid: req.params.id,
            body: req.body
        });

        if (!result.status) {
            // SAVE ERROR LOG
            await saveErrorLog({
                api_name: 'delete-cms',
                method: 'POST',
                payload: req.body,
                message: result.error,
                stack: result.stack || '',
                error_code: result.code || 2004
            });
            return res.status(500).json(result);
        }

        res.send(result);

    } catch (err) {
        logger.error("Error in cms/delete:", err.message);

        await saveErrorLog({
            api_name: 'delete-cms',
            method: 'POST',
            payload: req.body,
            message: err.message,
            stack: err.stack,
            error_code: 2004
        });

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
//  ADMIN - HOME - CREATE 
// --------------------------------------

router.post('/create-home/:page_key', async (req, res) => {
    try {


        const result = await cmsRequester.send({
            type: 'create-home',
            page_key: req.params.page_key,
            body: {
                ...req.body
            }
        });

        if (!result.status) {
            // SAVE ERROR LOG
            await saveErrorLog({
                api_name: 'create-home',
                method: 'POST',
                payload: req.body,
                message: result.error,
                stack: result.stack || '',
                error_code: result.code || 2004
            });
            return res.status(500).json(result);
        }

        res.status(201).send(result);

    } catch (err) {
        logger.error("Error in home/create:", err.message);
        await saveErrorLog({
            api_name: 'create-home',
            method: 'POST',
            payload: req.body,
            message: err.message,
            stack: err.stack,
            error_code: 2004
        });
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
//  ADMIN - HOME - UPDATE 
// --------------------------------------
router.post('/update-home/:page_key', async (req, res) => {
    try {
        const result = await cmsRequester.send({
            type: 'update-home',
            page_key: req.params.page_key,
            body: {
                ...req.body
            }        
        });

        if (!result.status) {
            // SAVE ERROR LOG
            await saveErrorLog({
                api_name: 'update-home',
                method: 'POST',
                payload: req.body,
                message: result.error,
                stack: result.stack || '',
                error_code: result.code || 2004
            });
            return res.status(500).json(result);
        }

        res.send(result);

    } catch (err) {
        logger.error("Error in home/update:", err.message);

        await saveErrorLog({
            api_name: 'update-home',
            method: 'POST',
            payload: req.body,
            message: err.message,
            stack: err.stack,
            error_code: 2004
        });

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
// ADMIN - HOME - LIST BY PAGE KEY
// --------------------------------------
router.get('/list-admin-home/:page_key', async (req, res) => {
    try {


        const result = await cmsRequester.send({
            type: 'listbypagekey-home',
            page_key: req.params.page_key
        });
        if (!result.status) {
            // SAVE ERROR LOG
            await saveErrorLog({
                api_name: 'listbypagekey-home',
                method: 'GET',
                message: result.error,
                stack: result.stack || '',
                error_code: result.code || 2004
            });
            return res.status(500).json(result);
        }
        res.json(result);
    } catch (err) {
        logger.error("Error in cms/listbypagekey:", err.message);

    // SAVE ERROR LOG for unexpected exception
    await saveErrorLog({
      api_name: 'list-admin-home',
      method: 'GET',
      payload: { page_key: req.params.page_key },
      message: err.message,
      stack: err.stack,
      error_code: 2004
    });

    res.status(500).json({
      header_type: "ERROR",
      message_visibility: true,
      status: false,
      code: 2004,
      message: err.message,
      error: err.message
    });    }
});

// --------------------------------------------------
// ADMIN - HOME - LIST BY ID WITH EDIT LOCK
// --------------------------------------------------

// router.post('/listwithlock-admin-home/:page_key', async (req, res) => {
//     try {


//         const result = await cmsRequester.send({
//             type: 'listwithlock-home',
//             page_key: req.params.page_key,
//             body: { user_id: req.body.user_id, mode: req.body.mode }

//         });
//         if (!result.status) {
//             // SAVE ERROR LOG
//             await saveErrorLog({
//                 api_name: 'listwithlock-home',
//                 method: 'POST',
//                 message: result.error,
//                 stack: result.stack || '',
//                 error_code: result.code || 2004
//             });
//             return res.status(500).json(result);
//         }
//         res.json(result);
//     } catch (err) {
//         logger.error("Error in cms/listwithlock:", err.message);

//     // SAVE ERROR LOG for unexpected exception
//     await saveErrorLog({
//       api_name: 'listwithlock-home',
//       method: 'POST',
//       payload: { page_key: req.params.page_key },
//       message: err.message,
//       stack: err.stack,
//       error_code: 2004
//     });

//     res.status(500).json({
//       header_type: "ERROR",
//       message_visibility: true,
//       status: false,
//       code: 2004,
//       message: err.message,
//       error: err.message
//     });    }
// });


router.post('/listbyidwithlock-admin-home/:id', async (req, res) => {
    try {


        const result = await cmsRequester.send({
            type: 'listbyidwithlock-home',
            page_uuid: req.params.id,
            body: { user_id: req.body.user_id, mode: req.body.mode }

        });
        if (!result.status) {
            // SAVE ERROR LOG
            await saveErrorLog({
                api_name: 'listbyidwithlock-home',
                method: 'POST',
                message: result.error,
                stack: result.stack || '',
                error_code: result.code || 2004
            });
            return res.status(500).json(result);
        }
        res.json(result);
    } catch (err) {
        logger.error("Error in cms/listbyidwithlock:", err.message);

    // SAVE ERROR LOG for unexpected exception
    await saveErrorLog({
      api_name: 'listbyidwithlock-home',
      method: 'POST',
      payload: { page_uuid: req.params.id },
      message: err.message,
      stack: err.stack,
      error_code: 2004
    });

    res.status(500).json({
      header_type: "ERROR",
      message_visibility: true,
      status: false,
      code: 2004,
      message: err.message,
      error: err.message
    });    }
});

// --------------------------------------
//  ADMIN - ABOUT US - CREATE 
// --------------------------------------

router.post('/create-aboutus/:page_key', async (req, res) => {
    try {


        const result = await cmsRequester.send({
            type: 'create-aboutus',
            page_key: req.params.page_key,
            body: {
                ...req.body
            }
        });

        if (!result.status) {
            // SAVE ERROR LOG
            await saveErrorLog({
                api_name: 'create-aboutus',
                method: 'POST',
                payload: req.body,
                message: result.error,
                stack: result.stack || '',
                error_code: result.code || 2004
            });
            return res.status(500).json(result);
        }

        res.status(201).send(result);

    } catch (err) {
        logger.error("Error in aboutus/create:", err.message);
        await saveErrorLog({
            api_name: 'create-aboutus',
            method: 'POST',
            payload: req.body,
            message: err.message,
            stack: err.stack,
            error_code: 2004
        });
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
//  ADMIN - ABOUT US - UPDATE 
// --------------------------------------
router.post('/update-aboutus/:page_key', async (req, res) => {
    try {
        const result = await cmsRequester.send({
            type: 'update-aboutus',
            page_key: req.params.page_key,
            body: {
                ...req.body
            }        
        });

        if (!result.status) {
            // SAVE ERROR LOG
            await saveErrorLog({
                api_name: 'update-aboutus',
                method: 'POST',
                payload: req.body,
                message: result.error,
                stack: result.stack || '',
                error_code: result.code || 2004
            });
            return res.status(500).json(result);
        }

        res.send(result);

    } catch (err) {
        logger.error("Error in aboutus/update:", err.message);

        await saveErrorLog({
            api_name: 'update-aboutus',
            method: 'POST',
            payload: req.body,
            message: err.message,
            stack: err.stack,
            error_code: 2004
        });

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
// ADMIN - ABOUT US - LIST BY PAGE KEY
// --------------------------------------
router.get('/list-admin-aboutus/:page_key', async (req, res) => {
    try {


        const result = await cmsRequester.send({
            type: 'listbypagekey-aboutus',
            page_key: req.params.page_key
        });
        if (!result.status) {
            // SAVE ERROR LOG
            await saveErrorLog({
                api_name: 'listbypagekey-aboutus',
                method: 'GET',
                message: result.error,
                stack: result.stack || '',
                error_code: result.code || 2004
            });
            return res.status(500).json(result);
        }
        res.json(result);
    } catch (err) {
        logger.error("Error in aboutus/listbypagekey:", err.message);

    // SAVE ERROR LOG for unexpected exception
    await saveErrorLog({
      api_name: 'list-admin-aboutus',
      method: 'GET',
      payload: { page_key: req.params.page_key },
      message: err.message,
      stack: err.stack,
      error_code: 2004
    });

    res.status(500).json({
      header_type: "ERROR",
      message_visibility: true,
      status: false,
      code: 2004,
      message: err.message,
      error: err.message
    });    }
});

// --------------------------------------
// ADMIN - ABOUT US - LIST BY ID WITH EDIT LOCK
// --------------------------------------
// router.get('/list-admin-aboutus/:page_key', async (req, res) => {
//     try {


//         const result = await cmsRequester.send({
//             type: 'listbypagekey-aboutus',
//             page_key: req.params.page_key
//         });
//         if (!result.status) {
//             // SAVE ERROR LOG
//             await saveErrorLog({
//                 api_name: 'listbypagekey-aboutus',
//                 method: 'GET',
//                 message: result.error,
//                 stack: result.stack || '',
//                 error_code: result.code || 2004
//             });
//             return res.status(500).json(result);
//         }
//         res.json(result);
//     } catch (err) {
//         logger.error("Error in aboutus/listbypagekey:", err.message);

//     // SAVE ERROR LOG for unexpected exception
//     await saveErrorLog({
//       api_name: 'list-admin-aboutus',
//       method: 'GET',
//       payload: { page_key: req.params.page_key },
//       message: err.message,
//       stack: err.stack,
//       error_code: 2004
//     });

//     res.status(500).json({
//       header_type: "ERROR",
//       message_visibility: true,
//       status: false,
//       code: 2004,
//       message: err.message,
//       error: err.message
//     });    }
// });


router.post('/listbyidwithlock-admin-aboutus/:id', async (req, res) => {
    try {


        const result = await cmsRequester.send({
            type: 'listbyidwithlock-aboutus',
            page_uuid: req.params.id,
            body: { user_id: req.body.user_id, mode: req.body.mode }
        });
        if (!result.status) {
            // SAVE ERROR LOG
            await saveErrorLog({
                api_name: 'listbyidwithlock-aboutus',
                method: 'POST',
                message: result.error,
                stack: result.stack || '',
                error_code: result.code || 2004
            });
            return res.status(500).json(result);
        }
        res.json(result);
    } catch (err) {
        logger.error("Error in aboutus/listbyidwithlock:", err.message);

    // SAVE ERROR LOG for unexpected exception
    await saveErrorLog({
      api_name: 'listbyidwithlock-aboutus',
      method: 'POST',
      payload: { page_uuid: req.params.id },
      message: err.message,
      stack: err.stack,
      error_code: 2004
    });

    res.status(500).json({
      header_type: "ERROR",
      message_visibility: true,
      status: false,
      code: 2004,
      message: err.message,
      error: err.message
    });    }
});

// --------------------------------------
//  ADMIN - CONTACT US - CREATE 
// --------------------------------------

router.post('/create-contactus/:page_key', async (req, res) => {
    try {


        const result = await cmsRequester.send({
            type: 'create-contactus',
            page_key: req.params.page_key,
            body: {
                ...req.body
            }
        });

        if (!result.status) {
            // SAVE ERROR LOG
            await saveErrorLog({
                api_name: 'create-contactus',
                method: 'POST',
                payload: req.body,
                message: result.error,
                stack: result.stack || '',
                error_code: result.code || 2004
            });
            return res.status(500).json(result);
        }

        res.status(201).send(result);

    } catch (err) {
        logger.error("Error in contactus/create:", err.message);
        await saveErrorLog({
            api_name: 'create-contactus',
            method: 'POST',
            payload: req.body,
            message: err.message,
            stack: err.stack,
            error_code: 2004
        });
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
//  ADMIN - CONTACT US - UPDATE 
// --------------------------------------
router.post('/update-contactus/:page_key', async (req, res) => {
    try {
        const result = await cmsRequester.send({
            type: 'update-contactus',
            page_key: req.params.page_key,
            body: {
                ...req.body
            }        
        });

        if (!result.status) {
            // SAVE ERROR LOG
            await saveErrorLog({
                api_name: 'update-contactus',
                method: 'POST',
                payload: req.body,
                message: result.error,
                stack: result.stack || '',
                error_code: result.code || 2004
            });
            return res.status(500).json(result);
        }

        res.send(result);

    } catch (err) {
        logger.error("Error in contactus/update:", err.message);

        await saveErrorLog({
            api_name: 'update-contactus',
            method: 'POST',
            payload: req.body,
            message: err.message,
            stack: err.stack,
            error_code: 2004
        });

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
// ADMIN - CONTACT US - LIST BY PAGE KEY
// --------------------------------------
router.get('/list-admin-contactus/:page_key', async (req, res) => {
    try {


        const result = await cmsRequester.send({
            type: 'listbypagekey-contactus',
            page_key: req.params.page_key
        });
        if (!result.status) {
            // SAVE ERROR LOG
            await saveErrorLog({
                api_name: 'listbypagekey-contactus',
                method: 'GET',
                message: result.error,
                stack: result.stack || '',
                error_code: result.code || 2004
            });
            return res.status(500).json(result);
        }
        res.json(result);
    } catch (err) {
        logger.error("Error in contactus/listbypagekey:", err.message);

    // SAVE ERROR LOG for unexpected exception
    await saveErrorLog({
      api_name: 'list-admin-contactus',
      method: 'GET',
      payload: { page_key: req.params.page_key },
      message: err.message,
      stack: err.stack,
      error_code: 2004
    });

    res.status(500).json({
      header_type: "ERROR",
      message_visibility: true,
      status: false,
      code: 2004,
      message: err.message,
      error: err.message
    });    }
});


// --------------------------------------
// ADMIN - CONTACT US - LIST BY ID WITH EDIT LOCK
// --------------------------------------
// router.get('/list-admin-contactus/:page_key', async (req, res) => {
//     try {


//         const result = await cmsRequester.send({
//             type: 'listbypagekey-contactus',
//             page_key: req.params.page_key
//         });
//         if (!result.status) {
//             // SAVE ERROR LOG
//             await saveErrorLog({
//                 api_name: 'listbypagekey-contactus',
//                 method: 'GET',
//                 message: result.error,
//                 stack: result.stack || '',
//                 error_code: result.code || 2004
//             });
//             return res.status(500).json(result);
//         }
//         res.json(result);
//     } catch (err) {
//         logger.error("Error in contactus/listbypagekey:", err.message);

//     // SAVE ERROR LOG for unexpected exception
//     await saveErrorLog({
//       api_name: 'list-admin-contactus',
//       method: 'GET',
//       payload: { page_key: req.params.page_key },
//       message: err.message,
//       stack: err.stack,
//       error_code: 2004
//     });

//     res.status(500).json({
//       header_type: "ERROR",
//       message_visibility: true,
//       status: false,
//       code: 2004,
//       message: err.message,
//       error: err.message
//     });    }
// });


router.post('/listbyidwithlock-admin-contactus/:id', async (req, res) => {
    try {


        const result = await cmsRequester.send({
            type: 'listbyidwithlock-contactus',
            page_uuid: req.params.id,
             body: { user_id: req.body.user_id, mode: req.body.mode }
        });
        if (!result.status) {
            // SAVE ERROR LOG
            await saveErrorLog({
                api_name: 'listbyidwithlock-contactus',
                method: 'POST',
                message: result.error,
                stack: result.stack || '',
                error_code: result.code || 2004
            });
            return res.status(500).json(result);
        }
        res.json(result);
    } catch (err) {
        logger.error("Error in contactus/listbyidwithlock:", err.message);

    // SAVE ERROR LOG for unexpected exception
    await saveErrorLog({
      api_name: 'listbyidwithlock',
      method: 'POST',
      payload: { page_uuid: req.params.id },
      message: err.message,
      stack: err.stack,
      error_code: 2004
    });

    res.status(500).json({
      header_type: "ERROR",
      message_visibility: true,
      status: false,
      code: 2004,
      message: err.message,
      error: err.message
    });    }
});

// --------------------------------------
// COMPANY INFO - LIST
// --------------------------------------
router.get('/list-companyinfo', async (req, res) => {
    try {


        const result = await cmsRequester.send({
            type: 'list-companyinfo'
        });
        if (!result.status) {
            // SAVE ERROR LOG
            await saveErrorLog({
                api_name: 'list-companyinfo',
                method: 'GET',
                message: result.error,
                stack: result.stack || '',
                error_code: result.code || 2004
            });
            return res.status(500).json(result);
        }
        res.json(result);
    } catch (err) {
        logger.error("Error in companyinfo/list:", err.message);

    // SAVE ERROR LOG for unexpected exception
    await saveErrorLog({
      api_name: 'list-companyinfo',
      method: 'GET',
      payload: { page_key: req.params.page_key },
      message: err.message,
      stack: err.stack,
      error_code: 2004
    });

    res.status(500).json({
      header_type: "ERROR",
      message_visibility: true,
      status: false,
      code: 2004,
      message: err.message,
      error: err.message
    });    }
});


// --------------------------------------
// HOME PAGE - LIST
// --------------------------------------
router.get('/list-home/:page_key', async (req, res) => {
  try {


        const result = await cmsRequester.send({
            type: 'list-home',
            page_key: req.params.page_key
        });
        if (!result.status) {
            // SAVE ERROR LOG
            await saveErrorLog({
                api_name: 'list-home',
                method: 'GET',
                message: result.error,
                stack: result.stack || '',
                error_code: result.code || 2004
            });
            return res.status(500).json(result);
        }
        res.json(result);
    } catch (err) {
        logger.error("Error in home/list:", err.message);

    // SAVE ERROR LOG for unexpected exception
    await saveErrorLog({
      api_name: 'list-home',
      method: 'GET',
      payload: { page_key: req.params.page_key },
      message: err.message,
      stack: err.stack,
      error_code: 2004
    });

    res.status(500).json({
      header_type: "ERROR",
      message_visibility: true,
      status: false,
      code: 2004,
      message: err.message,
      error: err.message
    });    }
});

// --------------------------------------
// ABOUT US PAGE - LIST
// --------------------------------------
router.get('/list-aboutus/:page_key', async (req, res) => {
  try {


        const result = await cmsRequester.send({
            type: 'list-aboutus',
            page_key: req.params.page_key
        });
        if (!result.status) {
            // SAVE ERROR LOG
            await saveErrorLog({
                api_name: 'list-aboutus',
                method: 'GET',
                message: result.error,
                stack: result.stack || '',
                error_code: result.code || 2004
            });
            return res.status(500).json(result);
        }
        res.json(result);
    } catch (err) {
        logger.error("Error in aboutus/list:", err.message);

    // SAVE ERROR LOG for unexpected exception
    await saveErrorLog({
      api_name: 'list-aboutus',
      method: 'GET',
      payload: { page_key: req.params.page_key },
      message: err.message,
      stack: err.stack,
      error_code: 2004
    });

    res.status(500).json({
      header_type: "ERROR",
      message_visibility: true,
      status: false,
      code: 2004,
      message: err.message,
      error: err.message
    });    }
});

// --------------------------------------
// CONTACT US PAGE - LIST
// --------------------------------------
router.get('/list-contactus/:page_key', async (req, res) => {
  try {

        const result = await cmsRequester.send({
            type: 'list-contactus',
            page_key: req.params.page_key
        });
        if (!result.status) {
            // SAVE ERROR LOG
            await saveErrorLog({
                api_name: 'list-contactus',
                method: 'GET',
                message: result.error,
                stack: result.stack || '',
                error_code: result.code || 2004
            });
            return res.status(500).json(result);
        }
        res.json(result);
    } catch (err) {
        logger.error("Error in contactus/list:", err.message);

    // SAVE ERROR LOG for unexpected exception
    await saveErrorLog({
      api_name: 'list-contactus',
      method: 'GET',
      payload: { page_key: req.params.page_key },
      message: err.message,
      stack: err.stack,
      error_code: 2004
    });

    res.status(500).json({
      header_type: "ERROR",
      message_visibility: true,
      status: false,
      code: 2004,
      message: err.message,
      error: err.message
    });    }
});

// --------------------------------------
// UNLOCK RECORD (SAVE / CANCEL)
// --------------------------------------

router.post('/unlock/:id', async (req, res) => {
    try {
        const result = await cmsRequester.send({
            type: 'unlock-cms',
            uuid: req.params.id,
            body: { user_id: req.body.user_id }
        });

        if (!result.status) {
            await saveErrorLog({
                api_name: 'unlock-cms',
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

// --------------------------------------
//  ADMIN - BUYER HOME - CREATE 
// --------------------------------------

router.post('/create-buyerhome/:page_key', async (req, res) => {
    try {


        const result = await cmsRequester.send({
            type: 'create-buyerhome',
            page_key: req.params.page_key,
            body: {
                ...req.body
            }
        });

        if (!result.status) {
            // SAVE ERROR LOG
            await saveErrorLog({
                api_name: 'create-buyerhome',
                method: 'POST',
                payload: req.body,
                message: result.error,
                stack: result.stack || '',
                error_code: result.code || 2004
            });
            return res.status(500).json(result);
        }

        res.status(201).send(result);

    } catch (err) {
        logger.error("Error in buyerhome/create:", err.message);
        await saveErrorLog({
            api_name: 'create-buyerhome',
            method: 'POST',
            payload: req.body,
            message: err.message,
            stack: err.stack,
            error_code: 2004
        });
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
//  ADMIN - BUYER HOME - UPDATE 
// --------------------------------------

router.post('/update-buyerhome/:page_key', async (req, res) => {
    try {
        const result = await cmsRequester.send({
            type: 'update-buyerhome',
            page_key: req.params.page_key,
            body: {
                ...req.body
            }        
        });

        if (!result.status) {
            // SAVE ERROR LOG
            await saveErrorLog({
                api_name: 'update-buyerhome',
                method: 'POST',
                payload: req.body,
                message: result.error,
                stack: result.stack || '',
                error_code: result.code || 2004
            });
            return res.status(500).json(result);
        }

        res.send(result);

    } catch (err) {
        logger.error("Error in buyerhome/update:", err.message);

        await saveErrorLog({
            api_name: 'update-buyerhome',
            method: 'POST',
            payload: req.body,
            message: err.message,
            stack: err.stack,
            error_code: 2004
        });

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


// --------------------------------------------------
// ADMIN - BUYER HOME - LIST BY ID WITH EDIT LOCK
// --------------------------------------------------

router.post('/listbyidwithlock-cmshome/:id', async (req, res) => {
    try {


        const result = await cmsRequester.send({
            type: 'listbyidwithlock-buyerhome',
            page_uuid: req.params.id,
            body: { user_id: req.body.user_id, mode: req.body.mode }

        });
        if (!result.status) {
            // SAVE ERROR LOG
            await saveErrorLog({
                api_name: 'listbyidwithlock-buyerhome',
                method: 'POST',
                message: result.error,
                stack: result.stack || '',
                error_code: result.code || 2004
            });
            return res.status(500).json(result);
        }
        res.json(result);
    } catch (err) {
        logger.error("Error in cms/listbyidwithlock:", err.message);

    // SAVE ERROR LOG for unexpected exception
    await saveErrorLog({
      api_name: 'listbyidwithlock-buyerhome',
      method: 'POST',
      payload: { page_uuid: req.params.id },
      message: err.message,
      stack: err.stack,
      error_code: 2004
    });

    res.status(500).json({
      header_type: "ERROR",
      message_visibility: true,
      status: false,
      code: 2004,
      message: err.message,
      error: err.message
    });    }
});


// --------------------------------------
// BUYER HOME PAGE - LIST
// --------------------------------------

router.get('/list-buyerhome/:page_key', async (req, res) => {
  try {


        const result = await cmsRequester.send({
            type: 'list-buyerhome',
            page_key: req.params.page_key
        });
        if (!result.status) {
            // SAVE ERROR LOG
            await saveErrorLog({
                api_name: 'list-buyerhome',
                method: 'GET',
                message: result.error,
                stack: result.stack || '',
                error_code: result.code || 2004
            });
            return res.status(500).json(result);
        }
        res.json(result);
    } catch (err) {
        logger.error("Error in buyerhome/list:", err.message);

    // SAVE ERROR LOG for unexpected exception
    await saveErrorLog({
      api_name: 'list-buyerhome',
      method: 'GET',
      payload: { page_key: req.params.page_key },
      message: err.message,
      stack: err.stack,
      error_code: 2004
    });

    res.status(500).json({
      header_type: "ERROR",
      message_visibility: true,
      status: false,
      code: 2004,
      message: err.message,
      error: err.message
    });    }
});


// --------------------------------------
//  ADMIN - SELLER HOME - CREATE 
// --------------------------------------

router.post('/create-sellerhome/:page_key', async (req, res) => {
    try {


        const result = await cmsRequester.send({
            type: 'create-sellerhome',
            page_key: req.params.page_key,
            body: {
                ...req.body
            }
        });

        if (!result.status) {
            // SAVE ERROR LOG
            await saveErrorLog({
                api_name: 'create-sellerhome',
                method: 'POST',
                payload: req.body,
                message: result.error,
                stack: result.stack || '',
                error_code: result.code || 2004
            });
            return res.status(500).json(result);
        }

        res.status(201).send(result);

    } catch (err) {
        logger.error("Error in sellerhome/create:", err.message);
        await saveErrorLog({
            api_name: 'create-sellerhome',
            method: 'POST',
            payload: req.body,
            message: err.message,
            stack: err.stack,
            error_code: 2004
        });
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
//  ADMIN - SELLER HOME - UPDATE 
// --------------------------------------

router.post('/update-sellerhome/:page_key', async (req, res) => {
    try {
        const result = await cmsRequester.send({
            type: 'update-sellerhome',
            page_key: req.params.page_key,
            body: {
                ...req.body
            }        
        });

        if (!result.status) {
            // SAVE ERROR LOG
            await saveErrorLog({
                api_name: 'update-sellerhome',
                method: 'POST',
                payload: req.body,
                message: result.error,
                stack: result.stack || '',
                error_code: result.code || 2004
            });
            return res.status(500).json(result);
        }

        res.send(result);

    } catch (err) {
        logger.error("Error in sellerhome/update:", err.message);

        await saveErrorLog({
            api_name: 'update-sellerhome',
            method: 'POST',
            payload: req.body,
            message: err.message,
            stack: err.stack,
            error_code: 2004
        });

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


// --------------------------------------------------
// ADMIN - SELLER HOME - LIST BY ID WITH EDIT LOCK
// --------------------------------------------------

router.post('/listbyidwithlock-admin-sellerhome/:id', async (req, res) => {
    try {


        const result = await cmsRequester.send({
            type: 'listbyidwithlock-sellerhome',
            page_uuid: req.params.id,
            body: { user_id: req.body.user_id, mode: req.body.mode }

        });
        if (!result.status) {
            // SAVE ERROR LOG
            await saveErrorLog({
                api_name: 'listbyidwithlock-sellerhome',
                method: 'POST',
                message: result.error,
                stack: result.stack || '',
                error_code: result.code || 2004
            });
            return res.status(500).json(result);
        }
        res.json(result);
    } catch (err) {
        logger.error("Error in cms/listbyidwithlock:", err.message);

    // SAVE ERROR LOG for unexpected exception
    await saveErrorLog({
      api_name: 'listbyidwithlock-sellerhome',
      method: 'POST',
      payload: { page_uuid: req.params.id },
      message: err.message,
      stack: err.stack,
      error_code: 2004
    });

    res.status(500).json({
      header_type: "ERROR",
      message_visibility: true,
      status: false,
      code: 2004,
      message: err.message,
      error: err.message
    });    }
});


// --------------------------------------
// SELLER HOME PAGE - LIST
// --------------------------------------

router.get('/list-sellerhome/:page_key', async (req, res) => {
  try {


        const result = await cmsRequester.send({
            type: 'list-sellerhome',
            page_key: req.params.page_key
        });
        if (!result.status) {
            // SAVE ERROR LOG
            await saveErrorLog({
                api_name: 'list-sellerhome',
                method: 'GET',
                message: result.error,
                stack: result.stack || '',
                error_code: result.code || 2004
            });
            return res.status(500).json(result);
        }
        res.json(result);
    } catch (err) {
        logger.error("Error in sellerhome/list:", err.message);

    // SAVE ERROR LOG for unexpected exception
    await saveErrorLog({
      api_name: 'list-sellerhome',
      method: 'GET',
      payload: { page_key: req.params.page_key },
      message: err.message,
      stack: err.stack,
      error_code: 2004
    });

    res.status(500).json({
      header_type: "ERROR",
      message_visibility: true,
      status: false,
      code: 2004,
      message: err.message,
      error: err.message
    });    }
});

// --------------------------------------
//  SECTION LIMIT - UPDATE 
// --------------------------------------
router.post('/update-section-limit', async (req, res) => {
    try {
        const result = await cmsRequester.send({
            type: 'update-section-limit',
            body: {
                ...req.body
            }        
        });

        if (!result.status) {
            // SAVE ERROR LOG
            await saveErrorLog({
                api_name: 'update-section-limit',
                method: 'POST',
                payload: req.body,
                message: result.error,
                stack: result.stack || '',
                error_code: result.code || 2004
            });
            return res.status(500).json(result);
        }

        res.send(result);

    } catch (err) {
        logger.error("Error in section limit/update:", err.message);

        await saveErrorLog({
            api_name: 'update-section-limit',
            method: 'POST',
            payload: req.body,
            message: err.message,
            stack: err.stack,
            error_code: 2004
        });

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
// RECORD AVAILABILITY CHECK
// --------------------------------------

router.get('/list-pages', async (req, res) => {
  try {

        const result = await cmsRequester.send({
            type: 'list-pages'
        });
        if (!result.status) {
            // SAVE ERROR LOG
            await saveErrorLog({
                api_name: 'list-pages',
                method: 'GET',
                message: result.error,
                stack: result.stack || '',
                error_code: result.code || 2004
            });
            return res.status(500).json(result);
        }
        res.json(result);
    } catch (err) {
        logger.error("Error in page records/list:", err.message);

    // SAVE ERROR LOG for unexpected exception
    await saveErrorLog({
      api_name: 'list-pages',
      method: 'GET',
      message: err.message,
      stack: err.stack,
      error_code: 2004
    });

    res.status(500).json({
      header_type: "ERROR",
      message_visibility: true,
      status: false,
      code: 2004,
      message: err.message,
      error: err.message
    });    }
});

module.exports = router;

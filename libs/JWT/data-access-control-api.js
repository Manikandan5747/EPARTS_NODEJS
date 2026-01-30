const jwt = require("jsonwebtoken");
const pool = require("@libs/db/postgresql_index");
const errorHandler = require("@libs/error-handler/error-handler");
const APP_CONFIG = require("@libs/JWT/app-config");
const logger = require("@libs/logger/logger");

module.exports = function apiAccess() {

    return async function (req, res, next) {
        try {

            /* ---------------- 1. GET TOKEN ---------------- */
            // let authorization =
            //     req.headers["authorization"] ||
            //     req.body.authorization ||
            //     req.query.authorization;

            // if (!authorization) {
            //     return errorHandler({ name: "NoAuthorizationProvided" }, req, res);
            // }

            // const token = authorization.startsWith("Bearer ")
            //     ? authorization.split(" ")[1]
            //     : authorization;

            /* ---------------- 2. VERIFY TOKEN ---------------- */
            // let verifiedData;
            // try {
            //     verifiedData = jwt.verify(token, APP_CONFIG.secretkey);
            // } catch (err) {
            //     if (err instanceof jwt.TokenExpiredError) {
            //         return errorHandler({ name: "TokenExpiredError" }, req, res);
            //     }
            //     return errorHandler({ name: "InvalidToken" }, req, res);
            // }

            // const { user_id } = verifiedData;
            const user_id  = 2;
            if (!user_id) {
                return errorHandler({ name: "InvalidToken" }, req, res);
            }

            /* ---------------- 3. GET USER ROLE ---------------- */
            const userResult = await pool.query(
                `SELECT role_id FROM users WHERE user_id = $1`,
                [user_id]
            );

            if (userResult.rowCount === 0) {
                return errorHandler({ name: "UserNotFound" }, req, res);
            }

            const role_id = userResult.rows[0].role_id;

            console.log("role_id: ", role_id);

            /* ---------------- 4. GET MODULE FROM ROUTE ---------------- */
            const baseRoute = '/' + req.originalUrl.split('/')[2]; 
            // /api/state/create -> /state
  console.log("baseRoute: ", baseRoute);
            const moduleRes = await pool.query(
                `SELECT module_id
                 FROM module
                 WHERE routename = $1
                   AND is_active = TRUE`,
                [baseRoute]
            );

            if (moduleRes.rowCount === 0) {
                return errorHandler({ name: "ModuleNotRegistered" }, req, res);
            }

            const module_id = moduleRes.rows[0].module_id;
 console.log("module_id: ", module_id);
            /* ---------------- 5. GET PROFILE PRIVILEGES ---------------- */
            const privRes = await pool.query(
                `SELECT pp.*
                 FROM profile_privilege pp
                 LEFT JOIN role r ON r.profile_id = pp.profile_id
                 WHERE r.role_id = $1 AND pp.module_id = $2`,
                [role_id, module_id]
            );

            if (privRes.rowCount === 0) {
                return errorHandler({ name: "NoModulePermission" }, req, res);
            }

            const priv = privRes.rows[0];
console.log("priv: ", priv);
            /* ---------------- 6. FULL GRANT ACCESS ---------------- */
            if (priv.fullgrantaccess === true) {
                return next();
            }

            /* ---------------- 7. DETECT ACTION ---------------- */
            const url = req.originalUrl.toLowerCase();
            let requiredPermission = null;

            if (url.includes('/pagination-list')) requiredPermission = 'listaccess';
            else if (url.includes('/list')) requiredPermission = 'listaccess';
            else if (url.includes('/findbyid')) requiredPermission = 'viewaccess';
            else if (url.includes('/create')) requiredPermission = 'createaccess';
            else if (url.includes('/update')) requiredPermission = 'editaccess';
            else if (url.includes('/status')) requiredPermission = 'editaccess';
            else if (url.includes('/delete')) requiredPermission = 'deleteaccess';
            else if (url.includes('/print')) requiredPermission = 'printaccess';
            else if (url.includes('/clone')) requiredPermission = 'cloneaccess';
            else if (url.includes('/export')) requiredPermission = 'exportaccess';

            if (!requiredPermission) return next();

            if (priv[requiredPermission] !== true) {
                return errorHandler({ name: "NoModulePermission" }, req, res);
            }

            /* ---------------- 8. DATA ACCESS (Only for Read APIs) ---------------- */
            if (requiredPermission === 'listaccess' || requiredPermission === 'viewaccess') {

                const accessResult = await pool.query(
                    `SELECT listaccess 
                     FROM role_data_access
                     WHERE role_id = $1 
                       AND module_id = $2`,
                    [role_id, module_id]
                );
console.log("accessResult: ", accessResult.rows);
                if (accessResult.rowCount === 0) {
                    return errorHandler({ name: "NoDataAccess" }, req, res);
                }

                const access_type = accessResult.rows[0].listaccess;

                if (access_type === 3) { //'PUBLIC'
                    req.dataAccessScope = { type: 'PUBLIC' };
                }
                else if (access_type === 2) { //'PRIVATE'
                    req.dataAccessScope = {
                        type: 'PRIVATE',
                        user_id: user_id
                    };
                }
                else {
                    return errorHandler({ name: "NoDataAccess" }, req, res);
                }
            }
console.log("req.dataAccessScope: ", req.dataAccessScope);
            /* ---------------- NEXT ---------------- */
            next();

        } catch (err) {
            logger.error("ApiAccessingCheckingAuthApi Error:", err);
            return errorHandler(err, req, res);
        }
    };
};

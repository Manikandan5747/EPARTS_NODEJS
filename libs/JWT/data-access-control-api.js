const jwt = require("jsonwebtoken");
const pool = require("@libs/db/postgresql_index");
const errorHandler = require("@libs/error-handler/error-handler");
const APP_CONFIG = require("@libs/JWT/app-config");
const logger = require("@libs/logger/logger");

/* ---------------- API → PERMISSION MAP ---------------- */
const getRequiredPermission = (url) => {
  url = url.toLowerCase();

  if (url.includes('/pagination-list')) return 'listaccess';
  if (url.includes('/list')) return 'listaccess';
  if (url.includes('/findbyid')) return 'viewaccess';
  if (url.includes('/create')) return 'createaccess';
  if (url.includes('/update')) return 'editaccess';
  if (url.includes('/status')) return 'editaccess';
  if (url.includes('/delete')) return 'deleteaccess';
  if (url.includes('/print')) return 'printaccess';
  if (url.includes('/clone')) return 'cloneaccess';
  if (url.includes('/export')) return 'exportaccess';

  return null;
};

module.exports = function apiAccess() {

  return async function (req, res, next) {
    try {

      /* ---------------- 1. USER (TEMP HARDCODED) ---------------- */
      const user_id = 2;
      if (!user_id) {
        return errorHandler({ name: "InvalidToken" }, req, res);
      }

      console.log("👤 user_id:", user_id);

      /* ---------------- 2. USER ROLE ---------------- */
      const userResult = await pool.query(
        `SELECT role_id FROM users WHERE user_id = $1`,
        [user_id]
      );

      if (userResult.rowCount === 0) {
        return errorHandler({ name: "UserNotFound" }, req, res);
      }

      const role_id = userResult.rows[0].role_id;
      console.log("🎭 role_id:", role_id);

      /* ---------------- 3. MODULE FROM ROUTE ---------------- */
      const baseRoute = '/' + req.originalUrl.split('/')[2];
      console.log("🧭 baseRoute:", baseRoute);

      const moduleRes = await pool.query(
        `SELECT module_id
         FROM module
         WHERE routename = $1
           AND is_active = true`,
        [baseRoute]
      );

      if (moduleRes.rowCount === 0) {
        return errorHandler({ name: "ModuleNotRegistered" }, req, res);
      }

      const module_id = moduleRes.rows[0].module_id;
      console.log("📦 module_id:", module_id);

      /* ---------------- 4. MERGED PROFILE PRIVILEGES ---------------- */
      const privRes = await pool.query(
        `SELECT
           BOOL_OR(pp.fullgrantaccess) AS fullgrantaccess,
           BOOL_OR(pp.createaccess)    AS createaccess,
           BOOL_OR(pp.editaccess)      AS editaccess,
           BOOL_OR(pp.deleteaccess)    AS deleteaccess,
           BOOL_OR(pp.listaccess)      AS listaccess,
           BOOL_OR(pp.viewaccess)      AS viewaccess,
           BOOL_OR(pp.printaccess)     AS printaccess,
           BOOL_OR(pp.cloneaccess)     AS cloneaccess
         FROM role_profile_mapping rpm
         JOIN profile_privilege pp
              ON pp.profile_id = rpm.profile_id
             AND pp.module_id = $2
             AND pp.is_active = true
             AND pp.is_deleted = false
         WHERE rpm.role_id = $1
           AND rpm.is_active = true
           AND rpm.is_deleted = false`,
        [role_id, module_id]
      );

      const priv = privRes.rows[0];
      console.log("🔐 merged privileges:", priv);

      if (!priv) {
        return errorHandler({ name: "NoModulePermission" }, req, res);
      }

      /* ---------------- 5. FULL GRANT ---------------- */
      if (priv.fullgrantaccess === true) {
        console.log("✅ FULL GRANT ACCESS");
        return next();
      }

      /* ---------------- 6. DETECT API ACTION ---------------- */
      const requiredPermission = getRequiredPermission(req.originalUrl);
      console.log("🎯 requiredPermission:", requiredPermission);

      if (!requiredPermission) {
        console.log("ℹ️ No permission mapping → skipping check");
        return next();
      }

      /* ---------------- 7. PERMISSION CHECK ---------------- */
      if (priv[requiredPermission] !== true) {
        console.error(`❌ Permission denied: ${requiredPermission}`);
        return errorHandler({ name: "NoModulePermission" }, req, res);
      }

      console.log(`✅ Permission allowed: ${requiredPermission}`);

      /* ---------------- 8. DATA ACCESS (LIST / VIEW ONLY) ---------------- */
        console.log("🔎 Applying DATA ACCESS rules");

        const accessResult = await pool.query(
          `SELECT listaccess
           FROM role_data_access
           WHERE role_id = $1
             AND module_id = $2`,
          [role_id, module_id]
        );

        if (accessResult.rowCount === 0) {
          return errorHandler({ name: "NoDataAccess" }, req, res);
        }

        const access_type = accessResult.rows[0].listaccess;
        console.log("📊 access_type:", access_type);

        /* -------- YOUR IF LOGIC (AS REQUESTED) -------- */
        if (access_type === 3) {
          req.dataAccessScope = { type: 'PUBLIC',user_id };
        }
        else if (access_type === 2) {
          req.dataAccessScope = { type: 'PRIVATE', user_id };
        }
        else {
          return errorHandler({ name: "NoDataAccess" }, req, res);
        }

        console.log("🔐 dataAccessScope:", req.dataAccessScope);
      

      /* ---------------- NEXT ---------------- */
      next();

    } catch (err) {
      logger.error("ApiAccess middleware error:", err);
      return errorHandler(err, req, res);
    }
  };
};

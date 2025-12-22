const jwt = require("jsonwebtoken");
const pool = require('@libs/db/postgresql_index');
const errorHandler = require("@libs/error-handler/error-handler");
const APP_CONFIG = require("@libs/JWT/app-config");
const logger = require('@libs/logger/logger');

module.exports = async function SellerStartAuthApi(req, res, next) {
  try {
    // 1️⃣ Get token
    const Authorization =
      req.body.authorization ||
      req.query.authorization ||
      req.headers["authorization"];

    console.log("Authorization:", Authorization);

    if (!Authorization) {
      return errorHandler({ name: "NoAuthorizationProvided" }, req, res);
    }

    // 2️⃣ Decode token → get portal_user_id
    const decoded = jwt.decode(Authorization, { complete: true });
    console.log("decoded:", decoded);

    if (!decoded || !decoded.payload?.portal_user_id) {
      return errorHandler({ name: "InvalidToken" }, req, res);
    }

    const portal_user_id = decoded.payload.portal_user_id;

    // 1. Check Users Login Details
    const checkUser = await pool.query(
      `SELECT login_uuid,portal_user_id, login_id FROM users_login 
                         WHERE portal_user_id = $1 AND is_active = TRUE AND is_deleted = FALSE`,
      [portal_user_id]
    );
    const sessionuser = checkUser.rows[0];
    const login_id = sessionuser.login_id;

    // 3️⃣ Check active session with same access token
    const sessionQuery = await pool.query(
      `SELECT * FROM user_session 
         WHERE login_id = $1 AND access_token = $2 AND is_active = TRUE
         ORDER BY start_date DESC LIMIT 1`,
      [login_id, Authorization]
    );

    let userSession = sessionQuery.rows[0];

    if (!userSession) {
      return errorHandler({ name: "TokenExpiredError" }, req, res);
    }

    const secretKey = APP_CONFIG.secretkey;
    let verifiedData = null;

    // 4️⃣ Verify token
    try {
      verifiedData = jwt.verify(Authorization, secretKey);
    } catch (err) {
      // ----------------------------
      // TOKEN EXPIRED CASE HANDLING
      // ----------------------------
      if (err instanceof jwt.TokenExpiredError) {
        console.log("🔄 Access Token Expired → Checking refresh logic");

        // 5️⃣ Check whether user is online
        const userQuery = await pool.query(
          `SELECT * FROM users WHERE portal_user_id = $1`,
          [portal_user_id]
        );
        const userRecord = userQuery.rows[0];

        if (!userRecord || !userRecord.is_online) {
          return errorHandler({ name: "UserLoggedOut" }, req, res);
        }

        // 6️⃣ Check refresh token (user_tokens table)
        const refreshQuery = await pool.query(
          `SELECT * FROM user_tokens 
             WHERE portal_user_id = $1 AND is_active = TRUE
             ORDER BY created_at DESC LIMIT 1`,
          [portal_user_id]
        );

        const refreshData = refreshQuery.rows[0];

        if (!refreshData) {
          return errorHandler({ name: "RefreshTokenMissing" }, req, res);
        }

        // Check refresh token expiry
        if (new Date(refreshData.expires_at) < new Date()) {
          return errorHandler({ name: "RefreshTokenExpired" }, req, res);
        }

        // 7️⃣ Refresh token valid → auto generate NEW ACCESS TOKEN
        const newAccessToken = generateTokens(userRecord, login_id);

        // If new refresh token is created, store it
        await storeAccessToken(userRecord, newAccessToken, refreshData.user_token_id, login_id);

        // -----------------------------------------
        // CREATE / UPDATE SESSION
        // -----------------------------------------
        await createUserSession(
          userRecord.portal_user_uuid,
          newAccessToken,
          req.headers["user-agent"] || "unknown-device",
          login_id
        );

        // Send new token in header
        res.set({
          "Content-Type": "application/json;odata=verbose",
          Authorization: newAccessToken,
        });

        console.log("✅ Auto Access Token Refreshed Successfully");

        req.authUser = {
          user_id: userRecord.user_id,
          username: userRecord.username,
        };

        return next();
      }

      return errorHandler(err, req, res);
    }

    // 8️⃣ If token verified → allow request
    res.set({
      "Content-Type": "application/json;odata=verbose",
      Authorization: Authorization,
    });

    req.authUser = {
      user_id: verifiedData.user_id,
      username: verifiedData.username,
    };

    next();
  } catch (err) {
    console.log("❌ Middleware error:", err);
    return errorHandler(err, req, res);
  }
}


// --------------------------------------------------
// Store Access Token
// --------------------------------------------------
async function storeAccessToken(user, accessToken, user_token_id, login_id) {
  try {
    await pool.query(
      `UPDATE user_access_tokens
             SET is_active = false, modified_by = $1, modified_at = NOW()
             WHERE portal_user_id = $2 AND is_active = true`,
      [user.portal_user_uuid, user.portal_user_id]
    );

    const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000);

    await pool.query(
      `INSERT INTO user_access_tokens
             (portal_user_id, access_token, is_active, expires_at, created_by, created_at, user_token_id)
             VALUES ($1, $2, true, $3, $4, NOW(), $5)`,
      [user.portal_user_id, accessToken, expiresAt, user.portal_user_uuid, user_token_id]
    );

  } catch (err) {
    console.error("storeAccessToken error:", err);
    throw err;
  }
}

// --------------------------------------------------
// Create User Session
// --------------------------------------------------
async function createUserSession(portal_user_uuid, accessToken, device_detail, login_id) {
  try {
    // Close previous active sessions
    await pool.query(
      `UPDATE user_session
             SET is_active = false, end_date = NOW()
             WHERE login_id = $1 AND is_active = true`,
      [login_id]
    );

    await pool.query(
      `INSERT INTO user_session
             (login_id, device_detail, is_active, created_by, created_at, access_token)
             VALUES ($1, $2, true, $3, NOW(), $4)`,
      [login_id, device_detail, portal_user_uuid, accessToken]
    );

  } catch (err) {
    console.error("createUserSession error:", err);
    throw err;
  }
}

// --------------------------------------------------
// Generate JWT tokens
// --------------------------------------------------
async function generateTokens(user, login_id) {
  const accessToken = jwt.sign(
    { portal_user_id: user.portal_user_id, portal_user_uuid: user.portal_user_uuid, username: user.username, login_id: login_id },
    `a4db08b7-5729-4ba9-8c08-f2df493465a1`,
    { expiresIn: process.env.ACCESS_TOKEN_EXPIRES_IN || "24h" }
  );
  return accessToken;
}


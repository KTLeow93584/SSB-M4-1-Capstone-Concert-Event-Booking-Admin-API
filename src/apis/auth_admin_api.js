// =======================================
let express = require("express");
let path = require("path");

const {
  sendMailToRecipientText,
  sendMailToRecipientHTML
} = require("../services/mail/mailing_service.js");

const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

// Guide on "pseudorandom" tokens:
// https://gist.github.com/joepie91/7105003c3b26e65efcea63f3db82dfba
const { v4: uuidv4 } = require("uuid");

const { Pool } = require("pg");
const {
  DATABASE_URL,
  SECRET_KEY,
  ACCESS_TOKEN_EXPIRY,
  REFRESH_TOKEN_EXPIRY,
  FORGET_PASSWORD_TOKEN_EXPIRY,
  PASSWORD_HASH_AMOUNT,
  SERVER_URL,
  CACHE_TTL_DURATION,
  CACHE_TTL_REMEMBER_ME_DURATION
} = process.env;

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { require: true }
});
const router = express.Router();
// =======================================
// Middlewares.
const {
  isUserAuthorized,
  createJSONSuccessResponseToClient,
  createJSONErrorResponseToClient
} = require("../services/middlewares.js");
// =======================================
// Login.
router.post("/web/api/login", async (req, res) => {
  const client = await pool.connect();

  try {
    const body = {
      email: req.body.email ? req.body.email.toLowerCase() : null,
      password: req.body.password ? req.body.password : null,
      remember_toggle: req.body.remember_toggle === undefined ? false : true
    };

    // Debug
    //console.log("[On Login - Admin] Body.", body);

    if (!body.email || !body.password)
      return createJSONErrorResponseToClient(res, 200, 401, "incorrect-credentials");

    let query = `
      SELECT 
        u.id, 
        COALESCE(i.name, o.name) AS name,
        u.email, 
        u.password,
        u.role,
        CASE 
            WHEN u.role ILIKE 'Admin' THEN 3
            WHEN u.role ILIKE 'Staff' THEN 2
            WHEN u.role ILIKE 'User' THEN 1
            ELSE 0
        END AS role_permission_level,
        u.social_provider,
        u.profile_picture
      FROM users u
      LEFT JOIN individuals i ON i.user_id = u.id
      LEFT JOIN organizations o ON o.user_id = u.id
      WHERE email = $1;
    `;

    // Logged in with email and password
    const result = await client.query(query, [body.email]);
    
    // If a user is found, store it under the "user" variable.
    const user = result.rows.length > 0 ? result.rows[0] : null;
    
    // Otherwise, return an error response because no user found from input email.
    if (!user)
      return createJSONErrorResponseToClient(res, 200, 401, "incorrect-credentials");

    // Verify if password provided from request's body is the same with the user's actual password.
    // If it's not valid, return an error response and set the token to null.
    const passwordIsValid = await bcrypt.compare(body.password, user.password);
    if (!passwordIsValid) 
      return createJSONErrorResponseToClient(res, 200, 401, "incorrect-credentials");

    if (user.role === "user") 
      return createJSONErrorResponseToClient(res, 200, 401, "incorrect-credentials");

    const { refreshToken } = createNewCustomAccessToken(user);

    // Insert device id only into DB.
    query = `
      UPDATE users SET
        refresh_token = $1
      WHERE EMAIL = $2;
    `;
    await client.query(query, [ refreshToken, body.email ]);

    // Debug
    //console.log("[Login] User.", user);

    // Session Cookie Debug
    //console.log("[Login] Cookie.", req.session.cookie);
    //console.log("[Login] Cookie Expires.", req.session.cookie.expires);

    // Save into session
    req.session.user = user;
    
    // User won't have to log in again based on 2 durations (depending if the "Remember Me" checkbox is set to "true" or "false").
    req.session.cookie.maxAge = body.remember_toggle ? parseInt(CACHE_TTL_REMEMBER_ME_DURATION) : parseInt(CACHE_TTL_DURATION);

    return createJSONSuccessResponseToClient(res, 201);
  }
  catch (error) {
    // Debug
    console.error(error.stack);

    return createJSONErrorResponseToClient(res, 200, 500, "server-error");
  }
  finally {
    client.release();
  }
});

// Logout.
router.post("/web/api/logout", [isUserAuthorized], async (req, res) => {
  // Clear Session's User Data.
  req.session.user = null;
  req.session.save(function (err) {
    // Regenerate the session, which is good practice to help guard against forms of session fixation
    // https://expressjs.com/en/resources/middleware/session.html
    req.session.regenerate(function (err) {
      if (err)
        console.error("Error while regenerating new session.", err);
      res.redirect('/')
    })
  })
});

// Request Forgot Password.
router.post("/web/api/password/forget", async (req, res) => {
  const client = await pool.connect();
  try {
    const { email } = req.body;
    // ==================================
    // Empty Email Field.
    if (!email)
      return createJSONErrorResponseToClient(res, 200, 409, "incomplete-form");
    // ==================================
    let query = `
      SELECT 
        u.id, 
        COALESCE(i.name, o.name) AS name
      FROM users u
      LEFT JOIN individuals i ON i.user_id = u.id
      LEFT JOIN organizations o ON o.user_id = u.id
      WHERE email = $1;
    `;

    const userQuery = await client.query(query, [email]);
    // ==================================
    // No user associated with the email = do nothing.
    if (userQuery.rows.length <= 0) {
      // Debug
      //console.log("[Forget Password] User does not exist.");

      return createJSONErrorResponseToClient(res, 200, 404, "no-user-found");
    }
    // ==================================
    const user = userQuery.rows[0];
    const requestToken = uuidv4();
    
    // Debug
    //console.log("[Forget Password] Request Token: " + requestToken);

    const nowTimestamp = new Date();
    let expiryTimestamp = new Date(nowTimestamp);

    // Debug
    //console.log(`[Forget Password] Expires After [${FORGET_PASSWORD_TOKEN_EXPIRY}] seconds.`);
    //console.log(`[Forget Password] Current Time: ${nowTimestamp}.`);

    // SECRET KEY values will return as string, which if not parsed, will get appended onto instead.
    expiryTimestamp.setSeconds(expiryTimestamp.getSeconds() + parseInt(FORGET_PASSWORD_TOKEN_EXPIRY));

    // Debug
    //console.log(`[Forget Password] Expiry Time: ${expiryTimestamp}.`);
    // ==================================
    // Update row if already exist, insert otherwise.
    query = `
      INSERT INTO password_requests(user_id, token, expire_at)
      VALUES ($1, $2, $3)
      ON CONFLICT (user_id) DO UPDATE 
      SET token = $2, 
          expire_at = $3;
    `;
    await client.query(query, [user.id, requestToken, expiryTimestamp]);

    // Send Email to User whom has forgotten their password.
    sendMailToRecipientHTML(
      "ror-support-noreply@ror.com",
      email,
      `Hello, ${user.name}. We have received your password reset request (Forgot Password).`,
      {
        name: user.name,
        link: SERVER_URL + "/password/reset/" + requestToken
      },
      path.join(__dirname, "../services/mail/templates/forgot_password.ejs")
    );

    return createJSONSuccessResponseToClient(res, 201);
  }
  catch (error) {
    // Debug
    console.error(error.stack);

    return createJSONErrorResponseToClient(res, 200, 500, "server-error");
  }
  finally {
    client.release();
  }
});

// Reset Password.
router.post("/web/api/password/reset/:token", async (req, res) => {
  const client = await pool.connect();
  try {
    const { token } = req.params;
    // =======================
    let query = await client.query('SELECT * FROM password_requests WHERE token = $1;', [token]);
    if (query.rows <= 0)
      return createJSONErrorResponseToClient(res, 200, 404, "invalid-password-reset-request");
    // =======================
    const { password, password_confirmation } = req.body;

    if (password !== password_confirmation)
      return createJSONErrorResponseToClient(res, 200, 401, "mismatched-password");
    // =======================
    // Check if password's format matches requirement.
    // - Must contain 1 number, 1 lowercase alphabet, 1 uppercase alphabet, 1 symbol.
    // - Must contain at least 8 characters.

    const regexUpperLetters = /[A-Z]/;
    const regexLowerLetters = /[a-z]/;
    const regexNumbers = /[0-9]/;
    const regexSymbols = /[^a-zA-z0-9]/;

    const pass = password.length >= 8 & regexUpperLetters.test(password) &
        regexLowerLetters.test(password) & regexNumbers.test(password) &
        regexSymbols.test(password);

    if (!pass)
      return createJSONErrorResponseToClient(res, 200, 405, "incorrect-password-format");
    // =======================
    const result = await isPasswordResetRequestValid(client, token);

    if (!result.success)
      return createJSONErrorResponseToClient(res, 200, 405, "expired-password-request");

    let sqlQuery = `
      UPDATE users SET
        password = $1
      WHERE id = $2;
    `;
    // Debug
    //console.log("[Reset Password] New Password:", password);
    //console.log("[Reset Password] User ID:", result.user_id);
    
    const hashedPassword = await generateNewPasswordHash(password);
    await client.query(sqlQuery, [hashedPassword, result.user_id]);

    // Delete Password Request data row from the corresponding table.
    query = `
      DELETE FROM password_requests
      WHERE user_id = $1;
    `;
    await client.query(query, [result.user_id]);

    return createJSONSuccessResponseToClient(res, 201);
  }
  catch (error) {
    // Debug
    console.error(error.stack);

    return createJSONErrorResponseToClient(res, 200, 405, "server-error");
  }
  finally {
    client.release();
  }
});
// =======================================
async function generateNewPasswordHash(password) {
  return await bcrypt.hash(password, parseInt(PASSWORD_HASH_AMOUNT));
}

function createNewCustomAccessToken(user) {
  // Otherwise, pass in 3 arguments to jwt.sign() method to generate a JWToken.
  // 86400 seconds   = 1 day.
  // 259200 seconds  = 3 days. (Refresh Token Duration)
  // 600 seconds     = 10 minutes. (Access Token Duration)
  const refreshTokenExpiryDurationMS = parseFloat(REFRESH_TOKEN_EXPIRY);
  const accessTokenExpiryDurationMS = parseFloat(ACCESS_TOKEN_EXPIRY);

  const refreshToken = jwt.sign(
    { id: user.id, email: user.email },
    SECRET_KEY,
    { expiresIn: refreshTokenExpiryDurationMS },
  );
  return {
    newAccessToken: jwt.sign({ id: user.id, email: user.email }, SECRET_KEY, {
      expiresIn: accessTokenExpiryDurationMS,
    }),
    refreshToken,
  };
}

async function verifyPasswordRequestToken(req, res, token) {
  const client = await pool.connect();
  try {
    const result = await isPasswordResetRequestValid(client, token);
    return result;
  }
  catch (error) {
    // Debug
    console.error(error.stack);

    return false;
  }
  finally {
    client.release();
  }
};

async function isPasswordResetRequestValid(client, token) {
  let query = `
    SELECT 
      id,
      user_id,
      token,
      expire_at
    FROM password_requests
    WHERE token = $1;
  `;
  const requestQuery = await client.query(query, [token]);

  // Debug
  //console.log("[Reset Password] Token.", token);

  if (requestQuery.rows.length <= 0) {
    // Debug
    //console.log("[Verify Reset Password] No such password request found.");

    return { success: false, user_id: null };
  }
  const resetRequestResult = requestQuery.rows[0];

  // Debug
  //console.log("[Reset Password] Verification Result.", resetRequestResult);
  
  const nowTimestamp = new Date();
  const expiryTimestamp = new Date(resetRequestResult.expire_at);

  const hasExpired = (nowTimestamp >= expiryTimestamp);
  
  // Debug
  //console.log("Now: " + nowTimestamp + ", Expired At: " + expiryTimestamp + ", Flag: " + hasExpired + ", Inverse Flag: " + !hasExpired);
  
  return { success: !hasExpired, user_id: resetRequestResult.user_id };
}
// =======================================
// Verify user account's email.
async function verifyAccountEmail (req, res) {
  const client = await pool.connect();
  try {
    const { token } = req.params;
    // =======================
    // Add pending verification query
    let verificationQuery = `
      SELECT 
        u.id,
        u.email,
        COALESCE(i.name, o.name) AS name,
        uv.token,
        uv.verified_at
      FROM user_verifications uv
      INNER JOIN users u ON uv.user_id = u.id
      LEFT JOIN individuals i ON i.user_id = u.id
      LEFT JOIN organizations o ON o.user_id = u.id
      WHERE uv.token = $1
      ORDER BY uv.token;
    `;
    
    let verificationQueryResult = await client.query(verificationQuery, [token]);
    // =======================
    if (verificationQueryResult.rows.length <= 0)
      return { success: false, is_already_verified: false };

    // Debug
    //console.log("[Admin - Verify Email] Request.", verificationQueryResult.rows[0]);
    // =======================
    const user = verificationQueryResult.rows[0];
    if (user.verified_at)
      return { success: true, is_already_verified: true };
    // =======================
    verificationQuery = `
      UPDATE user_verifications SET
        verified_at = $1
      WHERE token = $2;
    `;
    await client.query(verificationQuery, [new Date(), token]);

    // Debug
    //console.log("[Verify User's Email] Successful.");

    // Send Email to Newly Registered User.
    // Requesting them to verify their email.
    sendMailToRecipientHTML(
      "ror-support-noreply@ror.com",
      user.email,
      `Welcome to Republic of Rock, ${user.name}`,
      { name: user.name },
      path.join(__dirname, "../services/mail/templates/welcome.ejs")
    );
    
    return { success: true, is_already_verified: false };
  }
  catch (error) {
    // Debug
    console.error(error.stack);

    return createJSONErrorResponseToClient(res, 200, 500, "server-error");
  }
  finally {
    client.release();
  }
};
// =======================================
module.exports = { router, verifyPasswordRequestToken, verifyAccountEmail };

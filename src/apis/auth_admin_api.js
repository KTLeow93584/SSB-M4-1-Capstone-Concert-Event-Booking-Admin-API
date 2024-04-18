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
  SERVER_URL
} = process.env;

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { require: true }
});
const router = express.Router();

// Middlewares.
const {
  authenticateCustomJWToken,
  authenticateFirebaseJWToken,
  createJSONSuccessResponseToClient,
  createJSONErrorResponseToClient,
  sendInfoToRedirectedPage,
  sendErrorResponseToRedirectedPage
} = require("../services/middlewares.js");
// =======================================
// Login.
router.post("/web/api/login", async (req, res) => {
  const client = await pool.connect();

  try {
    // Debug
    //console.log("[On Login - Admin] Body.", req.body);

    const body = {
      email: req.body.email.toLowerCase(),
      password: req.body.password ? req.body.password : null
    };

    let query = `
      SELECT 
        u.id, 
        COALESCE(i.name, o.name) AS name,
        u.email, 
        u.password,
        u.role,
        u.social_provider 
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
    if (!user) {
        return sendErrorResponseToRedirectedPage(req, res, req.body, 401, { 
          type: "incorrect-credentials", 
          message: "Incorrect Email/Password Combination"
        });
    }

    // Verify if password provided from request's body is the same with the user's actual password.
    // If it's not valid, return an error response and set the token to null.
    const passwordIsValid = await bcrypt.compare(body.password, user.password);
    if (!passwordIsValid) {
        return sendErrorResponseToRedirectedPage(req, res, req.body, 401, { 
          type: "incorrect-credentials", 
          message: "Incorrect Email/Password Combination"
        });
    }

    if (user.role === "user") {
        return sendErrorResponseToRedirectedPage(req, res, req.body, 405, { 
          type: "unauthorized-user", 
          message: "Incorrect Email/Password Combination"
        });
    }

    const { refreshToken } = createNewCustomAccessToken(user);

    // Insert device id only into DB.
    query = `
      UPDATE users SET
        refresh_token = $1
      WHERE EMAIL = $2;
    `;
    await client.query(query, [ refreshToken, body.email ]);

    // Save into session
    //console.log("User.", user);

    return sendInfoToRedirectedPage(req, res, "/dashboard");
  }
  catch (error) {
    // Debug
    console.error(error.stack);

    return sendErrorResponseToRedirectedPage(req, res, req.body, 500, { 
      type: "server-error", 
      message: "Something went wrong with the server"
    });
  }
  finally {
    client.release();
  }
});

// Logout.
router.post("/web/api/logout", [authenticateCustomJWToken, authenticateFirebaseJWToken], async (req, res) => {
  const client = await pool.connect();
  
  try {
    const email = req.email;
    const query = `
      UPDATE users SET 
        device_id = null, 
        refresh_token = null
      WHERE email = $1;
    `;
    await client.query(query, [email]);

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

// Request Forgot Password.
router.post("/web/api/password/forget", async (req, res) => {
  const client = await pool.connect();
  try {
    const { email } = req.body;
    // ==================================
    const message = "You should be receiving a mail from us shortly, if the email address is tied to a registred account.";
    // ==================================
    // Empty Email Field.
    if (!email) {
      return sendErrorResponseToRedirectedPage(req, res, req.body, 409, { 
        type: "incomplete-form", 
        message: "Email field cannot be empty."
      });
    }
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

      return sendInfoToRedirectedPage(req, res, "/login", message);
    }
    // ==================================
    const user = userQuery.rows[0];

    // User already requested password reset before, remove previous request, update with latest.
    query = `
      DELETE FROM password_requests
      WHERE user_id = $1;
    `;
    await client.query(query, [user.id]);

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

    query = `
      INSERT INTO password_requests(user_id, token, expire_at)
      VALUES ($1, $2, $3);
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

    return sendInfoToRedirectedPage(req, res, "/login", message);
  }
  catch (error) {
    // Debug
    console.error(error.stack);

    return sendErrorResponseToRedirectedPage(req, res, req.body, 500, { 
      type: "server-error", 
      message: "Something went wrong with the server"
    });
  }
  finally {
    client.release();
  }
});

// Request Forgot Password.
router.post("/web/api/password/reset/:token", async (req, res) => {
  const client = await pool.connect();
  try {
    const { password, password_confirmation } = req.body;
    const { token } = req.params;
    // =======================
    if (password !== password_confirmation) {
      return sendErrorResponseToRedirectedPage(req, res, req.body, 405, { 
        type: "mismatched-password", 
        message: "Passwords do not match. Please check the form before submitting."
      });
    }
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

    if (!pass) {
      return sendErrorResponseToRedirectedPage(req, res, req.body, 405, { 
        type: "incorrect-password-format", 
        message: "Password must match the specified format."
      });
    }
    // =======================
    const result = await isPasswordResetRequestValid(client, token);

    if (!result.success)
      return sendErrorResponseToRedirectedPage(req, res, req.body, 405, { 
        type: "expired-password-request", 
        message: "The password reset request has already expired."
      });

    let query = `
      UPDATE users SET
        password = $1
      WHERE id = $2;
    `;
    // Debug
    //console.log("[Reset Password] New Password:", password);
    //console.log("[Reset Password] User ID:", result.user_id);
    
    const hashedPassword = await generateNewPasswordHash(password);
    await client.query(query, [hashedPassword, result.user_id]);

    // Delete Password Request data row from the corresponding table.
    query = `
      DELETE FROM password_requests
      WHERE user_id = $1;
    `;
    await client.query(query, [result.user_id]);

    return sendInfoToRedirectedPage(req, res, "/login", "Password successfully changed. You may try logging in with your new credentials now.");
  }
  catch (error) {
    // Debug
    console.error(error.stack);

    return sendErrorResponseToRedirectedPage(req, res, req.body, 500, { 
      type: "server-error", 
      message: "Something went wrong with the server"
    });
  }
  finally {
    client.release();
  }
});

// User verifies account's email.
router.post("/web/api/verify", async (req, res) => {
  const client = await pool.connect();
  try {
    const { token } = req.body;
    
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
      return createJSONErrorResponseToClient(res, 200, 404, "verification-not-found");
    // =======================
    const user = verificationQueryResult.rows[0];
    if (user.verified_at)
      return createJSONErrorResponseToClient(res, 200, 409, "user-already-verified");
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
      path.join(__dirname, "../services/mail/templates/user_verify_email.ejs")
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
module.exports = { router, verifyPasswordRequestToken };

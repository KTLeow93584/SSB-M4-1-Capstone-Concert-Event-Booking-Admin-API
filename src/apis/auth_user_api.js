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
  CLIENT_URL
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
  createJSONErrorResponseToClient
} = require("../services/middlewares.js");
// =======================================
// Phone Verification - Telesign
const telesignServices = require("../services/phone_verify_telesign.js");
// =======================================
// Registration.
router.post("/api/register", async (req, res) => {
  const client = await pool.connect();

  try {
    // Hash the password and check for the existence of email.
    let body = {
      email: req.body.email.toLowerCase(),
      country_id: req.body.country_id,
      contact_number: req.body.contact_number ? req.body.contact_number.replace("-", "") : null,
      password: req.body.password,
      social_provider: req.body.social_provider ? req.body.social_provider.replace(".com", "") : null,
      social_uid: req.body.social_uid,

      // Individuals
      name: req.body.name,
      nric: req.body.nric,

      // Organizations/Companies
      organization_name: req.body.organization_name,
      organization_registration_number: req.body.organization_registration_number
    };
    // =======================
    if (typeof body.contact_number === "number")
      body.contact_number = body.contact_number.toString();
    // =======================
    // Missing Form Inputs
    if (!body.email || !body.country_id || !body.contact_number || !body.password || 
        (!body.name && !body.organization_name && !body.nric && !body.organization_registration_number))
        return createJSONErrorResponseToClient(res, 200, 405, "incomplete-form");
    // =======================
    // Individual or Organization Registration Type.
    const isIndividualRegistration = !!body.name && !!body.nric;
    const isOrganizationRegistration = !!body.organization_name && !!body.organization_registration_number;

    // Debug
    //console.log(`[On New User Registration] Is Individual Flag: ${isIndividualRegistration}`);
    //console.log(`[On New User Registration] Is Organization Flag: ${isOrganizationRegistration}`);

    // Cannot be both individual & organization registration, nor neither.
    if (isIndividualRegistration && isOrganizationRegistration)
      return createJSONErrorResponseToClient(res, 200, 405, "ambiguous-registration-type");
    // =======================
    // Check if password's format matches requirement.
    // - Must contain 1 number, 1 lowercase alphabet, 1 uppercase alphabet, 1 symbol.
    // - Must contain at least 8 characters.
    const regexUpperLetters = /[A-Z]/;
    const regexLowerLetters = /[a-z]/;
    const regexNumbers = /[0-9]/;
    const regexSymbols = /[^a-zA-z0-9]/;

    const pass = body.password.length >= 8 & regexUpperLetters.test(body.password) &
        regexLowerLetters.test(body.password) & regexNumbers.test(body.password) &
        regexSymbols.test(body.password);
    
    if (!pass)
      return createJSONErrorResponseToClient(res, 200, 405, "incorrect-password-format");
    // =======================
    // Check if phone number is already in use.
    const existingUserCountryQuery = await client.query('SELECT id, phone_code FROM countries WHERE id = $1;', [body.country_id]);
    const existingUserCountry = existingUserCountryQuery.rows.length > 0 ? existingUserCountryQuery.rows[0] : null;

    const existingUserQuery = await client.query('SELECT id, contact_number FROM users WHERE contact_number = $1;', [body.contact_number]);
    const existingUser = existingUserQuery.rows.length > 0 ? existingUserQuery.rows[0] : null;

    // Debug
    /*
    console.log("[On New User Registration] Country Code, Contact Number.", [existingUserCountry.phone_code, body.contact_number]);
    console.log("[On New User Registration] Existing User.", existingUser);
    console.log("[On New User Registration] Existing User Counter.", existingUserCountry);
    console.log("[On New User Registration] Body.", body);

    if (existingUser && existingUserCountry) {
      console.log("[On New User Registration] Flag 1.", (existingUserCountry.id === body.country_id));
      console.log("[On New User Registration] Flag 2.", (existingUser.contact_number === body.contact_number)); 
    }
    */

    if ((existingUser && existingUserCountry) && 
      existingUserCountry.id === body.country_id && existingUser.contact_number === body.contact_number)
        return createJSONErrorResponseToClient(res, 200, 409, "contact-number-already-in-use");
    // =======================
    const hashedPassword = await generateNewPasswordHash(body.password);

    insertNewUser = `
      INSERT INTO users (email, country_id, contact_number, password, social_provider, social_uid, role_id) 
      VALUES ($1, $2, $3, $4, $5, $6, 4) 
      RETURNING *;
    `;

    newUserQuery = await client.query(insertNewUser, [
      body.email, body.country_id, body.contact_number,
      hashedPassword, body.social_provider, body.social_uid,
    ]);

    // Debug
    //console.log("[On Registration] Body.", body);

    const newUser = newUserQuery.rows[0];

    // Debug
    //console.log("[On Successful Registration] New User.", newUser);
    // =======================
    // Individual Registration
    if (isIndividualRegistration) {
      const newIndividualQuery = `
        INSERT INTO individuals (user_id, name, nric) 
        VALUES ($1, $2, $3);
      `;

      await client.query(newIndividualQuery, [newUser.id, body.name, body.nric]);
    }
    // Organization Registration
    else {
      const newIndividualQuery = `
        INSERT INTO organizations (user_id, name, registration_number) 
        VALUES ($1, $2);
      `;

      await client.query(newIndividualQuery, [newUser.id, body.organization_registration_number]);
    }
    // =======================
    // Send SMS to Number.
    const verifyCode = telesignServices.sendOTPSMSToPhoneNumber(existingUserCountry.phone_code.toString() + body.contact_number);

    // Debug Mode (Dummy Code)
    //const verifyCode = 222333;
    
    // Add SMS verification query
    const smsCodeQuery = `
      INSERT INTO user_sms_verifications (user_id, code)
      VALUES ($1, $2);
    `;
    await client.query(smsCodeQuery, [newUser.id, verifyCode]);
    // =======================
    const verificationToken = uuidv4();

    // Send Email to Newly Registered User.
    // Requesting them to verify their email.
    const result = await sendMailToRecipientHTML(
      "ror-support-noreply@ror.com",
      body.email,
      `Hello, ${body.name}. Please verify your email.`,
      { 
        name: body.name, 
        link: CLIENT_URL + "/verify/" + verificationToken
      },
      path.join(__dirname, "../services/mail/templates/user_verify_email.ejs")
    );
    // Debug
    //console.log("[On New User Registration] Mail Send Query Result.", result);

    // Error Code 403 -> Unverified Email. (Free Mailgun Limitations)
    if (result.status === 403) {
      // Add pending verification query
      const verifiedQuery = `
        INSERT INTO user_email_verifications (user_id, token, verified_at)
        VALUES ($1, $2, $3);
      `;
      await client.query(verifiedQuery, [newUser.id, verificationToken, new Date()]);
      // =======================
      // Send new data back to client.
      return createJSONSuccessResponseToClient(res, 200, {
        message: "unverified-email",
        user: {
          id: newUser.id
        }
      });
      // =======================
    }
    else if (result.status === 200) {
      // Add pending email verification query
      const verifiedQuery = `
        INSERT INTO user_email_verifications (user_id, token)
        VALUES ($1, $2);
      `;
      await client.query(verifiedQuery, [newUser.id, verificationToken]);
      // =======================
    }
    // =======================
    // Send no data back to client.
    return createJSONSuccessResponseToClient(res, 200, {
      message: null,
      user: {
        id: newUser.id
      }
    });
    // =======================
  }
  catch (error) {
    // Debug
    console.error("[On New User Registration] Error.", error);

    // Duplicate Entry
    if (error.code === '23505') {
      const errorDescription = error.detail;
      if (errorDescription.includes('email'))
        return createJSONErrorResponseToClient(res, 200, 409, "email-already-in-use");
    }

    return createJSONErrorResponseToClient(res, 200, 500, "server-error");
  }
  finally {
    client.release();
  }
});

// User verifies account's email.
router.post("/api/sms/verify", async (req, res) => {
  const client = await pool.connect();
  try {
    // =======================
    const { user_id, sms_code } = req.body;
    // =======================
    const verificationQueryResult = await client.query("SELECT * from user_sms_verifications where user_id = $1;", [user_id])
    if (verificationQueryResult.rows.length <= 0)
      return createJSONErrorResponseToClient(res, 200, 404, "verification-not-found");
    // =======================
    const verificationResult = verificationQueryResult.rows[0];
    if (verificationResult.verified_at)
      return createJSONErrorResponseToClient(res, 200, 409, "user-already-verified");
    // =======================
    if (sms_code === verificationResult.code) {
      // Debug
      console.log("Input Code Matches Stored Code!");
    }

    verificationQuery = `
      UPDATE user_sms_verifications SET
        verified_at = $1
      WHERE user_id = $2;
    `;
    await client.query(verificationQuery, [new Date(), user_id]);

    // Debug
    console.log("[Verify User's SMS] Successful.");

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

// Login.
router.post("/api/login", async (req, res) => {
  const client = await pool.connect();

  try {
    const deviceID = req.headers.device ? req.headers.device : null;
    const social_access_token = req.headers.authorization;

    const body = {
      email: req.body.email.toLowerCase(),
      password: req.body.password ? req.body.password : null,
      social_provider: req.body.social_provider ? req.body.social_provider.replace(".com", "") : null,
      social_uid: req.body.social_uid ? req.body.social_uid : null,
      social_access_token: req.body.social_access_token,
      social_refresh_token: req.body.social_refresh_token
    };

    let user = null;
    let query = null;
    let accessToken = null;

    const isViaSocials = !!body.email && !!body.social_provider &&
      !!body.social_uid && !!body.social_access_token && !!body.social_refresh_token;

    query = `
      SELECT 
        u.id, 
        COALESCE(i.name, o.name) AS name,
        u.email, 
        u.password, 
        u.social_provider 
      FROM users u
      LEFT JOIN individuals i ON i.user_id = u.id
      LEFT JOIN organizations o ON o.user_id = u.id
    `;

    // Debug
    //console.log("[On Login - User] Via Social Platform Flag: ", isViaSocials);
    //console.log("[On Login - User] Body.", body);

    // Logged in with socials (Google, Facebook)
    if (isViaSocials) {
      query += ` WHERE email = $1 AND social_provider = $2;`;
      const existingUser = await client.query(query, [body.email, body.social_provider]);

      // If exist, check if user is logged in with this social provider.
      if (existingUser.rows.length > 0)
        user = existingUser.rows[0];
      // Otherwise, register new user.
      else
        return createJSONErrorResponseToClient(res, 200, 404, "no-user-found");

      // Insert device id and socials refresh token into DB.
      query = `
        UPDATE users SET
          device_id = $1,
          social_uid = $2
        WHERE email = $3;
      `;
      await client.query(query, [deviceID, body.social_uid, body.email]);

      accessToken = social_access_token;
    }
    // Logged in with email and password
    else {
      query += ` WHERE email = $1`;
      const result = await client.query(query, [body.email]);
      
      // If a user is found, store it under the "user" variable.
      user = result.rows.length > 0 ? result.rows[0] : null;
        
      // Otherwise, return an error response because no user found from input email.
      if (!user)
        return createJSONErrorResponseToClient(res, 200, 401, "incorrect-credentials");

      // Verify if password provided from request's body is the same with the user's actual password.
      // If it's not valid, return an error response and set the token to null.
      const passwordIsValid = await bcrypt.compare(body.password, user.password);
      if (!passwordIsValid)
        return createJSONErrorResponseToClient(res, 200, 401, "incorrect-credentials");

      const { newAccessToken, refreshToken } = createNewCustomAccessToken(user);
      accessToken = newAccessToken;

      // Insert device id only into DB.
      query = `
        UPDATE users SET
          device_id = $1,
          refresh_token = $2
        WHERE email = $3;
      `;
      await client.query(query, [deviceID, refreshToken, body.email]);
    }

    return createJSONSuccessResponseToClient(res, 200, {
      user: {
        user_id: user.id,
        name: user.name
      },
      token: accessToken,
      auth_type: isViaSocials ? "socials" : "basic"
    });
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
router.post("/api/logout", [authenticateCustomJWToken, authenticateFirebaseJWToken], async (req, res) => {
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
router.post("/api/password/forget", async (req, res) => {
  const client = await pool.connect();
  try {
    const { email } = req.body;
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
    // No user associated with the email = do nothing.
    if (userQuery.rows.length <= 0) {
      // Debug
      //console.log("[Forget Password] User does not exist.");

      return createJSONSuccessResponseToClient(res, 200, 404, "no-user-found");
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
    await sendMailToRecipientHTML(
      "ror-support-noreply@ror.com",
      email,
      `Hello, ${user.name}. We have received your password reset request (Forgot Password).`,
      {
        name: user.name,
        link: CLIENT_URL + "/password/reset/" + requestToken
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

// Verify Password Reset Request (Sanity-check).
router.post("/api/password/reset/verify", async (req, res) => {
  const client = await pool.connect();
  try {
    const { token } = req.body;

    const result = await onVerifyPasswordResetRequest(client, res, token);
    if (!result.success)
      return result.resultResponse;

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
router.post("/api/password/reset", async (req, res) => {
  const client = await pool.connect();
  try {
    const { password, token } = req.body;

    const result = await onVerifyPasswordResetRequest(client, res, token);
    
    if (!result.success)
      return result.resultResponse;

    const pass = password.length >= 8 & regexUpperLetters.test(password) &
        regexLowerLetters.test(password) & regexNumbers.test(password) &
        regexSymbols.test(password);
    
    if (!pass)
      return createJSONErrorResponseToClient(res, 200, 405, "incorrect-password-format");

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

// User verifies account's email.
router.post("/api/email/verify", async (req, res) => {
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
      FROM user_email_verifications uv
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
      UPDATE user_email_verifications SET
        verified_at = $1
      WHERE token = $2;
    `;
    await client.query(verificationQuery, [new Date(), token]);

    // Debug
    //console.log("[Verify User's Email] Successful.");

    // Send Email to Newly Registered User.
    // Requesting them to verify their email.
    await sendMailToRecipientHTML(
      "ror-support-noreply@ror.com",
      user.email,
      `Welcome to Republic of Rock, ${user.name}`,
      { name: user.name },
      path.join(__dirname, "../services/mail/templates/welcome.ejs")
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

// Identity Verification.
router.get("/api/whoami", [authenticateCustomJWToken, authenticateFirebaseJWToken], async (req, res) => {
  const client = await pool.connect();

  try {
    const email = req.email;

    const sqlQuery = `
      SELECT 
        u.id, 
        COALESCE(i.name, o.name) AS name
      FROM users u
      LEFT JOIN individuals i ON i.user_id = u.id
      LEFT JOIN organizations o ON o.user_id = u.id
      WHERE u.email = $1
    `;
    const query = await client.query(sqlQuery, [email]);

    //if (query.rows.length <= 0)
    //return createJSONSuccessResponseToClient(res, 201);
    const user = query.rows[0];

    return createJSONSuccessResponseToClient(res, 200, {
      user: {
        user_id: user.id,
        name: user.name,
        profile_picture: user.profile_picture,
      }
    });
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

async function onVerifyPasswordResetRequest(client, res, token) {
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

    return {
      success: false, 
      resultResponse: createJSONErrorResponseToClient(res, 200, 404, "invalid-password-reset-request")
    };
  }
  const resetRequestResult = requestQuery.rows[0];

  // Debug
  //console.log("[Reset Password] Verification Result.", resetRequestResult);
  
  const nowTimestamp = new Date();
  const expiryTimestamp = new Date(resetRequestResult.expire_at);

  if (nowTimestamp >= expiryTimestamp) {
    return {
      success: false,
      resultResponse: createJSONErrorResponseToClient(res, 200, 405, "expired-password-reset-request")
    };
  }
  return { success: true, user_id: resetRequestResult.user_id };
}
// =======================================
module.exports = router;

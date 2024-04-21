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
  sendInfoToRedirectedPage,
  sendErrorResponseToRedirectedPage
} = require("../services/middlewares-server.js");

const {
  createJSONSuccessResponseToClient,
  createJSONErrorResponseToClient
} = require("../services/middlewares-client.js");
const { Console } = require("console");
// =======================================
// Login.
router.post("/web/api/login", async (req, res) => {
  const client = await pool.connect();

  try {
    // Debug
    //console.log("[On Login - Admin] Body.", req.body);

    const body = {
      email: req.body.email.toLowerCase(),
      password: req.body.password ? req.body.password : null,
      remember_toggle: req.body.remember_toggle === undefined ? false : true
    };

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

    // Debug
    //console.log("[Login] User.", user);

    // Session Cookie Debug
    //console.log("[Login] Cookie.", req.session.cookie);
    //console.log("[Login] Cookie Expires.", req.session.cookie.expires);

    // Save into session
    req.session.user = user;
    
    // User won't have to log in again based on 2 durations (depending if the "Remember Me" checkbox is set to "true" or "false").
    req.session.cookie.maxAge = body.remember_toggle ? parseInt(CACHE_TTL_REMEMBER_ME_DURATION) : parseInt(CACHE_TTL_DURATION);

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

      return sendInfoToRedirectedPage(req, res, "/login", null, message);
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

    const timezoneQuery = await client.query("SELECT current_setting('timezone') as timezone;");
    const defaultTimeZone = timezoneQuery.rows[0].timezone;
    
    // Update row if already exist, insert otherwise.
    query = `
      INSERT INTO password_requests(user_id, token, expire_at)
      VALUES ($1, $2, $3::timestamp AT TIME ZONE $4)
      ON CONFLICT (user_id) DO UPDATE 
      SET token = $2, 
          expire_at = $3::timestamp AT TIME ZONE $4;
    `;
    await client.query(query, [user.id, requestToken, expiryTimestamp, defaultTimeZone]);

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

    return sendInfoToRedirectedPage(req, res, "/login", null, message);
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

    return sendInfoToRedirectedPage(req, res, "/login", null, "Password successfully changed. You may try logging in with your new credentials now.");
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

// Create a New User Account Info
router.post("/web/api/user/create", [isUserAuthorized], async (req, res) => {
  const client = await pool.connect();
  try {
    // =======================
    const { email, password, password_confirmation, name, profile_picture, country_name, role, contact_number, type, id_number } = req.body;

    // Debug
    //console.log("[Create New User] Body.", req.body);
    
    if (!email || !password || !password_confirmation || !name || !country_name || !role || !contact_number || !type || !id_number)
        return createJSONErrorResponseToClient(res, 200, 404, "incomplete-form-field");
    // =======================
    // Mismatched Password with Confirmation.
    if (password !== password_confirmation) 
      return createJSONErrorResponseToClient(res, 200, 405, "mismatched-password");
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
    // Role Permission Checks (If editing a user that's not myself.)
    const activeUserSQL = `
      SELECT
        id,
        role,
        CASE 
          WHEN role ILIKE 'Admin' THEN 3
          WHEN role ILIKE 'Staff' THEN 2
          WHEN role ILIKE 'User' THEN 1
          ELSE 0
        END AS role_permission_level
      FROM users WHERE id = $1;
    `;
    const activeUserQuery = await client.query(activeUserSQL, [req.session.user.id]);

    if (activeUserQuery.rows.length <= 0)
      return createJSONErrorResponseToClient(res, 200, 404, "no-user-found");

    let newUserRolePermissions = -1;
    switch (role.toLowerCase()) {
      case "admin":
        newUserRolePermissions = 3;
        break;
      case "staff":
        newUserRolePermissions = 2;
        break;
      case "user":
      default:
        newUserRolePermissions = 1;
        break;
    }
      
    const activeUser = activeUserQuery.rows[0];
    if (newUserRolePermissions >= activeUser.role_permission_level)
      return createJSONErrorResponseToClient(res, 200, 405, "not-authorized-to-create-a-user-of-higher-role");
    // =======================
    // Get Country ID from input Country Name.
    const countrySQL = `SELECT id, name from countries WHERE name = $1;`
    const countryQuery = await client.query(countrySQL, [country_name]);

    if (countryQuery.rows.length <= 0)
        return createJSONErrorResponseToClient(res, 200, 404, "no-valid-country-found");

    const country_id = countryQuery.rows[0].id;
    // =======================
    // Insert into users table (Email, Country ID, Contact Number, Password, Role, Profile Picture)
    const newUserSQL = `
      INSERT INTO users (email, country_id, contact_number, password, role, profile_picture)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, email;
    `;
    const newUserQuery = await client.query(newUserSQL, [email, country_id, contact_number, password, role, profile_picture]);
    // =======================
    const newUser = newUserQuery.rows[0];
    // =======================
    // Insert into Individuals or Organizations Table (Name, Identification Number as NRIC or Registration Number)
    let newUserTypeSQL = '';
    let newUserTypeQuery = null;

    if (type === "Individual") {
      newUserTypeSQL = `
        INSERT INTO individuals (user_id, name, nric)
        VALUES ($1, $2, $3)
        RETURNING id;
      `;
      newUserTypeQuery = await client.query(newUserTypeSQL, [newUser.id, name, id_number]);
    }
    else {
      newUserTypeSQL = `
        INSERT INTO organizations (user_id, name, registration_number)
        VALUES ($1, $2, $3)
        RETURNING id;
      `;
      newUserTypeQuery = await client.query(newUserTypeSQL, [newUser.id, name, id_number]);
    }
    // =======================
    // Add pending verification query
    const verificationToken = uuidv4();
    
    const verifiedQuery = `
      INSERT INTO user_verifications (user_id, token)
      VALUES ($1, $2);
    `;
    await client.query(verifiedQuery, [newUser.id, verificationToken]);
    // =======================
    // Send Email to Newly Registered User.
    // Requesting them to verify their email.
    sendMailToRecipientHTML(
      "ror-support-noreply@ror.com",
      email,
      `Hello, ${name}. Please verify your email.`,
      { 
        name: name, 
        link: SERVER_URL + "/verify/" + verificationToken
      },
      path.join(__dirname, "../services/mail/templates/user_verify_email.ejs")
    );
    // =======================
    // Send new data back to client.
    return createJSONSuccessResponseToClient(res, 200, {
      user: {
        user_id: parseInt(newUser.id)
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

// Modifies User Account Info
router.put("/web/api/user", [isUserAuthorized], async (req, res) => {
  const client = await pool.connect();
  try {
    const { user_id, email, name, profile_picture, country_name, role, contact_number, type, id_number } = req.body;

    // Debug
    //console.log("[Edit User Info] Body.", req.body);
    
    if (!email || !password || !password_confirmation || !name || !country_name || !role || !contact_number || !type || !id_number)
        return createJSONErrorResponseToClient(res, 200, 404, "incomplete-form-field");
    // =======================
    const selectUserSQL = `
      SELECT
        u.id,
        u.role,
        CASE 
          WHEN role ILIKE 'Admin' THEN 3
          WHEN role ILIKE 'Staff' THEN 2
          WHEN role ILIKE 'User' THEN 1
          ELSE 0
        END AS role_permission_level,
        CASE
          WHEN i.user_id IS NOT NULL 
            THEN 'Individual'
          WHEN o.user_id IS NOT NULL 
            THEN 'Organization'
          ELSE 'Invalid'
        END AS type
      FROM users u
      LEFT JOIN individuals i ON i.user_id = u.id
      LEFT JOIN organizations o ON o.user_id = u.id
      WHERE u.id = $1;
    `;
    const selectQuery = await client.query(selectUserSQL, [user_id]);
    if (selectQuery.rows.length <= 0)
      return createJSONErrorResponseToClient(res, 200, 404, "no-user-found");
    const selectedUser = selectQuery.rows[0];
    // =======================
    // Role Permission Checks (If editing a user that's not myself.)
    if (user_id !== req.session.user.id) {
      const activeUserSQL = `
        SELECT
          id,
          role,
          CASE 
            WHEN role ILIKE 'Admin' THEN 3
            WHEN role ILIKE 'Staff' THEN 2
            WHEN role ILIKE 'User' THEN 1
            ELSE 0
          END AS role_permission_level
        FROM users WHERE id = $1;
      `;
      const activeUserQuery = await client.query(activeUserSQL, [req.session.user.id]);

      if (activeUserQuery.rows.length <= 0)
        return createJSONErrorResponseToClient(res, 200, 404, "no-user-found");

      const activeUser = activeUserQuery.rows[0];
      if (selectedUser.role_permission_level >= activeUser.role_permission_level)
        return createJSONErrorResponseToClient(res, 200, 405, "not-authorized-to-modify-user-account");
    }
    else {
      if (role)
        return createJSONErrorResponseToClient(res, 200, 405, "not-authorized-to-change-self-role");
    }
    // =======================
    // Modify Country ID, Contact Number, Profile Picture,
    let country_id = null;
    if (country_name) {
      const selectCountryQuery = await client.query('SELECT id, name FROM countries WHERE name = $1;', [country_name]);

      if (selectCountryQuery.rows.length <= 0)
        return createJSONErrorResponseToClient(res, 200, 404, "no-valid-country-found");

      country_id = selectCountryQuery.rows[0].id;
    }
    // =======================
    // Debug
    //console.log("[Edit User Info] Parameters (ID, Email, Name, Country ID, Contact Number, Type, Identification Number).", [
      //user_id, email, name, country_id, contact_number, type, id_number
    //]);
    // =======================
    const editUserSQL = `
      UPDATE users
      SET 
        email = COALESCE($1, email),
        profile_picture = COALESCE($2, profile_picture),
        country_id = COALESCE($3, country_id),
        role = COALESCE($4, role),
        contact_number = COALESCE($5, contact_number)
      WHERE id = $6;
    `;
    const editUserQuery = await client.query(editUserSQL, [email, profile_picture, country_id, role, contact_number, user_id]);
    // =======================
    // Modify User Type (Along with new name and identification number)
    if (type && selectedUser.type !== type) {
      if (type === "Individual") {
        await client.query('DELETE FROM organizations WHERE user_id = $1', [user_id]);
        await client.query('INSERT INTO individuals (user_id, name, nric) VALUES ($1, $2, $3)', [
          user_id, name, id_number
        ]);
      }
      else {
        await client.query('DELETE FROM individuals WHERE user_id = $1', [user_id]);
        await client.query('INSERT INTO organizations (user_id, name, registration_number) VALUES ($1, $2, $3)', [
          user_id, name, id_number
        ]);
      }
    }
    // Modify Name and Identification Number
    else {
      const editNameSQL = `
        WITH updated_individuals AS (
          UPDATE individuals
          SET 
            name = COALESCE($1, name),
            nric = COALESCE($2, nric)
          WHERE id = $3
          RETURNING id, name
        ),
        updated_organizations AS (
          UPDATE organizations
          SET
            name = COALESCE($1, name),
            registration_number = COALESCE($2, registration_number)
          WHERE id = $3
          RETURNING id, name
        )
        SELECT id, name FROM updated_individuals
        UNION ALL
        SELECT id, name FROM updated_organizations;
      `;
      await client.query(editNameSQL, [name, id_number, user_id]);
    }
    // =======================
    // Debug
    //console.log("[On Delete Existing User] Log 1 - User ID", user_id);
    //console.log("[On Delete Existing User] Log 2 - Delete Query", deleteUserQuery.rowCount);

    // Track User Table Modification Records
    if (editUserQuery.rowCount > 0) {
      const insertRecords = `
        INSERT INTO user_modifications_history (modified_user_id, accountable_user_id, remark)
        VALUES ($1, $2, 'Modify User Account');
      `;
      await client.query(insertRecords, [user_id, req.session.user.id]);
    }

    // Send new data back to client.
    return createJSONSuccessResponseToClient(res, 200, {
      user: {
        user_id: parseInt(user_id)
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

// Deletes User Account
router.delete("/web/api/user", [isUserAuthorized], async (req, res) => {
  const client = await pool.connect();
  try {
    const { user_id } = req.body;
    if (user_id === req.session.user.id)
      return createJSONErrorResponseToClient(res, 200, 404, "not-authorized-to-delete-self");

    const selectUserQuery = await client.query('SELECT * FROM users WHERE id = $1;', [user_id]);
    if (selectUserQuery.rows.length <= 0)
      return createJSONErrorResponseToClient(res, 200, 404, "no-user-found");

    const deleteUserQuery = await client.query('DELETE FROM users WHERE id = $1;', [user_id]);

    // Debug
    //console.log("[On Delete Existing User] Log 1 - User ID", user_id);
    //console.log("[On Delete Existing User] Log 2 - Delete Query", deleteUserQuery.rowCount);

    // Track User Table Modification Records
    if (deleteUserQuery.rowCount > 0) {
      const insertRecords = `
        INSERT INTO user_modifications_history (modified_user_id, accountable_user_id, remark)
        VALUES ($1, $2, 'Delete User Account');
      `;
      await client.query(insertRecords, [user_id, req.session.user.id]);
    }

    // Send new data back to client.
    return createJSONSuccessResponseToClient(res, 200, {
      message: deleteUserQuery.rowCount > 0 ? "User successfully deleted." : "User already deleted or does not exist.",
      user: {
        user_id: parseInt(user_id)
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

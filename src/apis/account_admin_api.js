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
  PASSWORD_HASH_AMOUNT,
  SERVER_URL
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
const { contact } = require("telesign/lib/phoneId.js");
// =======================================
// Create a New User Account Info
router.post("/web/api/user/create", [isUserAuthorized], async (req, res) => {
  const client = await pool.connect();
  try {
    // =======================
    const { email, password, password_confirmation, name, profile_picture, country_name, role_id, contact_number, type, id_number } = req.body;

    // Debug
    //console.log("[Create New User] Body.", req.body);
    
    if (!email || !password || !password_confirmation || !name || !country_name || !role_id || !contact_number || !type || !id_number)
        return createJSONErrorResponseToClient(res, 200, 404, "incomplete-form-field");
    // =======================
    // Mismatched Password with Confirmation.
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
    // Role Permission Checks (If editing a user that's not myself.)
    const activeUserSQL = `
      SELECT
        u.id,
        r.clearance_level as role_permission_level
      FROM users u
      LEFT JOIN roles r ON r.id = u.role_id
      WHERE u.id = $1;
    `;
    const activeUserQuery = await client.query(activeUserSQL, [req.session.user.id]);

    const roleQuery = await client.query('SELECT * FROM roles WHERE id = $1;', [role_id]);
    const targetRole = roleQuery.rows[0];

    if (activeUserQuery.rows.length <= 0)
      return createJSONErrorResponseToClient(res, 200, 404, "no-user-found");
      
    const activeUser = activeUserQuery.rows[0];

    // If Staff = Can only create Users.
    // If Admins = Can only create Users, Staffs and fellow Admins.
    // If Developer = Can create Users, Staffs and Admins.
    if ((activeUser.role_permission_level < 3 && targetRole.clearance_level >= activeUser.role_permission_level) || 
      (activeUser.role_permission_level >= 3 && targetRole.clearance_level > activeUser.role_permission_level))
      return createJSONErrorResponseToClient(res, 200, 405, "not-authorized-to-create-a-user-of-higher-role");
    // =======================
    // Get Country ID from input Country Name.
    const countrySQL = `SELECT id, name from countries WHERE name = $1;`
    const countryQuery = await client.query(countrySQL, [country_name]);

    if (countryQuery.rows.length <= 0)
        return createJSONErrorResponseToClient(res, 200, 404, "no-valid-country-found");

    const country = countryQuery.rows[0];
    // =======================
    const phoneNumber = country.phone_code + body.contact_number;
    // =======================
    // Insert into users table (Email, Country ID, Contact Number, Password, Role ID, Profile Picture)
    const newUserSQL = `
      INSERT INTO users (email, country_id, contact_number, password, role_id, profile_picture)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, email;
    `;
    const hashedPassword = await generateNewPasswordHash(password);
    const newUserQuery = await client.query(newUserSQL, [email, country.id, phoneNumber, hashedPassword, role_id, profile_picture]);
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
      INSERT INTO user_email_verifications (user_id, token)
      VALUES ($1, $2);
    `;
    await client.query(verifiedQuery, [newUser.id, verificationToken]);
    // =======================
    // Send Email to Newly Registered User.
    // Requesting them to verify their email.
    await sendMailToRecipientHTML(
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
    //console.error("[On Admin Create New User] Error.", error);

    const errorDescription = error.detail;
    if (errorDescription.includes('email'))
      return createJSONErrorResponseToClient(res, 200, 409, "email-already-in-use");
    else if (errorDescription.includes('contact_number'))
      return createJSONErrorResponseToClient(res, 200, 409, "contact-number-already-in-use");

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
    const { user_id, email, name, profile_picture, country_name, role_id, contact_number, type, id_number } = req.body;

    // Debug
    //console.log("[Edit User Info] Body.", req.body);
    // =======================
    const selectUserSQL = `
      SELECT
        u.id,
        r.clearence_level as role_permission_level,
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
      LEFT JOIN roles r ON r.id = u.role_id
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
          u.id,
          r.clearance_level as role_permission_level,
        FROM users u
        LEFT JOIN roles r ON r.id = u.role_id
        WHERE u.id = $1;
      `;
      const activeUserQuery = await client.query(activeUserSQL, [req.session.user.id]);

      if (activeUserQuery.rows.length <= 0)
        return createJSONErrorResponseToClient(res, 200, 404, "no-user-found");

      const activeUser = activeUserQuery.rows[0];
      if (selectedUser.role_permission_level >= activeUser.role_permission_level)
        return createJSONErrorResponseToClient(res, 200, 405, "not-authorized-to-modify-user-account");
    }
    else {
      if (role_id)
        return createJSONErrorResponseToClient(res, 200, 405, "not-authorized-to-change-self-role");
    }
    // =======================
    // Modify Country ID, Contact Number, Profile Picture,
    let country = null;
    let phoneNumber = null;

    if (country_name) {
      const selectCountryQuery = await client.query('SELECT id, name, phone_code FROM countries WHERE name = $1;', [country_name]);

      if (selectCountryQuery.rows.length <= 0)
        return createJSONErrorResponseToClient(res, 200, 404, "no-valid-country-found");

      country = selectCountryQuery.rows[0];
    }
    else {
      const selectCountryQuery = await client.query('SELECT id, name, phone_code FROM countries WHERE id = $1;', [selectedUser.country_id]);

      if (selectCountryQuery.rows.length <= 0)
        return createJSONErrorResponseToClient(res, 200, 404, "no-valid-country-found");

      country = selectCountryQuery.rows[0];
    }
    // =======================
    // Check if Phone Number is already in use.
    const existingUserQuery = await client.query('SELECT id, contact_number FROM users WHERE contact_number = $1;', [body.contact_number]);
    const existingUser = existingUserQuery.rows.length > 0 ? existingUserQuery.rows[0] : null;
    
    if ((existingUser && country) && 
      existingUser.country_id === country.id && existingUser.contact_number === contact_number)
        return createJSONErrorResponseToClient(res, 200, 409, "contact-number-already-in-use");
    // =======================
    // Debug
    //console.log("[On Edit User Info] Parameters (ID, Email, Name, Country ID, Contact Number, Type, Identification Number).", [
      //user_id, email, name, country_id, contact_number, type, id_number
    //]);
    // =======================
    const editUserSQL = `
      UPDATE users
      SET 
        email = COALESCE($1, email),
        profile_picture = COALESCE($2, profile_picture),
        country_id = COALESCE($3, country_id),
        role_id = COALESCE($4, role_id),
        contact_number = COALESCE($5, contact_number)
      WHERE id = $6;
    `;
    const editUserQuery = await client.query(editUserSQL, [email, profile_picture, country_id, role_id, contact_number, user_id]);
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
    //console.error("[On Admin Modify Existing User] Error.", error);

    const errorDescription = error.detail;
    if (errorDescription.includes('email'))
      return createJSONErrorResponseToClient(res, 200, 409, "email-already-in-use");

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
      return createJSONErrorResponseToClient(res, 200, 405, "not-authorized-to-delete-self");

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
    //console.error("[On Admin Delete Existing User] Error.", error);

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
// =======================================
module.exports = router;

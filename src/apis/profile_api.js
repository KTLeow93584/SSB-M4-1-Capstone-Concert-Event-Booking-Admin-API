// =======================================
let express = require("express");

const { Pool } = require("pg");
const { DATABASE_URL } = process.env;

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: {
    require: true
  }
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
// Retrieve Profile Information
router.get("/api/profile", [authenticateCustomJWToken, authenticateFirebaseJWToken], async (req, res) => {
    const client = await pool.connect();

    try {
      const email = req.email;

      const userSelect = `
        SELECT
          u.id,
          u.email,
          COALESCE(i.name, o.name) AS name,
          u.profile_picture,
          u.country_id,
          u.contact_number,
          CASE
              WHEN i.user_id IS NOT NULL 
                THEN 'individual'
              WHEN o.user_id IS NOT NULL 
                THEN 'organization'
              ELSE 'invalid'
          END AS type,
          CASE
              WHEN i.user_id IS NOT NULL 
                THEN i.nric
              WHEN o.user_id IS NOT NULL 
                THEN o.registration_number
              ELSE 'invalid'
          END AS registration_number
        FROM users u
        LEFT JOIN individuals i ON i.user_id = u.id
        LEFT JOIN organizations o ON o.user_id = u.id
        WHERE email = $1;
      `;
      const userSelectQuery = await client.query(userSelect, [email]);

      // Email linked to no existing user.
      if (userSelectQuery.rows.length <= 0) 
        return createJSONErrorResponseToClient(res, 200, 404, "no-user-found");

      const result = userSelectQuery.rows[0];

      // User is both an individual and an organization or neither of both, this should not happen.
      if (result.type === 'invalid') 
        return createJSONErrorResponseToClient(res, 200, 404, "invalid-user-format");

      // Send new data back to client.
      return createJSONSuccessResponseToClient(res, 200, {
        user: { ...result }
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
  },
);

// Update Profile
router.put("/api/profile", [authenticateCustomJWToken, authenticateFirebaseJWToken], async (req, res) => {
    const client = await pool.connect();

    try {
      // ==============================================
      let { name, country_id, contact_number, profile_picture } = req.body;
      const email = req.email;
      // ==============================================
      if (!name && !country_id && !contact_number && !profile_picture)
        return createJSONErrorResponseToClient(res, 200, 405, "empty-form");

      if (contact_number && typeof contact_number === "number")
        contact_number = contact_number.toString();
      // ==============================================
      const userQuery = await client.query('SELECT id FROM users  WHERE email = $1;', [email]);

      if (userQuery.rows.length <= 0)
        return createJSONErrorResponseToClient(res, 200, 404, "no-user-found");
      // ==============================================
      let sql = `
        UPDATE users SET
          country_id = COALESCE($1, country_id),
          contact_number = COALESCE($2, contact_number),
          profile_picture = COALESCE($3, profile_picture)
        WHERE email = $4
        RETURNING id, country_id, contact_number, profile_picture;
      `;

      let sqlQuery = await client.query(sql, [ country_id, contact_number, profile_picture, email ]);
      const user = sqlQuery.rows[0];

      // Debug
      //console.log("[Updated User Profile] New User's Info", user);
      // ==============================================
      sql = `
        WITH updated_individuals AS (
            UPDATE individuals
              SET name = COALESCE($1, name)
            WHERE id = $2
            RETURNING id, name
        ),
        updated_organizations AS (
            UPDATE organizations
              SET name = COALESCE($1, name)
            WHERE id = $2
            RETURNING id, name
        )
        SELECT id, name FROM updated_individuals
        UNION ALL
        SELECT id, name FROM updated_organizations;
      `;
      
      sqlQuery = await client.query(sql, [ name, user.id ]);
      let userName = null;
      if (sqlQuery.rows.length > 0) {
        userName = sqlQuery.rows[0].name;

        // Debug
        //console.log("Result.", sqlQuery.rows[0]);
      }
      // ==============================================
      // Send new data back to client.
      return createJSONSuccessResponseToClient(res, 200, {
        user: { ...user, name: userName }
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
  },
);
// =======================================
async function getUserProfileInfo(client, user_id) {
  const userProfileQuery = `
      SELECT 
        u.id as user_id,
        COALESCE(i.name, o.name) AS name,
        u.profile_picture

        FROM users u
        
        LEFT JOIN individuals i ON i.user_id = u.id
        LEFT JOIN organizations o ON o.user_id = u.id

        WHERE u.id = $1;
    `;
  query = await client.query(userProfileQuery, [user_id]);
  const user = query.rows[0];

  // Debug
  //console.log("[Get User Profile (Self)] Result", user);

  return user;
}
// =======================================
module.exports = router;

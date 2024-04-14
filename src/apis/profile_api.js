// =======================================
let express = require("express");

const { Pool } = require("pg");
const { DATABASE_URL } = process.env;

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: {
    require: true,
  },
});
const router = express.Router();

// Middlewares.
const {
  authenticateCustomJWToken,
  authenticateFirebaseJWToken,
  createJSONSuccessResponseToClient,
  createJSONErrorResponseToClient,
} = require("../services/middlewares.js");
// =======================================
router.get(
  "/profile",
  [authenticateCustomJWToken, authenticateFirebaseJWToken],
  async (req, res) => {
    const client = await pool.connect();

    try {
      const email = req.email;

      // Retrieve the user id from email for next query.
      let sqlQuery = `SELECT id FROM users WHERE email = $1`;
      let query = await client.query(sqlQuery, [email]);
      const user_id = query.rows[0].id;

      const result = await getUserProfileInfo(client, user_id);

      // Send new data back to client.
      return createJSONSuccessResponseToClient(res, 200, {
        user: {
          ...result,
        },
      });
    } catch (error) {
      // Debug
      console.error(error.stack);

      return createJSONErrorResponseToClient(res, 200, 500, "server-error");
    } finally {
      client.release();
    }
  },
);

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

router.put(
  "/profile",
  [authenticateCustomJWToken, authenticateFirebaseJWToken],
  async (req, res) => {
    const client = await pool.connect();

    try {
      // ==============================================
      let { name, profile_picture } = req.body;
      const email = req.email;
      // ==============================================
      let userQuery = `
        SELECT id, profile_picture
        FROM users 
        WHERE email = $1;
      `;
      const existingUser = await client.query(userQuery, [email]);
      if (existingUser.rows.length <= 0)
        return createJSONErrorResponseToClient(res, 200, 404, "no-user-found");
      const existingUserResult = existingUser.rows[0];

      const updateUserQuery = `
        UPDATE users SET 
          profile_picture = COALESCE(NULLIF($1, ''), profile_picture)
        WHERE email = $2
        RETURNING id, email;
      `;

      const updateUser = await client.query(updateUserQuery, [
        profile_picture,
        email,
      ]);
      const updatedUserResult = updateUser.rows[0];

      // Debug
      //console.log("[Updated User Profile] User Info", userResult);
      // ==============================================
      const userTypeQuery = `
        SELECT 
          u.id as user_id,
          CASE
            WHEN i.name IS NOT NULL THEN 'Individual'
            WHEN o.name IS NOT NULL THEN 'Organization'
            ELSE 'Unknown'
          END AS user_type
        FROM 
          users u
        LEFT JOIN individuals i ON u.id = i.user_id
        LEFT JOIN organizations o ON u.id = o.user_id
        WHERE u.email = $1;
      `;
      const userType = await client.query(userTypeQuery, [email]);
      if (userType.rows.length <= 0) {
        return createJSONErrorResponseToClient(
          res,
          200,
          405,
          "user-without-a-type",
        );
      }
      const userTypeResult = userType.rows[0];
      // ==============================================
      let updateCategoryQuery = null;
      let updateCategory = null;

      switch (userTypeResult.user_type) {
        case "Individual":
          updateCategoryQuery = `
            UPDATE individuals SET 
              name = $1
            WHERE user_id = $2
            RETURNING name;
          `;

          updateCategory = await client.query(updateCategoryQuery, [
            name,
            existingUserResult.id,
          ]);
          break;
        case "Organization":
          updateCategoryQuery = `
            UPDATE organizations SET 
              name = $1
            WHERE user_id = $2
            RETURNING name;
          `;

          updateCategory = await client.query(updateCategoryQuery, [
            name,
            existingUserResult.id,
          ]);
          break;
        default:
          return createJSONErrorResponseToClient(res, 200, 405, "invalid-user");
      }
      const updateCategoryResult = updateCategory.rows[0];
      // ==============================================
      // Debug
      //console.log("[Updated User Profile] User Type Info", existingUserResult);

      const user = {
        name: updateCategoryResult.name,
        profile_picture: updatedUserResult.profile_picture,
      };
      // ==============================================
      // Send new data back to client.
      return createJSONSuccessResponseToClient(res, 200, {
        user: { ...user },
      });
    } catch (error) {
      // Debug
      console.error(error.stack);

      return createJSONErrorResponseToClient(res, 200, 500, "server-error");
    } finally {
      client.release();
    }
  },
);
// =======================================
module.exports = router;

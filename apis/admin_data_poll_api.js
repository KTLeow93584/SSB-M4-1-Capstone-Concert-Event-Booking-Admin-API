// =======================================
let express = require('express');

const { Pool } = require('pg');
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
  authenticateCustomJWToken, authenticateFirebaseJWToken,
  createJSONSuccessResponseToClient, createJSONErrorResponseToClient
} = require('../middlewares.js');
// =======================================
router.get('/events/ad', [authenticateCustomJWToken, authenticateFirebaseJWToken], async (req, res) => {
  const client = await pool.connect();

  try {
    const { page_id, data_per_page } = req.params;
    const email = req.email;

    // Retrieve the user id from email for next query.
    let sqlQuery = `SELECT id FROM users WHERE email = $1`;
    let query = await client.query(sqlQuery, [email]);
    const user_id = query.rows[0].id;

    const dataPerPage = data_per_page ? data_per_page : 25;
    const offset = dataPerPage * (page_id - 1);

    // Explanation:
    // - Select from "users" table the following: [id with ALIAS of user_id, email, first_name, last_name, profile_image]
    // - Also select the number of followers via comparing [user table's id] with [following table's user_id] where the latter would be
    // matched against the target user's id.
    // - Also makes sure to not include self in results (u.id != $1).
    userQuery = `
      SELECT 
        u.id AS user_id, 
        u.email, 
        first_name, 
        last_name, 
        profile_image, 
        COUNT(f.follower_id) AS total_followers 
      FROM users u 
      LEFT JOIN following f ON u.id = f.user_id 
      WHERE u.email != $1 
      GROUP BY u.id 
      OFFSET $2 
      FETCH NEXT $3 ROWS ONLY;
    `;
    const userQueryResult = await client.query(userQuery, [user_id, offset, dataPerPage]);
    let userRows = userQueryResult.rows;

    const followersQuery = await client.query('SELECT * FROM following WHERE follower_id = $1;', [user_id]);
    const followerResults = followersQuery.rows;

    const followerUserIDs = followerResults.map((follower) => follower.user_id);
    userRows = userRows.map((user) => ({
      user_id: user.user_id,
      first_name: user.first_name,
      last_name: user.last_name,
      profile_image: user.profile_image,
      followed: followerUserIDs.includes(user.user_id),
      total_followers: user.total_followers
    }));

    // Debug
    //console.log("User ID.", user_id);
    //console.log("Users.", userRows);
    //console.log("Followers", followerResults);

    return createJSONSuccessResponseToClient(res, 200, { users: userRows });
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

router.get('/event/admin', [authenticateCustomJWToken, authenticateFirebaseJWToken], async (req, res) => {
  const client = await pool.connect();

  try {
    const email = req.email;

    // Retrieve the user id from email for next query.
    let sqlQuery = `SELECT id FROM users WHERE email = $1`;
    let query = await client.query(sqlQuery, [email]);
    const user_id = query.rows[0].id;

    // Explanation:
    // - Select from "users" table the following: [id with ALIAS of user_id, email, first_name, last_name, profile_image]
    // - Also select the number of followers via comparing [user table's id] with [following table's user_id] where the latter would be
    // matched against the target user's id.
    // - Also makes sure to not include self in results (u.id != $1).
    sqlQuery = `
      SELECT 
        u.id AS user_id, 
        u.email, 
        first_name, 
        last_name, 
        profile_image,
        COUNT(f.follower_id) AS total_followers 
      FROM users u 
      LEFT JOIN following f ON u.id = f.user_id 
      WHERE u.email != $1 
      GROUP BY u.id;
    `;
    const getUsersQuery = await client.query(sqlQuery, [email]);
    let userResults = getUsersQuery.rows;

    const followersQuery = await client.query('SELECT * FROM following WHERE follower_id = $1;', [user_id]);
    const followerResults = followersQuery.rows;

    const followerUserIDs = followerResults.map((follower) => follower.user_id);
    userResults = userResults.map((user) => ({
      user_id: user.user_id,
      first_name: user.first_name,
      last_name: user.last_name,
      profile_image: user.profile_image,
      followed: followerUserIDs.includes(user.user_id),
      total_followers: user.total_followers
    }));

    // Debug
    //console.log("Email.", email);
    //console.log("Users.", userResults);
    //console.log("Followers", followerResults);

    return createJSONSuccessResponseToClient(res, 200, userResults);
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
module.exports = router;
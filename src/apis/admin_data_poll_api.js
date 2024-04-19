// =======================================
let express = require('express');

const { Pool } = require('pg');
const { DATABASE_URL, USERS_PER_PAGE } = process.env;

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: {
    require: true
  }
});
const router = express.Router();

// Middlewares.
const {
  sendInfoToRedirectedPage,
  sendErrorResponseToRedirectedPage
} = require("../services/middlewares-server.js");
// =======================================
async function getUsers (req, res) {
  const client = await pool.connect();

  try {
    let { page, user_id, name, email, country_name, contact_number, user_type, id_number } = req.query;

    // Debug
    //console.log("Queries.", req.query);

    const usersPerPage = parseInt(USERS_PER_PAGE);

    let query = await client.query('SELECT COUNT(*) as total FROM users;');

    const totalUserCount = query.rows[0].total;
    const totalPageCount = Math.ceil(totalUserCount/usersPerPage);

    if (page === undefined)
      page = 1;
    else {
      if (page < 0) {
        return {
          out_of_page_bounds: true,
          page_redirect_no: 1
        };
      }
      else if (page > totalPageCount) {
        return {
          out_of_page_bounds: true,
          page_redirect_no: totalPageCount
        };
      }
    }

    // Retrieve the user id from email for next query.
    let sqlQuery = `
      SELECT
        u.id,
        u.email,
        COALESCE(i.name, o.name) AS name,
        u.profile_picture,
        u.country_id,
        u.contact_number,
        c.name AS country_name,
        c.phone_code AS country_code,
        CASE
            WHEN i.user_id IS NOT NULL 
              THEN 'Individual'
            WHEN o.user_id IS NOT NULL 
              THEN 'Organization'
            ELSE 'Invalid'
        END AS type,
        CASE
            WHEN i.user_id IS NOT NULL 
              THEN i.nric
            WHEN o.user_id IS NOT NULL 
              THEN o.registration_number
            ELSE NULL
          END AS identification_number,
        CASE
            WHEN uv.user_id IS NOT NULL AND uv.verified_at IS NOT NULL
              THEN 1
            ELSE 0
        END AS verified,
        u.created_at as account_creation_date
      FROM users u
      LEFT JOIN individuals i ON i.user_id = u.id
      LEFT JOIN organizations o ON o.user_id = u.id
      LEFT JOIN user_verifications uv ON uv.user_id = u.id
      LEFT JOIN countries c ON u.country_id = c.id
      WHERE
        (COALESCE(i.name, o.name) ILIKE $1 OR $1 IS NULL)
        AND
        (email ILIKE $2 OR $2 IS NULL)
        AND
        (u.id = $3 OR $3 IS NULL)
        AND
        (c.name ILIKE $4 OR $4 IS NULL)
        AND
        (u.contact_number ILIKE $5 OR $5 IS NULL)
        AND
        (
            (i.user_id IS NOT NULL AND 'Individual' ILIKE $6)
            OR
            (o.user_id IS NOT NULL AND 'Organization' ILIKE $6)
            OR
            ($6 IS NULL)
        )
        AND
        (
            (i.user_id IS NOT NULL AND i.nric ILIKE $7)
            OR
            (o.user_id IS NOT NULL AND o.registration_number ILIKE $7)
            OR
            ($7 IS NULL)
        )
      ORDER BY u.id ASC
      LIMIT $8 OFFSET $9;
    `;

    // Parse Variables
    name = name ? `%${name}%` : null;
    email = email ? `%${email}%` : null;
    user_id = isNaN(parseInt(user_id)) ? null : parseInt(user_id);
    country_name = country_name ? `%${country_name}%` : null;
    contact_number = contact_number ? `%${contact_number}%` : null;
    user_type = user_type ? `%${user_type}%` : null;
    id_number = id_number ? `%${id_number}%` : null;

    // Debug country_name, contact_number, user_type, id_number } = req.query;
    //console.log("[On Admin Poll Users] Parameters (Name, Email, ID, Country Name, Contact Number, Type, ID Number).", [
      //name, email, user_id, country_name, contact_number, user_type, id_number
    //]);
    //console.log("[On Admin Poll Users] Pagination Data (Items Per Page, Offset).", [
      //usersPerPage, (parseInt(page) - 1)  * usersPerPage
    //]);

    query = await client.query(sqlQuery, [
      name, email, user_id, country_name,
      contact_number, user_type, id_number,
      usersPerPage, (parseInt(page) - 1)  * usersPerPage]);
    const users = query.rows && query.rows.length > 0 ? query.rows : [];

    // Debug
    //console.log("[Admin Data Poll] Paginated Users.", users);
    //console.log("[Admin Data Poll] Paginated User Count.", users.length);

    return {
      users: users,
      totalPageCount: totalPageCount
    };
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
};
// =======================================
module.exports = { router, getUsers };
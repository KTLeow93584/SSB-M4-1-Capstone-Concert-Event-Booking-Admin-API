
// =======================================
let express = require('express');

const { Pool } = require('pg');
const {
  DATABASE_URL,
  USERS_PER_PAGE
} = process.env;

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: {
    require: true
  }
});

const router = express.Router();

const {
    retrievePaginationInfo
} = require("../services/pagination.js");

const {
    isUserAuthorized
} = require('../services/middlewares');
// =======================================
router.get("/users", isUserAuthorized, async (req, res) => {
  const result = await getUsers(req, res);

  // Debug
  //console.log("Result.", result);
  
  res.render("./pages/users/index", {
    user: req.session && req.session.user ? req.session.user : null,
    ...result
  });
});

router.get("/user/view/:id", isUserAuthorized, async (req, res) => {
  const result = await getUserInfo(req, res);

  // Debug
  //console.log("Result.", result);
  
  res.render("./pages/users/view", { 
    user: req.session && req.session.user ? req.session.user : null,
    target_user: { ...result.user }
  });
});

router.get("/user/create", isUserAuthorized, async (req, res) => {
  const countries = await getCountriesInfo(req, res);
  const roles = await getAvailableRoles(req, res);

  res.render("./pages/users/create", { 
    user: req.session && req.session.user ? req.session.user : null,
    countries: countries,
    roles: roles
  });
});

router.get("/user/edit/:id", isUserAuthorized, async (req, res) => {
  const result = await getUserInfo(req, res);

  // Debug
  //console.log("Result.", result);

  // Must be above target user's permission level, if not SELF.
  if (req.session.user.role_permission_level <= result.user.role_permission_level && req.session.user.id !== result.user.id)
    return res.redirect("/unauthorized");
  
  const countries = await getCountriesInfo(req, res);
  const roles = await getAvailableRoles(req, res);
  
  res.render("./pages/users/edit", { 
    user: req.session && req.session.user ? req.session.user : null,
    target_user: { ...result.user },
    countries: countries,
    roles: roles
  });
});
// =======================================
async function getUsers(req, res) {
  const client = await pool.connect();

  try {
    let { page, name, email, user_id, country_name, contact_number, user_type, id_number } = req.query;
    // Debug
    //console.log("[On Admin Poll Users] Queries.", req.query);
  
    page = (page === undefined) ? 1 : parseInt(page);

    // Debug
    //console.log("[On Admin Poll Users] Page.", page);
    // =====================================
    // Parse Variables
    name = name ? `%${name}%` : null;
    email = email ? `%${email}%` : null;
    user_id = isNaN(parseInt(user_id)) ? null : parseInt(user_id);
    country_name = country_name ? `%${country_name}%` : null;
    contact_number = contact_number ? `%${contact_number}%` : null;
    
    if (user_type && user_type === 'Individual' || user_type === 'Organization')
      user_type = `%${user_type}%`;
    else
      user_type = null;

    id_number = id_number ? `%${id_number}%` : null;
    // =====================================
    const filterSubQuery = `
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
    `;
    // =====================================
    // Get Total Amount of Result then tally with page query.
    // If page exceed maximum number of pages -> Cap to last page.
    let sqlQuery = `
      SELECT
        COUNT(u.id) as total
      FROM users u
      LEFT JOIN individuals i ON i.user_id = u.id
      LEFT JOIN organizations o ON o.user_id = u.id
      LEFT JOIN user_verifications uv ON uv.user_id = u.id
      LEFT JOIN countries c ON u.country_id = c.id
      ${filterSubQuery};
    `;
    let query = await client.query(sqlQuery, [
       name, email, user_id, country_name,
       contact_number, user_type, id_number
    ]);

    const usersPerPage = parseInt(USERS_PER_PAGE);
    const totalUserCount = query.rows[0].total;
    const totalPageCount = Math.max(Math.ceil(totalUserCount/usersPerPage), 1);

    if (page > totalPageCount)
      page = totalPageCount;
    // =====================================
    // Retrieve the user id from email for next query.
    sqlQuery = `
      SELECT
        u.id,
        u.email,
        COALESCE(i.name, o.name) AS name,
        u.profile_picture,
        u.country_id,
        u.contact_number,
        r.name as role_name,
        r.clearance_level as role_permission_level,
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
          WHEN uv.user_id IS NOT NULL AND uv.verified_at IS NOT NULL THEN 1
          ELSE 0
        END AS verified,
        u.created_at as account_creation_date
      FROM users u
      LEFT JOIN individuals i ON i.user_id = u.id
      LEFT JOIN organizations o ON o.user_id = u.id
      LEFT JOIN user_verifications uv ON uv.user_id = u.id
      LEFT JOIN countries c ON u.country_id = c.id
      LEFT JOIN roles r ON r.id = u.role_id
      ${filterSubQuery}
      ORDER BY u.id ASC
      LIMIT $8 OFFSET $9;
    `;

    // Debug
    //console.log("[On Admin Poll Users] Parameters (Page, Name, Email, ID, Country Name, Contact Number, Type, ID Number).", [
      //page, name, email, user_id, country_name, contact_number, user_type, id_number
    //]);

    // Debug
    //console.log("[On Admin Poll Users] Pagination Data (Items Per Page, Offset).", [
      //usersPerPage, (page - 1)  * usersPerPage
    //]);

    query = await client.query(sqlQuery, [
      name, email, user_id, country_name,
      contact_number, user_type, id_number,
      usersPerPage, (page - 1)  * usersPerPage]);
    const users = query.rows && query.rows.length > 0 ? query.rows : [];

    // Debug
    //console.log("[Admin Data Poll] Paginated Users.", users);
    //console.log("[Admin Data Poll] Paginated User Count.", users.length);
    // ================================
    // Paginate Parameters Setup
    const paginateInfo = retrievePaginationInfo(page, totalPageCount);

    const renderResult = {
      users: users,
      active_page_number: page,
      start_page_number: paginateInfo.start_page_number,
      end_page_number: paginateInfo.end_page_number,
      total_page_count: totalPageCount,
      form_data: {...req.query }
    };

    // Debug
    //console.log("[Render Results]", renderResult);

    return renderResult;
  }
  catch (error) {
    // Debug
    console.error(error.stack);

    return {
      error: { 
        type: "server-error", 
        message: "Something went wrong with the server"
      }
    };
  }
  finally {
    client.release();
  }
};

async function getUserInfo(req, res) {
  const client = await pool.connect();

  try {
    let { id } = req.params;
    // =====================================
    // Debug
    //console.log("[On Admin Poll User Info] Params.", req.params);
    // =====================================
    let sqlQuery = `
      SELECT
        u.id,
        u.email,
        COALESCE(i.name, o.name) AS name,
        u.profile_picture,
        u.country_id,
        u.contact_number,
        r.name as role_name,
        r.clearance_level as role_permission_level,
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
      LEFT JOIN roles r ON r.id = u.role_id
      WHERE
        u.id = $1;
    `;

    let query = await client.query(sqlQuery, [id]);
    const user = query.rows && query.rows.length > 0 ? query.rows[0] : null;
    // =====================================
    const result = { user: user };

    // Debug
    //console.log("[Poll User Info] Result.", result);
    // =====================================
    return result;
  }
  catch (error) {
    // Debug
    console.error(error.stack);

    return {
      error: { 
        type: "server-error", 
        message: "Something went wrong with the server"
      }
    };
  }
  finally {
    client.release();
  }
}

async function getCountriesInfo(req, res) {
  const client = await pool.connect();

  try {
    let sqlQuery = `
      SELECT
        id,
        name,
        phone_code
      FROM countries;
    `;
    let query = await client.query(sqlQuery);
    const countries = query.rows && query.rows.length > 0 ? query.rows : [];
    
    return countries;
  }
  catch (error) {
    // Debug
    console.error(error.stack);

    return {
      error: { 
        type: "server-error", 
        message: "Something went wrong with the server"
      }
    };
  }
  finally {
    client.release();
  }
}

async function getAvailableRoles(req, res) {
  const client = await pool.connect();

  try {
    let sqlQuery = `
      SELECT
        id,
        name,
        clearance_level
      FROM roles;
    `;

    let query = await client.query(sqlQuery,);
    const roles = query.rows && query.rows.length > 0 ? query.rows : [];
    
    return roles;
  }
  catch (error) {
    // Debug
    console.error(error.stack);

    return {
      error: { 
        type: "server-error", 
        message: "Something went wrong with the server"
      }
    };
  }
  finally {
    client.release();
  }
}
// =======================================
module.exports = router;
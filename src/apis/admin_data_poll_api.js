// =======================================
let express = require('express');

const { Pool } = require('pg');
const {
  DATABASE_URL, MAX_PAGE_RANGE,
  EVENTS_PER_PAGE, USERS_PER_PAGE
} = process.env;

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: {
    require: true
  }
});
const router = express.Router();
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
        u.role,
        CASE 
          WHEN u.role ILIKE 'Admin' THEN 3
          WHEN u.role ILIKE 'Staff' THEN 2
          WHEN u.role ILIKE 'User' THEN 1
          ELSE 0
        END AS role_permission_level,
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
        u.role,
        CASE 
            WHEN u.role ILIKE 'Admin' THEN 3
            WHEN u.role ILIKE 'Staff' THEN 2
            WHEN u.role ILIKE 'User' THEN 1
            ELSE 0
        END AS role_permission_level,
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
        u.id = $1;
    `;

    let query = await client.query(sqlQuery, [id]);
    const user = query.rows && query.rows.length > 0 ? query.rows[0] : null;
    // =====================================
    sqlQuery = `
      SELECT
        id,
        name,
        phone_code
      FROM countries;
    `;
    query = await client.query(sqlQuery);
    const countries = query.rows && query.rows.length > 0 ? query.rows : [];
    // =====================================
    const result = { user: user, countries: countries };

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
// =======================================
async function getEvents(req, res) {
  const client = await pool.connect();

  try {
    let { page, event_id, event_name, organiser_name, organiser_email, staff_name, staff_email, venue_address } = req.query;
    // Debug
    //console.log("[On Admin Poll Events] Queries.", req.query);
  
    page = (page === undefined) ? 1 : parseInt(page);

    // Debug
    //console.log("[On Admin Poll Events] Page.", page);
    // =====================================
    // Parse Variables
    event_id = isNaN(parseInt(event_id)) ? null : parseInt(event_id);
    event_name = event_name ? `%${event_name}%` : null;

    organiser_name = organiser_name ? `%${organiser_name}%` : null;
    organiser_email = organiser_email ? `%${organiser_email}%` : null;

    staff_name = staff_name ? `%${staff_name}%` : null;
    staff_email = staff_email ? `%${staff_email}%` : null;

    venue_address = venue_address ? `%${venue_address}%` : null;
    // =====================================
    const filterSubQuery = `
      WHERE
        (e.id = $1 OR $1 IS NULL)
        AND
        (e.name ILIKE $2 OR $2 IS NULL)
        AND
        (COALESCE(uoi.name, uoo.name) ILIKE $3 OR $3 IS NULL)
        AND
        (uo.email ILIKE $4 OR $4 IS NULL)
        AND
        (COALESCE(usi.name, uso.name) ILIKE $5 OR $5 IS NULL)
        AND
        (us.email ILIKE $6 OR $6 IS NULL)
        AND
        (v.address ILIKE $7 OR $7 IS NULL)
    `;
    // =====================================
    // Get Total Amount of Result then tally with page query.
    // If page exceed maximum number of pages -> Cap to last page.
    let sqlQuery = `
      SELECT
        COUNT(e.id) as total
      FROM events e

      LEFT JOIN users uo ON e.organiser_id = uo.id
      LEFT JOIN individuals uoi ON uoi.user_id = uo.id
      LEFT JOIN organizations uoo ON uoo.user_id = uo.id

      LEFT JOIN users us ON e.staff_id = us.id
      LEFT JOIN individuals usi ON usi.user_id = us.id
      LEFT JOIN organizations uso ON uso.user_id = us.id

      LEFT JOIN venues v ON e.venue_id = v.id
      ${filterSubQuery};
    `;
    let query = await client.query(sqlQuery, [
       event_id, event_name, organiser_name, organiser_email,
       staff_name, staff_email, venue_address
    ]);

    const eventsPerPage = parseInt(EVENTS_PER_PAGE);
    const totalUserCount = query.rows[0].total;
    const totalPageCount = Math.max(Math.ceil(totalUserCount/eventsPerPage), 1);

    if (page > totalPageCount)
      page = totalPageCount;
    // =====================================
    // Retrieve the user id from email for next query.
    sqlQuery = `
      SELECT
        e.id,
        e.name,
        uo.id as organiser_id,
        uo.email as organiser_email,
        COALESCE(uoi.name, uoo.name) AS organiser_name,
        
        us.id as staff_id,
        us.email as staff_email,
        COALESCE(usi.name, uso.name) AS staff_name,
        v.address as venue_address,
        CASE 
            WHEN us.role ILIKE 'Admin' THEN 3
            WHEN us.role ILIKE 'Staff' THEN 2
            WHEN us.role ILIKE 'User' THEN 1
            ELSE 0
        END AS staff_role_permission_level,
        e.created_at as event_creation_date
      FROM events e

      LEFT JOIN users uo ON e.organiser_id = uo.id
      LEFT JOIN individuals uoi ON uoi.user_id = uo.id
      LEFT JOIN organizations uoo ON uoo.user_id = uo.id

      LEFT JOIN users us ON e.staff_id = us.id
      LEFT JOIN individuals usi ON usi.user_id = us.id
      LEFT JOIN organizations uso ON uso.user_id = us.id

      LEFT JOIN venues v ON e.venue_id = v.id
      ${filterSubQuery}
      ORDER BY e.id ASC
      LIMIT $8 OFFSET $9;
    `;

    // Debug
    //console.log("[On Admin Poll Events] Parameters (Page, Event ID, Event Name, Organiser Name, Organiser Email, Staff Name, Staff Email, Venue Address).", [
      //page, event_id, event_name, organiser_name, organiser_email, staff_name, staff_email, venue_address
    //]);

    // Debug
    //console.log("[On Admin Poll Events] Pagination Data (Items Per Page, Offset).", [
      //eventsPerPage, (page - 1)  * eventsPerPage
    //]);

    query = await client.query(sqlQuery, [
      event_id, event_name, organiser_name, organiser_email,
      staff_name, staff_email, venue_address,
      eventsPerPage, (page - 1)  * eventsPerPage]);
    const events = query.rows && query.rows.length > 0 ? query.rows : [];

    // Debug
    //console.log("[Admin Data Poll] Paginated Events.", events);
    //console.log("[Admin Data Poll] Paginated Event Count.", events.length);
    // ================================
    // Paginate Parameters Setup
    const paginateInfo = retrievePaginationInfo(page, totalPageCount);
    
    const renderResult = {
      events: events,
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

async function getEventInfo(req, res) {
  const client = await pool.connect();

  try {
    let { id } = req.params;
    // =====================================
    // Debug
    //console.log("[On Admin Poll Event Info] Params.", req.params);
    // =====================================
    let sqlQuery = `
      SELECT
        e.id,
        e.name,

        uo.id as organiser_id,
        uo.email as organiser_email,
        COALESCE(uoi.name, uoo.name) as organiser_name,
        
        us.id as staff_id,
        us.email as staff_email,
        COALESCE(usi.name, uso.name) as staff_name,

        e.scheduled_at_start as event_start_datetime,
        e.scheduled_at_end as event_end_datetime,

        v.id as venue_id,
        v.address as venue_address,
        v.state as venue_state,
        e.promo_image,
        e.created_at as event_creation_datetime,
        e.remarks
      FROM events e

      LEFT JOIN users uo ON e.organiser_id = uo.id
      LEFT JOIN individuals uoi ON uoi.user_id = uo.id
      LEFT JOIN organizations uoo ON uoo.user_id = uo.id

      LEFT JOIN users us ON e.staff_id = us.id
      LEFT JOIN individuals usi ON usi.user_id = us.id
      LEFT JOIN organizations uso ON uso.user_id = us.id

      LEFT JOIN venues v ON e.venue_id = v.id
      WHERE
        e.id = $1;
    `;

    let query = await client.query(sqlQuery, [id]);
    const event = query.rows && query.rows.length > 0 ? query.rows[0] : null;
    
    // Debug
    //console.log("[On Admin Poll Event Info] Event.", event);
    // =====================================
    query = await client.query("SELECT * FROM venues;");
    const venues = query.rows && query.rows.length > 0 ? query.rows : [];
    // =====================================
    sqlQuery = `
      SELECT
        u.id,
        u.email,
        COALESCE(i.name, o.name) as name
      FROM users u
      LEFT JOIN individuals i ON i.user_id = u.id
      LEFT JOIN organizations o ON o.user_id = u.id
      WHERE u.role != 'user';
    `;
    query = await client.query(sqlQuery);
    const users = query.rows && query.rows.length > 0 ? query.rows : [];
    // =====================================
    return { event: event, venues: venues, users: users };
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

async function getOrganisersInfo(req, res) {
  const client = await pool.connect();

  try {
    let sqlQuery = `
      SELECT
        u.id,
        u.email,
        COALESCE(i.name, o.name) as name
      FROM users u
      LEFT JOIN individuals i ON i.user_id = u.id
      LEFT JOIN organizations o ON o.user_id = u.id
      WHERE u.role = 'user';
    `;
    query = await client.query(sqlQuery);
    const organisers = query.rows && query.rows.length > 0 ? query.rows : [];
    
    return organisers;
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

async function getStaffsInfo(req, res) {
  const client = await pool.connect();

  try {
    let sqlQuery = `
      SELECT
        u.id,
        u.email,
        COALESCE(i.name, o.name) as name
      FROM users u
      LEFT JOIN individuals i ON i.user_id = u.id
      LEFT JOIN organizations o ON o.user_id = u.id
      WHERE u.role != 'user';
    `;
    query = await client.query(sqlQuery);
    const staffs = query.rows && query.rows.length > 0 ? query.rows : [];
    
    return staffs;
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

async function getVenuesInfo(req, res) {
  const client = await pool.connect();

  try {
    let query = await client.query("SELECT * FROM venues;");
    const venues = query.rows && query.rows.length > 0 ? query.rows : [];
    
    return venues;
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
// Paginate Parameters Setup
function retrievePaginationInfo(page, totalPageCount) {
  const pageRange = parseInt(MAX_PAGE_RANGE);

  const floorPageOffset = parseInt(page - 1) - pageRange;
  const ceilingPageOffset = parseInt(page - 1) + pageRange;

  // E.g. (Offset Ceiling to the Right)
  // Current Page: 2, Max Page Range: +4/-4, Total Number of Pages: 12
  // Floor Offset: -2
  // Floor Ceiling: 6
  // Start:
  // = 0
  // End: 
  // = Current Page + Max Page Range - (Floor Offset excess negative beyond 0)
  // = (2 + 4 - (-2)) = 6 + 2 = 8
  
  // E.g. (Offset Ceiling to the Left)
  // Current Page: 10, Max Page Range: +4/-4, Total Number of Pages: 12
  // Floor Offset: 6
  // Floor Ceiling: 14
  // Start:
  // = Current Page - Max Page Range - (Ceiling Offset excess positive)
  // = 10 - 4 - 2
  // = 4
  // End: 
  // = 12 (Cap at 12), excess +2.
  return {
    start_page_number: Math.max(page - pageRange - Math.max(ceilingPageOffset - totalPageCount, 0), 1),
    end_page_number: Math.min(page + pageRange - Math.min(floorPageOffset, 0), totalPageCount)
  };
}
// =======================================
module.exports = {
  router,
  getUsers, getUserInfo, getCountriesInfo,
  getEvents, getEventInfo, getVenuesInfo, getOrganisersInfo, getStaffsInfo
};
// =======================================
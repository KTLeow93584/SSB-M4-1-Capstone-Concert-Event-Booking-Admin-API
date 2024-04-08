// =======================================
let express = require("express");

const { Pool } = require("pg");
const { DATABASE_URL } = process.env;

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
} = require("../middlewares.js");
// =======================================
// Retrieve All Events from a specific user (Must be Logged In) Endpoint.
router.get("/events/user", [authenticateCustomJWToken, authenticateFirebaseJWToken], async (req, res) => {
  const client = await pool.connect();

  try {
    const email = req.email;

    // Retrieve the user id from email for next query.
    let sqlQuery = `SELECT id, role FROM users WHERE email = $1`;
    let query = await client.query(sqlQuery, [email]);
    const user = query.rows[0];
    const user_id = user.id;

    if (user.role !== "user")
      return createJSONErrorResponseToClient(res, 200, 405, "incorrect-role");

    const eventResults = await performEventsToDisplayQuery(
      client,
      user_id,
      user.role,
    );

    if (eventResults.rowCount > 0)
      return createJSONSuccessResponseToClient(res, 200, {
        events: eventResults.rows,
      });
    else {
      createJSONSuccessResponseToClient(res, 200, {
        message: "No events found for this user.",
        events: [],
      });
    }
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

// Retrieve All Events from a specific staff/administrator User (Must be Logged In) Endpoint.
router.get("/events/staff", [authenticateCustomJWToken, authenticateFirebaseJWToken], async (req, res) => {
  const client = await pool.connect();

  try {
    const email = req.email;

    // Retrieve the user id from email for next query.
    let sqlQuery = `SELECT id, role FROM users WHERE email = $1`;
    let query = await client.query(sqlQuery, [email]);
    const user = query.rows[0];
    const user_id = user.id;

    if (user.role === "user")
      return createJSONErrorResponseToClient(res, 200, 405, "incorrect-role");

    const eventResults = await performEventsToDisplayQuery(
      client,
      user_id,
      user.role,
    );

    if (eventResults.rowCount > 0)
      return createJSONSuccessResponseToClient(res, 200, {
        events: eventResults.rows,
      });
    else {
      createJSONSuccessResponseToClient(res, 200, {
        message: "No events found for this staff.",
        events: [],
      });
    }
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

// Retrieve an event's details.
router.get("/event/:id", [authenticateCustomJWToken, authenticateFirebaseJWToken], async (req, res) => {
  const client = await pool.connect();

  try {
    const email = req.email;
    const event_id = req.params.id;

    // Retrieve the user id from email for next query.
    let sqlQuery = `SELECT id, role FROM users WHERE email = $1`;
    let query = await client.query(sqlQuery, [email]);
    const user = query.rows[0];
    const user_id = user.id;

    const eventResults = await performSingleEventToModifyQuery(
      client,
      event_id,
      user_id,
    );

    if (eventResults.rowCount > 0)
      return createJSONSuccessResponseToClient(res, 200, {
        event: {
          ...eventResults.rows[0],
        },
      });
    else
      return createJSONErrorResponseToClient(
        res,
        200,
        404,
        "event-not-found",
      );
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

// Create a new Event Endpoint.
router.post("/event", [authenticateCustomJWToken, authenticateFirebaseJWToken], async (req, res) => {
  const client = await pool.connect();

  try {
    const {
      event_venue_id, event_name,
      event_scheduled_start, event_scheduled_end,
      event_promo_image, event_remarks
    } = req.body;

    const email = req.email;

    // Get existing user
    const existingUserSelect = `
      SELECT 
        u.id,
        u.email,
        COALESCE(i.name, o.name) AS name,
        u.country_id,
        u.contact_number
      FROM users u
      LEFT JOIN individuals i ON i.user_id = u.id
      LEFT JOIN organizations o ON o.user_id = u.id
      WHERE email = $1;
    `;
    const existingUserQuery = await client.query(existingUserSelect, [email]);

    // User exists, add event.
    if (existingUserQuery.rows.length > 0) {
      const userResult = existingUserQuery.rows[0];
      // ======================
      // Get Venue Data
      const existingVenueSelect = `
        SELECT 
          address,
          state,
          catalogues
        FROM venues 
        WHERE id = $1;
      `;
      const existingVenueQuery = await client.query(existingVenueSelect, [
        event_venue_id,
      ]);
      const venueResult = existingVenueQuery.rows[0];
      // ======================
      // Get Country Data
      const existingCountrySelect = `
        SELECT 
          id,
          phone_code
        FROM countries 
        WHERE id = $1;
      `;
      const existingCountryQuery = await client.query(existingCountrySelect, [userResult.country_id]);
      const countryResult = existingCountryQuery.rows[0];
      // ======================
      // Insert into Events Table and return "created_at".
      const newEventSelect = `
      INSERT INTO events (organiser_id, venue_id, name, promo_image, remarks, scheduled_at_start, scheduled_at_end)  
      VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, created_at;
    `;
      const newEventQuery = await client.query(newEventSelect, [
        userResult.id, event_venue_id,
        event_name, event_promo_image, event_remarks,
        event_scheduled_start, event_scheduled_end
      ]);

      const eventResult = newEventQuery.rows[0];
      // ======================
      // Send new data back to client.
      return createJSONSuccessResponseToClient(res, 200, {
        event: {
          event_id: eventResult.id,
          event_name: event_name,
          event_promotional_image: event_promo_image,
          event_start_time: event_scheduled_start,
          event_end_time: event_scheduled_end,
          event_remarks: event_remarks,
          created_at: eventResult.created_at,

          organiser_email: email,
          organiser_name: userResult.name,
          organiser_phone_code: countryResult.phone_code,
          organiser_contact_number: userResult.contact_number,

          staff_email: null,
          staff_first_name: null,
          staff_last_name: null,
          staff_phone_code: null,
          staff_contact_number: null,

          venue_address: venueResult.address,
          venue_state: venueResult.state,
          venue_image_catalogues: venueResult.catalogues,
        },
      });
    }
    // User does not exist
    else
      return createJSONErrorResponseToClient(res, 200, 404, "no-user-found");
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

// Approve an existing Event Endpoint. (Must come from staff/admin)
router.post("/event/approve", [authenticateCustomJWToken, authenticateFirebaseJWToken], async (req, res) => {
  const client = await pool.connect();

  try {
    const { event_id } = req.body;
    const email = req.email;

    // Retrieve the user id from email for next query.
    let sqlQuery = `
      SELECT
        id,
        role 
      FROM users 
      WHERE email = $1
    `;
    let query = await client.query(sqlQuery, [email]);
    
    const user = query.rows[0];
    const user_id = user.id;

    if (user.role === "user")
      return createJSONErrorResponseToClient(res, 200, 405, "incorrect-role");

    // Get existing user
    const selectEventQuery = await client.query(
      "SELECT * from events where id = $1",
      [event_id]
    );
    if (selectEventQuery.rows.length <= 0)
      return createJSONErrorResponseToClient(res, 200, 404, "event-not-found");

    query = await client.query(
      "UPDATE events SET staff_id = $1 WHERE id = $2",
      [user_id, event_id]
    );

    // Send new data back to client.
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

// Modify an Existing Event Endpoint.
router.put("/event", [authenticateCustomJWToken, authenticateFirebaseJWToken], async (req, res) => {
  const client = await pool.connect();

  try {
    const {
      event_id, event_venue_id,
      event_name, event_scheduled_start, event_scheduled_end,
      event_promo_image, event_remarks
    } = req.body;

    const email = req.email;

    // Retrieve the user id from email for next query.
    let sqlQuery = `SELECT id FROM users WHERE email = $1`;
    let query = await client.query(sqlQuery, [email]);
    const user_id = query.rows[0].id;

    sqlQuery = `
    UPDATE events SET 
      venue_id = $1,
      name = $2,
      promo_image = $3,
      remarks = $4,
      scheduled_at_start = $5,
      scheduled_at_end = $6
    WHERE id = $7 AND organiser_id = $8
    RETURNING *;
  `;
    query = await client.query(sqlQuery, [
      event_venue_id, event_name, event_promo_image,
      event_remarks, event_scheduled_start, event_scheduled_end,
      event_id, user_id
    ]);

    if (query.rows.length <= 0)
      return createJSONErrorResponseToClient(res, 200, 404, "no-event-found");

    // Send new data back to client.
    return createJSONSuccessResponseToClient(res, 200, {
      event: {
        event_id: parseInt(event_id)
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

// Delete an Existing Event Endpoint.
router.delete("/event", [authenticateCustomJWToken, authenticateFirebaseJWToken], async (req, res) => {
  const client = await pool.connect();

  try {
    const { event_id } = req.body;
    const email = req.email;

    // Retrieve the user id from email for next query.
    let sqlQuery = `SELECT id FROM users WHERE email = $1`;
    let query = await client.query(sqlQuery, [email]);
    const user_id = query.rows[0].id;

    const selectEventQuery = await client.query(
      "SELECT * FROM events WHERE id = $1 AND organiser_id = $2",
      [event_id, user_id]
    );
    if (selectEventQuery.rows.length <= 0)
      return createJSONErrorResponseToClient(res, 200, 404, "no-event-found");

    const deleteEventQuery = await client.query(
      "DELETE FROM events WHERE id = $1 AND organiser_id = $2;",
      [event_id, user_id]
    );

    // Debug
    //console.log("[On Delete Existing Event] Log 1 - Event ID", event_id);
    //console.log("[On Delete Existing Event] Log 2 - User ID", user_id);
    //console.log("[On Delete Existing Event] Log 3 - Event Query", deleteEventQuery.rowCount);

    // Send new data back to client.
    return createJSONSuccessResponseToClient(res, 200, {
      message: deleteEventQuery.rowCount > 0 ? "Event successfully deleted." : "Event already deleted or does not exist.",
      event: {
        event_id: parseInt(event_id),
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
async function performEventsToDisplayQuery(client, user_id, role) {
  const eventQuery = `
    SELECT
      e.id as event_id,
      e.name as event_name,
      e.promo_image as event_promotional_image,
      e.scheduled_at_start as event_start_time,
      e.scheduled_at_end as event_end_time,
      e.venue_id as event_venue_id,

      uo.email as organiser_email,
      COALESCE(uoi.name, uoo.name) AS organiser_name,
      uoc.phone_code as organiser_phone_code,
      uo.contact_number as organiser_contact_number,

      us.email as staff_email,
      usi.name as staff_name,
      usc.phone_code as staff_phone_code,
      us.contact_number as staff_contact_number,

      v.address as venue_address,
      v.state as venue_state,
      v.catalogues as venue_image_catalogues,

      e.remarks as event_remarks,
      e.created_at
    FROM events e

    LEFT JOIN users uo
      ON e.organiser_id = uo.id

    LEFT JOIN countries uoc
      ON uo.country_id = uoc.id

    LEFT JOIN individuals uoi 
      ON uoi.user_id = uo.id

    LEFT JOIN organizations uoo 
      ON uoo.user_id = uo.id

    LEFT JOIN users us
      ON e.staff_id = us.id

    LEFT JOIN countries usc
      ON us.country_id = usc.id

    LEFT JOIN individuals usi 
      ON usi.user_id = us.id

    LEFT JOIN venues v
      ON e.venue_id = v.id
    ` +
    (role === "user" ? `WHERE e.organiser_id = $1` : `WHERE e.staff_id = $1`) +
    `
      ORDER BY created_at DESC;
    `;
  const events = await client.query(eventQuery, [user_id]);

  // Debug
  //console.log("[On Fetch Events] Events.", events.rows);

  return events;
}

async function performSingleEventToModifyQuery(client, event_id, user_id) {
  const eventQuery = `
    SELECT
      id as event_id,
      name as event_name,
      promo_image as event_promotional_image,
      scheduled_at_start as event_start_time,
      scheduled_at_end as event_end_time,
      venue_id as event_venue_id,
      remarks as event_remarks
    FROM events
    WHERE id= $1 AND organiser_id = $2
    ORDER BY created_at DESC;
  `;
  const events = await client.query(eventQuery, [event_id, user_id]);

  // Debug
  //console.log("[On Fetch Events] Events.", events.rows);

  return events;
}
// =======================================
module.exports = router;

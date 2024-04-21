// =======================================
let express = require("express");
let path = require("path");

const { Pool } = require("pg");
const {
  DATABASE_URL
} = process.env;

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { require: true }
});
const router = express.Router();
// =======================================
// Middlewares.
const {
  isUserAuthorized
} = require("../services/middlewares-server.js");

const {
  createJSONSuccessResponseToClient,
  createJSONErrorResponseToClient
} = require("../services/middlewares-client.js");
// =======================================
// Create a New Event Endpoint.
router.post("/web/api/event", [isUserAuthorized], async (req, res) => {
  const client = await pool.connect();

  try {
    const {
      event_name, organiser_id, staff_id,
      venue_id, event_start_datetime, event_end_datetime,
      promo_image, remarks
    } = req.body;

    // Debug
    //console.log("[Create Event] Body.", req.body);
    
    if (!event_name || !organiser_id || !venue_id || !event_start_datetime || !event_end_datetime || !promo_image)
        return createJSONErrorResponseToClient(res, 200, 404, "incomplete-form-field");
    // =======================
    const start_date = new Date(event_start_datetime);
    const end_date = new Date(event_end_datetime);

    if (end_date.getTime() < start_date.getTime())
        return createJSONErrorResponseToClient(res, 200, 405, "invalid-start-end-date");
    // =======================
    // Check if Staff that's requesting to modify has the appropriate role to perform the operation.
    // E.g.
    // Staff on other staff's events = Not Permitted.
    // Admin on other staff's events = Permitted.
    // Staff on own event = Permitted.
    let sqlQuery = `
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

    // User Requesting the Modifications
    query = await client.query(sqlQuery, [req.session.user.id]);
    let user = query.rows[0];

    if (staff_id !== user.id && user.role_permission_level < 3)
        return createJSONErrorResponseToClient(res, 200, 405, "not-authorized-to-create-event-for-other-staffs");
    // =======================
    sqlQuery = `
      INSERT INTO events (name, organiser_id, staff_id, venue_id, scheduled_at_start, scheduled_at_end, promo_image, remarks)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING id;
    `;
    query = await client.query(sqlQuery, [
      event_name, organiser_id, staff_id, venue_id,
      event_start_datetime, event_end_datetime,
      promo_image, remarks
    ]);

    if (query.rows.length <= 0)
      return createJSONErrorResponseToClient(res, 200, 404, "no-event-found");

    const newEvent = query.rows[0];
    // =======================
    // Send new data back to client.
    return createJSONSuccessResponseToClient(res, 200, {
      event: {
        event_id: parseInt(newEvent.id)
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

// Modify an Existing Event Endpoint.
router.put("/web/api/event", [isUserAuthorized], async (req, res) => {
  const client = await pool.connect();

  try {
    const {
      event_id, event_name, staff_id,
      venue_id, event_start_datetime, event_end_datetime,
      promo_image, remarks
    } = req.body;

    // Debug
    //console.log("[Edit Event Info] Body.", req.body);
    
    if (!event_name || !organiser_id || !venue_id || !event_start_datetime || !event_end_datetime || !promo_image)
        return createJSONErrorResponseToClient(res, 200, 404, "incomplete-form-field");
    // =======================
    let query = await client.query("SELECT id, organiser_id, staff_id from events where id = $1;", [event_id]);
    const event = query.rows[0];
    // =======================
    // Check if Staff that's requesting to modify has the appropriate role to perform the operation.
    // E.g.
    // Staff on other staff's events = Not Permitted.
    // Admin on other staff's events = Permitted.
    // Staff on own event = Permitted.
    let sqlQuery = `
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

    // Staff
    query = await client.query(sqlQuery, [staff_id ? staff_id : event.staff_id]);
    if (query.rows.length <= 0)
        return createJSONErrorResponseToClient(res, 200, 405, "invalid-staff");
    let staff = query.rows[0];

    // User Requesting the Modifications
    query = await client.query(sqlQuery, [req.session.user.id]);
    let user = query.rows[0];

    if (event.staff_id !== user.id && user.role_permission_level <= staff.role_permission_level)
        return createJSONErrorResponseToClient(res, 200, 405, "not-authorized-to-modify-event");
    // =======================
    sqlQuery = `
      UPDATE events SET
        name = COALESCE($1, name),
        staff_id = COALESCE($2, staff_id),
        venue_id = COALESCE($3, venue_id),
        scheduled_at_start = COALESCE($4, scheduled_at_start),
        scheduled_at_end = COALESCE($5, scheduled_at_end),
        promo_image = COALESCE($6, promo_image),
        remarks = COALESCE($7, remarks)
      WHERE id = $8
      RETURNING *;
    `;
    query = await client.query(sqlQuery, [
      event_name, staff_id, venue_id,
      event_start_datetime, event_end_datetime,
      promo_image, remarks,
      event_id
    ]);

    if (query.rows.length <= 0)
      return createJSONErrorResponseToClient(res, 200, 404, "no-event-found");
    // =======================
    // Track Event Table Modification Records

    // Debug
    //console.log("[On Modify Existing Event] Log 1 - Event ID", event_id);

    const insertRecords = `
      INSERT INTO event_modifications_history (event_id, user_id, remark)
      VALUES ($1, $2, 'Modified Event');
    `;
    await client.query(insertRecords, [event_id, req.session.user.id]);
    // ========================
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

// Deletes Existing Event
router.delete("/web/api/event", [isUserAuthorized], async (req, res) => {
  const client = await pool.connect();
  try {
    const { event_id } = req.body;
    // ========================
    // Permissions Check (If allowed to delete event)

    // Get event's assigned staff user's role.
    let sqlQuery = `
      SELECT
        e.id,
        CASE 
            WHEN us.role ILIKE 'Admin' THEN 3
            WHEN us.role ILIKE 'Staff' THEN 2
            WHEN us.role ILIKE 'User' THEN 1
            ELSE 0
        END AS staff_role_permission_level
      FROM events e
      LEFT JOIN users us ON e.staff_id = us.id
      WHERE e.id = $1;
    `;
    let query = await client.query(sqlQuery, [event_id]);
    if (query.rows.length <= 0)
      return createJSONErrorResponseToClient(res, 200, 404, "no-event-found");
    
    const existingEvent = query.rows[0];

    // Get active user's role.
    sqlQuery = `
        SELECT
            id,
            CASE 
                WHEN role ILIKE 'Admin' THEN 3
                WHEN role ILIKE 'Staff' THEN 2
                WHEN role ILIKE 'User' THEN 1
                ELSE 0
            END AS role_permission_level
        FROM users
        WHERE id = $1;
    `;
    query = await client.query(sqlQuery, [req.session.user.id]);

    const activeUser = query.rows[0];
    
    if (existingEvent.staff_id !== req.session.user.id && existingEvent.staff_role_permission_level >= activeUser.role_permission_level)
      return createJSONErrorResponseToClient(res, 200, 404, "not-authorized-to-delete-event");
    // ========================
    // Track Event Table Modification Records
    const deleteEventQuery = await client.query('DELETE FROM events WHERE id = $1;', [event_id]);

    // Debug
    //console.log("[On Delete Existing Event] Log 1 - Event ID", event_id);
    //console.log("[On Delete Existing Event] Log 2 - Delete Query", deleteEventQuery.rowCount);

    if (deleteEventQuery.rowCount > 0) {
      const insertRecords = `
        INSERT INTO event_modifications_history (event_id, user_id, remark)
        VALUES ($1, $2, 'Deleted Event');
      `;
      await client.query(insertRecords, [event_id, req.session.user.id]);
    }
    // ========================
    // Send new data back to client.
    return createJSONSuccessResponseToClient(res, 200, {
      message: deleteEventQuery.rowCount > 0 ? "Event successfully deleted." : "Event already deleted or does not exist.",
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

// Approve an existing Event Endpoint. (Must come from staff/admin)
router.post("/web/api/event/approve", [isUserAuthorized], async (req, res) => {
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
// =======================================
module.exports = router;
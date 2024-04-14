// =======================================
let express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const { Pool } = require('pg');
const { DATABASE_URL, SECRET_KEY } = process.env;

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
} = require('../services/middlewares.js');
// =======================================
// GET all available venues.
router.get('/venues', [authenticateCustomJWToken, authenticateFirebaseJWToken], async (req, res) => {
  const client = await pool.connect();
  
  try {
    const venueQuery = await client.query('SELECT id, address, state, catalogues from venues;');

    return createJSONSuccessResponseToClient(res, 200,{ venues: venueQuery.rows });
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
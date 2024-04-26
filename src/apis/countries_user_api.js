// =======================================
let express = require("express");
let path = require("path");

const { Pool } = require("pg");
const {
  DATABASE_URL,
  SECRET_KEY,
  ACCESS_TOKEN_EXPIRY,
  REFRESH_TOKEN_EXPIRY,
  FORGET_PASSWORD_TOKEN_EXPIRY,
  PASSWORD_HASH_AMOUNT,
  CLIENT_URL
} = process.env;

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { require: true }
});
const router = express.Router();

// Middlewares.
const {
  createJSONSuccessResponseToClient,
  createJSONErrorResponseToClient
} = require("../services/middlewares.js");
// =======================================
// Registration.
router.get("/api/countries", async (req, res) => {
  const client = await pool.connect();

  try {
    // Get List of Countries
    const countryResult = await client.query("SELECT id, name, phone_code FROM countries;");

    // Debug
    //console.log("[Obtaining Country List API] Countries.", countryResult);

    return createJSONSuccessResponseToClient(res, 200, { countries: countryResult.rows });
  }
  catch (error) {
    // Debug
    //console.error("[On Obtaining Country List] Error.", error);
    
    return createJSONErrorResponseToClient(res, 200, 500, "server-error");
  }
  finally {
    client.release();
  }
});
// =======================================
module.exports = router;

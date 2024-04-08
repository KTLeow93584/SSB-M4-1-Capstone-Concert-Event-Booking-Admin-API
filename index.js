// ======================================
let express = require("express");
let path = require("path");
const cors = require("cors");

const result = require("dotenv").config();

const { Pool } = require("pg");
const { DATABASE_URL } = process.env;
// ======================================
let app = express();
app.use(cors());
app.use(express.json());

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: {
    require: true
  }
});
// =======================================
async function getPostgresVersion() {
  const client = await pool.connect();
  try
  {
    const response = await client.query("SELECT version()");

    // Debug
    console.log(response.rows[0]);
  }
  finally {
    client.release();
  }
}

getPostgresVersion();
// =======================================
// Homepage.
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "/index.html"));
});
app.get("/welcome", (req, res) => {
  res.sendFile(path.join(__dirname, "/mail-templates/welcome.ejs"));
});
// =======================================
// Phone Verification - Telesign
const telesignServices = require("./phone_verify_telesign.js");

//telesignServices.verifyPhoneNumberIdentity("60175845732");
//telesignServices.sendOTPSMSToPhoneNumber("60175845732");
// ===============
// Phone Verification - Twilio
//const twilioServices = require("./phone_verify_twilio.js");

//twilioServices.lookUpPhoneNumber("+60175845732");
//twilioServices.verifyPhoneNumber("+600175845732");
// =======================================
// Authentication Endpoints. (Login/Registration/etc.)
const authRoutes = require("./apis/auth_api.js");
app.use("/", authRoutes);

// Profile Endpoints.
const profileRoutes = require("./apis/profile_api.js");
app.use("/", profileRoutes);

// Booking Appointment Endpoints.
const bookingRoutes = require("./apis/booking_api.js");
app.use("/", bookingRoutes);

// Administrative Data Pooling Endpoints.
const adminRoutes = require("./apis/admin_data_poll_api.js");
app.use("/", adminRoutes);

// User Data Polling Endpoints.
const userRoutes = require("./apis/user_data_poll_api.js");
app.use("/", userRoutes);

// Venue Endpoints.
const venueRoutes = require("./apis/venues_api.js");
app.use("/", venueRoutes);
// =======================================
// Error Page. (After all APIs and pages have been exhausted)
app.use((req, res) => {
  res.status(404).sendFile(path.join(__dirname, "/error_page.html"));
});
// =======================================
app.listen(3000, () => {
  console.log("App is listening on port 3000.");
});
// =======================================

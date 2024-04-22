// ======================================
let express = require("express");
let path = require("path");
const cors = require("cors");

const result = require("dotenv").config();

const { Pool } = require("pg");
const {
  DATABASE_URL,
  CACHE_SECRET, CACHE_PRUNE_AFTER_DURATION
} = process.env;
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
// Express Session Setup
const session = require("express-session");

// Express Session with PostgreSQL Cache DB Setup (Neon Tech)
/*
const PGSession = require('connect-pg-simple')(session);

const postgresCacheDBSession = new PGSession({
  // Insert connect-pg-simple options here
  pool: pool,
  tableName: "user_sessions"
});

app.use(session({
  store: postgresCacheDBSession,
  secret: CACHE_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: parseInt(CACHE_TTL_DURATION),
    secure: false
  }
}));
*/

// Express Session with Memory Storage
const MemoryStore = require('memorystore')(session)

app.use(session({
    store: new MemoryStore({
      // Prune expired entries every 5 seconds (5000 milliseconds)
      checkPeriod: CACHE_PRUNE_AFTER_DURATION
    }),
    secret: CACHE_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      // Time to Live for Cookies = Environment Variable (milliseconds)
      // Set after user logs in.
      secure: false
    }
}));

// Custom middleware to update maxAge of session cookie if not expired
app.use((req, res, next) => {
    if (req.session && req.session.cookie && req.session.cookie.expires) {
      // Debug
      //console.log("Cookie.", req.session.cookie);
      //console.log("Cookie Expires.", req.session.cookie.expires);

        // Calculate time remaining until cookie expiration
        const remainingTime = req.session.cookie.expires.getTime() - Date.now();
        if (remainingTime > 0) {
            // Update maxAge to remaining time
            req.session.cookie.maxAge = remainingTime;
        }
    }
    next();
});

// For Caching to prevent data loss after server down:
//https://www.npmjs.com/package/memory-cache-node
// ======================================
var bodyParser = require('body-parser');
app.use(bodyParser.urlencoded({ extended: true }));
// =======================================
// Sets the view engine to ejs
app.set("view engine", 'ejs');
app.set("views", path.join(__dirname, "/views"));
// =======================================
// Expose Static Asset Definitions Folder (%PROJECT_BASE_PATH%/public)
app.use(express.static(path.join(__dirname, "/../public")));
// ======================================
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
// Phone Verification - Telesign
const telesignServices = require("./services/phone_verify_telesign.js");

//telesignServices.verifyPhoneNumberIdentity("60175845732");
//telesignServices.sendOTPSMSToPhoneNumber("60175845732");
// =======================================
// APIs (End-Users)

// Authentication Endpoints. (Login/Registration/etc.)
const userAuthAPIRouter = require("./apis/auth_user_api.js");
app.use("/", userAuthAPIRouter);

const { router: adminAuthAPIRouter } = require("./apis/auth_admin_api.js");
app.use("/", adminAuthAPIRouter);

// Account-related Endpoints. (Creation/Modification/Deletion.)
const adminAccountAPIRouter = require("./apis/account_admin_api.js");
app.use("/", adminAccountAPIRouter);

// Profile Endpoints.
const profileAPIRouter = require("./apis/profile_api.js");
app.use("/", profileAPIRouter);

// Event Endpoints.
const userEventAPIRouter = require("./apis/events_user_api.js");
app.use("/", userEventAPIRouter);

const adminEventAPIRouter = require("./apis/events_admin_api.js");
app.use("/", adminEventAPIRouter);

// Venue Endpoints.
const venueAPIRouter = require("./apis/venues_api.js");
app.use("/", venueAPIRouter);
// =======================================
// Admin - Authentication Web Endpoints.
const adminAuthRouter = require("./web-routes/auth.js");
app.use("/", adminAuthRouter);
// =======================================
// Admin - Navigation Web Endpoints.
const adminNavRouter = require("./web-routes/nav.js");
app.use("/", adminNavRouter);
// =======================================
// Admin - User Web Endpoints.
const adminUserRouter = require("./web-routes/users.js");
app.use("/", adminUserRouter);
// =======================================
// Admin - Event Web Endpoints.
const adminEventRouter = require("./web-routes/events.js");
app.use("/", adminEventRouter);
// =======================================
// Documentation Web Endpoints.
const apiDocRouter = require("./web-routes/api_doc.js");
app.use("/", apiDocRouter);
// =======================================
// Error Pages.
app.use("/server-error", (req, res) => {
  res.render(path.join(__dirname, "./views/pages/server_error_page"), {
    user: req.session && req.session.user ? req.session.user : null
  });
});

app.use("/unauthorized", (req, res) => {
  res.render(path.join(__dirname, "./views/pages/unauthorized_page"), {
    user: req.session && req.session.user ? req.session.user : null
  });
});

// Default Error Page. (After all APIs and pages have been exhausted)
app.use((req, res) => {
  res.render(path.join(__dirname, "./views/pages/missing_page"), {
    user: req.session && req.session.user ? req.session.user : null
  });
});
// =======================================
app.listen(3000, () => {
  console.log("App is listening on port 3000.");
});
// =======================================

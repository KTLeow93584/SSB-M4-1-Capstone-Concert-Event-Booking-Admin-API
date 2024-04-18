// ======================================
let express = require("express");
let path = require("path");
const cors = require("cors");

const result = require("dotenv").config();

const { Pool } = require("pg");
const {
  DATABASE_URL,
  CACHE_SECRET, CACHE_TTL_DURATION, CACHE_PRUNE_AFTER_DURATION
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
var bodyParser = require('body-parser');
app.use(bodyParser.urlencoded({ extended: true }));
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
      maxAge: parseInt(CACHE_TTL_DURATION),
      secure: false
    }
}));

// For Caching to prevent data loss after server down:
//https://www.npmjs.com/package/memory-cache-node
// ======================================
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
// APIs (Staffs/Admins/Developers - Back-End Domain)

// Authentication Endpoints. (Login/Registration/etc.)
const { router: adminAuthAPIRouter } = require("./apis/auth_admin_api.js");
const { verifyPasswordRequestToken } = require("./apis/auth_admin_api.js");
app.use("/", adminAuthAPIRouter);

// Data Pooling Endpoints.
const adminPollAPIRouter = require("./apis/admin_data_poll_api.js");
app.use("/", adminPollAPIRouter);
// =================
// APIs (End-Users)

// Authentication Endpoints. (Login/Registration/etc.)
const userAuthAPIRouter = require("./apis/auth_user_api.js");
app.use("/", userAuthAPIRouter);

// Profile Endpoints.
const profileAPIRouter = require("./apis/profile_api.js");
app.use("/", profileAPIRouter);

// Event Endpoints.
const eventAPIRouter = require("./apis/events_api.js");
app.use("/", eventAPIRouter);

// Data Polling Endpoints.
const userPollAPIRouter = require("./apis/user_data_poll_api.js");
app.use("/", userPollAPIRouter);

// Venue Endpoints.
const venueAPIRouter = require("./apis/venues_api.js");
app.use("/", venueAPIRouter);
// =======================================
// Global Middlewares (Used in every API call)
app.use((req, res, next) => {
  req.page_response = {};

  req.page_response = {
    form_data: req.session.formData ?? null,
    info_message: req.session.infoMessage ?? null,
    error_message: req.session.errorMessage ?? null
  }
  
  // Clear the data from session after displaying it.
  delete req.session.infoMessage;
  delete req.session.errorMessage;
  delete req.session.formData;

  next();
});
// =======================================
// Web Pages.
app.get("/", async (req, res) => {
    res.redirect(req.session.user ? "/dashboard" : "/login");
});

app.get("/login", async (req, res) => {
  res.render("./pages/login", { form_api_url: "/web/api/login", ...req.page_response });
});

app.get("/password/forget", async (req, res) => {
  res.render("./pages/password_forget", { form_api_url: "/web/api/password/forget", ...req.page_response });
});

app.get("/password/reset/:token", async (req, res) => {
  const result = await verifyPasswordRequestToken(req, res, req.params["token"]);

  res.render("./pages/password_reset", { form_api_url: `/web/api/password/reset/${req.params["token"]}`, is_valid: result, ...req.page_response });
});

app.get("/logout", async (req, res) => {
  console.log("Log out Process.", req.session.user);
  //res.render("./pages/logout");
});

app.get("/dashboard", async (req, res) => {
  res.render("./pages/dashboard");
});

app.get("/profile", async (req, res) => {
  res.render("./pages/profile");
});

app.get("/api-doc", async (req, res) => {
  res.render("./pages/api_documentations/index");
});

app.get("/api-doc/auth_user", async (req, res) => {
  res.render("pages/api_documentations/authentication_users_api_doc");
});

app.get("/api-doc/events", async (req, res) => {
  res.render("pages/api_documentations/events_api_doc");
});

app.get("/api-doc/profile", async (req, res) => {
  res.render("pages/api_documentations/profile_api_doc");
});

app.get("/api-doc/auth_admin",async (req, res) => {
  res.render("pages/api_documentations/authentication_admins_api_doc");
});

app.get("/api-doc/admin_poll", async (req, res) => {
  res.render("pages/api_documentations/admin_poll_api_doc");
});
// =======================================
// Error Page. (After all APIs and pages have been exhausted)
app.use((req, res) => {
  res.status(404).sendFile(path.join(__dirname, "./views/pages/error_page.html"));
});

app.use("/server-error", (req, res) => {
  res.status(404).sendFile(path.join(__dirname, "./views/pages/error_page.html"));
});
// =======================================
app.listen(3000, () => {
  console.log("App is listening on port 3000.");
});
// =======================================

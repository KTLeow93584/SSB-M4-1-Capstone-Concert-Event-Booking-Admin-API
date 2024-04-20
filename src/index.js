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

const { isUserAuthorized } = require('./services/middlewares-server');

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
// APIs (Staffs/Admins/Developers - Back-End Domain)

// Authentication Endpoints. (Login/Registration/etc.)
const { router: adminAuthAPIRouter } = require("./apis/auth_admin_api.js");
app.use("/", adminAuthAPIRouter);

// Data Pooling Endpoints.
const { router: adminPollAPIRouter } = require("./apis/admin_data_poll_api.js");
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
  delete req.session.formData;
  delete req.session.infoMessage;
  delete req.session.errorMessage;

  next();
});
// =======================================
// Web Pages.
app.get("/", async (req, res) => {
  res.redirect(req.session.user ? "/dashboard" : "/login");
});

app.get("/login", async (req, res) => {
  res.render("./pages/login", {
      form_api_url: "/web/api/login",
      user: req.session && req.session.user ? req.session.user : null,
    ...req.page_response
  });
});

const { verifyPasswordRequestToken, verifyAccountEmail } = require("./apis/auth_admin_api.js");
app.get("/verify/:token", async (req, res) => {
  const result = await verifyAccountEmail(req, res);

  return res.render("./pages/email_verify", {
    is_valid: result.success,
    is_already_verified: result.is_already_verified
  });
});

app.get("/password/forget", async (req, res) => {
  res.render("./pages/password_forget", {
      form_api_url: "/web/api/password/forget",
      user: req.session && req.session.user ? req.session.user : null,
    ...req.page_response
  });
});

app.get("/password/reset/:token", async (req, res) => {
  const result = await verifyPasswordRequestToken(req, res, req.params["token"]);

  res.render("./pages/password_reset", {
    form_api_url: `/web/api/password/reset/${req.params["token"]}`,
    is_valid: result,
    user: req.session && req.session.user ? req.session.user : null,
    ...req.page_response
  });
});

app.get("/dashboard", isUserAuthorized, async (req, res) => {
  res.render("./pages/dashboard", {
    user: req.session.user
  });
});

app.get("/profile", isUserAuthorized, async (req, res) => {
  res.render("./pages/profile", {
    user: req.session.user
  });
});

const { getUsers, getUserInfo, getCountriesInfo } = require("./apis/admin_data_poll_api.js");
app.get("/users", isUserAuthorized, async (req, res) => {
  const result = await getUsers(req, res);

  // Debug
  //console.log("Result.", result);
  
  res.render("./pages/users/index", { ...result });
});

app.get("/user/view/:id", isUserAuthorized, async (req, res) => {
  const result = await getUserInfo(req, res);

  // Debug
  //console.log("Result.", result);
  
  res.render("./pages/users/view", { 
    user: req.session && req.session.user ? req.session.user : null,
    target_user: { ...result.user }
  });
});

app.get("/user/create", isUserAuthorized, async (req, res) => {
  const result = await getCountriesInfo(req, res);

  res.render("./pages/users/create", { 
    user: req.session && req.session.user ? req.session.user : null,
    countries: [ ...result.countries ]
  });
});

app.get("/user/edit/:id", isUserAuthorized, async (req, res) => {
  const result = await getUserInfo(req, res);

  // Must be above target user's permission level, if not SELF.
  if (req.session.user.role_permission_level <= result.user.role_permission_level && 
    req.session.user.id !== result.user.id)
    return res.redirect("/unauthorized");
  
  // Debug
  //console.log("Result.", result);
  
  res.render("./pages/users/edit", { 
    user: req.session && req.session.user ? req.session.user : null,
    target_user: { ...result.user },
    countries: [ ...result.countries ]
  });
});

app.get("/events", isUserAuthorized, async (req, res) => {
  res.render("./pages/events/index", {
    user: req.session && req.session.user ? req.session.user : null
  });
});

app.get("/api_doc", isUserAuthorized, async (req, res) => {
  res.render("./pages/api_documentations/index", {
    user: req.session && req.session.user ? req.session.user : null
  });
});

app.get("/api_doc/auth_user", isUserAuthorized, async (req, res) => {
  res.render("pages/api_documentations/authentication_users_api_doc", {
    user: req.session && req.session.user ? req.session.user : null
  });
});

app.get("/api_doc/events", isUserAuthorized, async (req, res) => {
  res.render("pages/api_documentations/events_api_doc", {
    user: req.session && req.session.user ? req.session.user : null
  });
});

app.get("/api_doc/profile", isUserAuthorized, async (req, res) => {
  res.render("pages/api_documentations/profile_api_doc", {
    user: req.session && req.session.user ? req.session.user : null
  });
});

app.get("/api_doc/auth_admin", isUserAuthorized, async (req, res) => {
  res.render("pages/api_documentations/authentication_admins_api_doc", {
    user: req.session && req.session.user ? req.session.user : null
  });
});

app.get("/api_doc/admin_poll", isUserAuthorized, async (req, res) => {
  res.render("pages/api_documentations/admin_poll_api_doc", {
    user: req.session && req.session.user ? req.session.user : null
  });
});
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

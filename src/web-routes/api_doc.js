// =======================================
let express = require('express');
const router = express.Router();

const {
    isUserAuthorized
} = require('../services/middlewares');
// =======================================
// API Home Page
router.get("/api_doc", isUserAuthorized, async (req, res) => {
  res.render("./pages/api_documentations/index", {
    user: req.session && req.session.user ? req.session.user : null
  });
});
// ===================
// User App APIs
router.get("/api_doc/auth_user", isUserAuthorized, async (req, res) => {
  res.render("pages/api_documentations/users/auth_api_doc", {
    user: req.session && req.session.user ? req.session.user : null
  });
});

router.get("/api_doc/events_user", isUserAuthorized, async (req, res) => {
  res.render("pages/api_documentations/users/events_api_doc", {
    user: req.session && req.session.user ? req.session.user : null
  });
});

router.get("/api_doc/profile", isUserAuthorized, async (req, res) => {
  res.render("pages/api_documentations/users/profile_api_doc", {
    user: req.session && req.session.user ? req.session.user : null
  });
});

router.get("/api_doc/venue", isUserAuthorized, async (req, res) => {
  res.render("pages/api_documentations/users/venue_api_doc", {
    user: req.session && req.session.user ? req.session.user : null
  });
});
// ===================
// Admin Web Routes
router.get("/api_doc/auth_admin", isUserAuthorized, async (req, res) => {
  res.render("pages/api_documentations/admin/auth_api_doc", {
    user: req.session && req.session.user ? req.session.user : null
  });
});

router.get("/api_doc/accounts_admin", isUserAuthorized, async (req, res) => {
  res.render("pages/api_documentations/admin/account_api_doc", {
    user: req.session && req.session.user ? req.session.user : null
  });
});

router.get("/api_doc/events_admin", isUserAuthorized, async (req, res) => {
  res.render("pages/api_documentations/admin/events_api_doc", {
    user: req.session && req.session.user ? req.session.user : null
  });
});
// =======================================
module.exports = router;
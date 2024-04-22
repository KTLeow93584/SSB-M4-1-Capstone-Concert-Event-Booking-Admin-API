
// =======================================
let express = require('express');

const router = express.Router();

const {
    verifyPasswordRequestToken, verifyAccountEmail
} = require("../apis/auth_admin_api.js");
// =======================================
router.get("/", async (req, res) => {
  res.redirect(req.session.user ? "/dashboard" : "/login");
});

router.get("/login", async (req, res) => {
  res.render("./pages/login", {
    user: req.session && req.session.user ? req.session.user : null
  });
});

router.get("/verify/:token", async (req, res) => {
  const result = await verifyAccountEmail(req, res);

  return res.render("./pages/email_verify", {
    is_valid: result.success,
    is_already_verified: result.is_already_verified
  });
});

router.get("/password/forget", async (req, res) => {
  res.render("./pages/password_forget", {
      user: req.session && req.session.user ? req.session.user : null
  });
});

router.get("/password/reset/:token", async (req, res) => {
  const result = await verifyPasswordRequestToken(req, res, req.params["token"]);

  res.render("./pages/password_reset", {
    is_valid: result.success && result.user_id,
    user: req.session && req.session.user ? req.session.user : null,
    token: req.params.token
  });
});
// =======================================
module.exports = router;
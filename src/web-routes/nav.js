
// =======================================
let express = require('express');

const router = express.Router();

const {
    isUserAuthorized
} = require('../services/middlewares');
// =======================================
router.get("/dashboard", isUserAuthorized, async (req, res) => {
  res.render("./pages/dashboard", {
    user: req.session.user
  });
});

router.get("/profile", isUserAuthorized, async (req, res) => {
  res.redirect("/user/view/" + req.session.user.id);
});
// =======================================
module.exports = router;
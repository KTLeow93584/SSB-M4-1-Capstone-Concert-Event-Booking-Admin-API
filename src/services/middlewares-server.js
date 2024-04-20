// =======================================
// Check if user (and role) is authorized to view the  page.
function isUserAuthorized(req, res, next) {
  if (req.session.user)
      return next();
  else
      res.redirect('/login');
}
// =======================================
// Print Informative Message On Web Page after a Successful API Response
function sendInfoToRedirectedPage(req, res, destURL, body = null, message = null) {
  if (req.session) {
    req.session.formData = body;
    req.session.infoMessage = message;
  }

  return res.redirect(destURL);
}

// Print Error On Web Page after a Failed API Response
function sendErrorResponseToRedirectedPage(req, res, body, code, errorObj) {
  if (req.session) {
    req.session.formData = body;
    req.session.errorMessage = errorObj.message;
  }

  return res.redirect(code === 500 ? '/server-error' : 'back');
}
// =======================================
module.exports = {
  isUserAuthorized,
  sendInfoToRedirectedPage,
  sendErrorResponseToRedirectedPage
};
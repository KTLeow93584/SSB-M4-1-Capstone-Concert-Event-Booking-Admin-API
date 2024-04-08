// =======================================
const {
  sendMailToRecipientText,
  sendMailToRecipientHTML,
} = require("../mailing_service.js");

// Email Dummy Tests (Uncomment to test)

// 1. Newly Registered User Mail.
/*
sendMailToRecipientHTML(
  "ror-support-noreply@ror.com",
  "leowkeantat@gmail.com",
  `Welcome to Republic of Rock, Anonymous`,
  { name: "Anonymous" },
  "mail-templates/welcome.ejs"
);
*/

// 2. User self-verified request mail.
/*
sendMailToRecipientHTML(
  "ror-support-noreply@ror.com",
  "leowkeantat@gmail.com",
  `Hello, Anonymous. Please verify your email.`,
  { name: "Anonymous", link: "https://www.google.com" },
  "mail-templates/verify_email.ejs"
);
*/

// 3. Forgot Password request mail.
/*
sendMailToRecipientHTML(
  "ror-support-noreply@ror.com",
  "leowkeantat@gmail.com",
  `Hello, Anonymous. We have received your password reset request (Forgot Password).`,
  { name: "Anonymous", link: "https://www.google.com" },
  "mail-templates/forgot_password.ejs"
);
*/

// 4. Admin verified user mail.
/*
sendMailToRecipientHTML(
  "ror-support-noreply@ror.com",
  "leowkeantat@gmail.com",
  `Hello, Anonymous. The admins have verified your credentials.`,
  { name: "Anonymous", link: "https://www.google.com" },
  "mail-templates/admin_verify_email.ejs"
);
*/
// =======================================

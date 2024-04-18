// =======================================
// Email HTML Template Rule of Thumb Reference:
// https://templates.mailchimp.com/getting-started/html-email-basics/

const { MAILGUN_API_KEY, MAILGUN_DOMAIN } = process.env;

const formData = require("form-data");
const Mailgun = require("mailgun.js");
const mailgun = new Mailgun(formData);

const client = mailgun.client({ username: "api", key: MAILGUN_API_KEY });
// ================
// Send simple text  data
function sendMailToRecipientText(senderEmail, recipientEmail, subject, text) {
  const messageData = {
    from: `Mailgun Sandbox <${senderEmail}>`,
    to: [recipientEmail],
    subject: subject,
    text: text,
  };
  sendMail(messageData);
}
// ================
// Send With HTML Page
const fs = require("fs");
const ejs = require("ejs");

function sendMailToRecipientHTML(senderEmail, recipientEmail, subject, userData, htmlPath) {
  const emailTemplate = fs.readFileSync(htmlPath, "utf8");

  // Render the template with dynamic data
  const renderedEmailHTML = ejs.render(emailTemplate, userData);

  const messageData = {
    from: `Mailgun Sandbox <${senderEmail}>`,
    to: [recipientEmail],
    subject: subject,
    html: renderedEmailHTML
  };

  // Debug
  //console.log("Data.", messageData.html);
  
  sendMail(messageData);
}
// ================
function sendMail(messageData) {
  client.messages
    .create(MAILGUN_DOMAIN, messageData)
    .then((response) => {
      // Debug
      console.log("[Mailgun API] Response:", response);
    })
    .catch((error) => {
      // Debug
      console.error("[Mailgun API] Error:", error);
    });
}
// =======================================
module.exports = {
  sendMailToRecipientText,
  sendMailToRecipientHTML
};
// =======================================

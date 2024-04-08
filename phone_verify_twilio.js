// =======================================
const { TWILIO_ACCOUNT_ID, TWILIO_AUTH_TOKEN, TWILIO_VERIFY_ID } = process.env;

// Download the helper library from https://www.twilio.com/docs/node/install
// Set environment variables for your credentials
// Read more at http://twil.io/secure
const accountSid = TWILIO_ACCOUNT_ID;
const authToken = TWILIO_AUTH_TOKEN;
const verifySid = TWILIO_VERIFY_ID;

const client = require("twilio")(accountSid, authToken);
const readline = require("readline");
// =======================================
// Using Twilio Lookup API v2
// https://www.twilio.com/docs/lookup/v2-api
async function lookUpPhoneNumber(phoneNumber) {
  // Debug
  console.log("[Twilio Lookup] Phone Number: " + phoneNumber);

  const info = await client.lookups.v2.phoneNumbers(phoneNumber).fetch();
  
  // Debug
  console.log(`Retrieved Phone Number Info [${phoneNumber}].`, info);

  return info.valid;
}
// =======================================
// Using Twilio Verify API
async function verifyPhoneNumber(phoneNumber) {
  // Debug
  console.log("[Twilio Verify] Phone Number: " + phoneNumber);

  const service = client.verify.v2.services(verifySid);
  const verification = await service.verifications.create({ to: phoneNumber, channel: "sms" });

  // Debug
  console.log(`Verification Status [${phoneNumber}]:`, verification.status);

  readline.createInterface({ input: process.stdin, output: process.stdout });
  readline.question("Please enter the OTP:", (otpCode) => {
    client.verify.v2
      .services(verifySid)
      .verificationChecks.create({ to: phoneNumber, code: otpCode })
      .then((verification_check) => console.log(verification_check.status))
      .then(() => readline.close());
  });
}
// =======================================
module.exports = {
  verifyPhoneNumber,
  lookUpPhoneNumber
};
// =======================================

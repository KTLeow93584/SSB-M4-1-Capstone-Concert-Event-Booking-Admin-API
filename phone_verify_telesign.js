// =======================================
// Setup
const {
  TELESIGN_CUSTOMER_ID,
  TELESIGN_API_KEY
} = process.env;

// Replace the defaults below with your Telesign authentication credentials or pull them from environment variables.
const customerId = TELESIGN_CUSTOMER_ID;
const apiKey = TELESIGN_API_KEY;
// =======================================
// Phone ID Validation.
// Status: Working.
const TelesignSDK = require('telesignsdk');
function verifyPhoneNumberIdentity(phoneNumber) {
  // Debug
  console.log("[Identifying Phone Number] Number:", phoneNumber);

  // Instantiate a Telesign client object.
  const client = new TelesignSDK(customerId, apiKey);
  
  client.phoneid.phoneID(onVerifyPhoneNumberIdentityCallback, phoneNumber);
}

// Define the callback.
function onVerifyPhoneNumberIdentityCallback(error, responseBody) {
  // Display the response body in the console for debugging purposes.
  // In your production code, you would likely remove this.
  if (!error)
    console.log("\nResponse body:\n" + JSON.stringify(responseBody));
  else
    console.error("An exception occurred. Error:\n\n" + error);
}
// =======================================;
// Phone ID Verification (via OTP SMS).
// Status: Not Working as intended, module not found.
/*
const TelesignEnterpriseSDK = require('telesignenterprisesdk');

function sendOTPSMSToPhoneNumber(phoneNumber) {
  // Instantiate a Telesign client object.
  const client = new TelesignEnterpriseSDK(customerId, apiKey);
  
  // Generate one-time passcode (OTP) and add it to request parameters.
  const verifyCode = Math.floor(Math.random() * 99999).toString();
  const params = { verify_code: verifyCode };

  // Define the callback.
  function smsVerifyCallback(error, responseBody) {
      // Display the response body in the console for debugging purposes. 
      // In your production code, you would likely remove this.
      if (error === null) {
          // Display the response body in the console for debugging purposes. 
          // In your production code, you would likely remove this.
          console.log("\nResponse body:\n" + JSON.stringify(responseBody));
      } else {
          console.error("Unable to send message. " + error);
      }
      // Display prompt to enter asserted OTP in the console.
      // In your production code, you would instead collect the asserted OTP from the end-user.
      showPrompt('\nEnter the verification code you received:\n', verify);
  }

  function showPrompt(question, callback) {
      const stdin = process.stdin, stdout = process.stdout;
      stdin.resume();
      stdout.write(question);
      stdin.once("data", (data) => callback(data.toString().trim()));
  }

  // Determine if the asserted OTP matches your original OTP, and resolve the login attempt accordingly. 
  // You can simulate this by reporting whether the codes match.
  function verify(input) {
    console.log(`\nYour code is ${input === params['verify_code']} ? "correct" : "incorrect"}.`);
    process.exit();
  }
  // =======================================
  // Make the request and capture the response.
  client.verify.sms(smsVerifyCallback, phoneNumber, params);
}
*/
// =======================================
module.exports = {
  //sendOTPSMSToPhoneNumber,
  verifyPhoneNumberIdentity
};
// =======================================

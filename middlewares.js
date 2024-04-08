// =======================================
const jwt = require('jsonwebtoken');

const { Pool } = require('pg');
const {
  DATABASE_URL, SECRET_KEY, ACCESS_TOKEN_EXPIRY,
  FIREBASE_SERVICE_ACCOUNT_TYPE, FIREBASE_SERVICE_ACCOUNT_PROJECT_ID,
  FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY_ID, FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY,
  FIREBASE_SERVICE_ACCOUNT_CLIENT_EMAIL, FIREBASE_SERVICE_ACCOUNT_CLIENT_ID,
  FIREBASE_SERVICE_ACCOUNT_AUTH_URI, FIREBASE_SERVICE_ACCOUNT_TOKEN_URI,
  FIREBASE_SERVICE_ACCOUNT_AUTH_PROVIDER_CERT_URL, FIREBASE_SERVICE_ACCOUNT_CLIENT_CERT_URL,
  FIREBASE_SERVICE_ACCOUNT_UNIVERSE_DOMAIN
} = process.env;

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: {
    require: true
  }
});
// =======================================
// Custom JWToken Middleware
const authenticateCustomJWToken = async function(req, res, next) {
  const authToken = req.headers.authorization ? req.headers.authorization : null;
  const deviceId = req.headers.device ? req.headers.device : null;

  if (!authToken || (authToken && !authToken.includes("Bearer")))
    return res.status(200).json({
      success: false,
      error: {
        status: 401,
        code: 'unauthorized-access'
      }
    });

  // Remove Bearer from string
  let authTokenParsed = authToken.replace(/^Bearer\s+/, "");
  let decodedToken = null;

  try {
    // Verify the token and fetch the user's information.
    decodedToken = jwt.verify(authTokenParsed, SECRET_KEY);

    // Debug
    //console.log("[JWT Auth - Custom] Successfully Verified Access Token, Data.", decodedToken);

    req.email = decodedToken.email;
    return next();
  }
  catch (error) {
    switch (error.message) {
      case "jwt expired":
        let refreshedAccessToken = null;

        // Refresh the access token via the stored "refresh_token" db value.
        if (deviceId)
          refreshedAccessToken = await onRefreshUserJWTAccessToken(deviceId);

        if (refreshedAccessToken) {
          // Verify the token and fetch the user's information.
          decodedToken = jwt.verify(refreshedAccessToken, SECRET_KEY);
          req.email = decodedToken.email;
          res.access_token = refreshedAccessToken;
        }

        if (!refreshedAccessToken)
          return createJSONErrorResponseToClient(res, 200, 401, "unauthorized-access");
        break;
      // Incorrect Algorithm - Move over to Firebase JWToken Authentication.
      case "invalid algorithm":
        break;
      default:
        // Debug
        //console.log("[JWT Auth - Custom] Token Error.", error);
    }
    return next();
  }
}

async function onRefreshUserJWTAccessToken(deviceId) {
  const client = await pool.connect();

  try {
    let accessToken = null;
    const query = await client.query('SELECT refresh_token FROM users WHERE device_id=$1;', [deviceId]);

    if (query.rows.length > 0) {
      const userData = query.rows[0];

      if (userData && userData.refresh_token) {
        // Debug
        //console.log("[JWT Auth - Custom/New Access Token] Stored Refresh Token:", userData.refresh_token);
        // ========
        // Try obtaining the new access token.
        try {
          const decodedToken = jwt.verify(userData.refresh_token, SECRET_KEY);

          // Debug
          //console.log("[JWT Auth - Custom/New Access Token] Successfully Verified Refresh Token, Data.", decodedToken);

          accessToken = jwt.sign({ id: decodedToken.id, email: decodedToken.email }, SECRET_KEY, { expiresIn: parseFloat(ACCESS_TOKEN_EXPIRY) });

          // Debug
          //console.log("[JWT Auth - Custom/New Access Token] Successfully Created New Access Token.", accessToken);
        }
        catch (error) {
          switch (error.message) {
            case "jwt expired":
              await client.query('UPDATE users SET refresh_token=null WHERE device_id=$1;', [deviceId]);

              // Debug
              //console.log("[JWT Auth - Custom/New Access Token] Refresh Token has already expired.");

              break;
            default:
              // Debug
              //console.log("[JWT Auth - Custom JWToken/New Access Token] Token Error.", error);
          }
        }
        // ========
      }
    }

    return accessToken;
  }
  catch (error) {
    // Debug
    console.log(error.stack);

    //return error;
  }
  finally {
    client.release();
  }
}
// =======================================
// Firebase JWToken Middleware
var admin = require("firebase-admin");
const serviceAccountKey = {
  "type": FIREBASE_SERVICE_ACCOUNT_TYPE,
  "project_id": FIREBASE_SERVICE_ACCOUNT_PROJECT_ID,
  "private_key_id": FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY_ID,
  "private_key": FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY.replace(/\\n/g, '\n'),
  "client_email": FIREBASE_SERVICE_ACCOUNT_CLIENT_EMAIL,
  "client_id": FIREBASE_SERVICE_ACCOUNT_CLIENT_ID,
  "auth_uri": FIREBASE_SERVICE_ACCOUNT_AUTH_URI,
  "token_uri": FIREBASE_SERVICE_ACCOUNT_TOKEN_URI,
  "auth_provider_x509_cert_url": FIREBASE_SERVICE_ACCOUNT_AUTH_PROVIDER_CERT_URL,
  "client_x509_cert_url": FIREBASE_SERVICE_ACCOUNT_CLIENT_CERT_URL,
  "universe_domain": FIREBASE_SERVICE_ACCOUNT_UNIVERSE_DOMAIN
};

admin.initializeApp({
  credential: admin.credential.cert(serviceAccountKey)
});

const authenticateFirebaseJWToken = async function(req, res, next) {
  // Already succeeded from custom JWToken Authentication.
  if (req.email)
    return next();
  else {
    const authToken = req.headers.authorization ? req.headers.authorization : null;

    if (!authToken || (authToken && !authToken.includes("Bearer")))
      return createJSONErrorResponseToClient(res, 200, 401, "unauthorized-access");

    const token = authToken.replace(/^Bearer\s+/, "");

    try {
      // Verify the Firebase JWT token
      const decodedToken = await admin.auth().verifyIdToken(token);

      // Valid Token
      //console.log("[JWT Auth Middleware - Firebase JWToken] Decoded token.", decodedToken);

      req.email = decodedToken.email;
      return next();
    }
    catch (error) {
      // Invalid Token
      //console.log("[JWT Auth - Firebase] Token Error.", error);

      // Expired
      if (error.code === 'auth/id-token-expired') {
        // Token is expired, try refreshing
        try {
          const refreshedToken = await admin.auth().refreshAccessToken(authToken);

          // Replace the expired token with the refreshed one
          const decodedToken = await admin.auth().verifyIdToken(refreshedToken);
          req.email = decodedToken.email;

          // Proceed with the request
          return next();
        }
        catch (refreshError) {
          return createJSONErrorResponseToClient(res, 200, 401, "token-refresh-failure");
        }
      }
      // Invalid
      else
        return createJSONErrorResponseToClient(res, 200, 401, "invalid-token");
    }
  }
}
// =======================================
function createJSONSuccessResponseToClient(res, statusCode, clientDataObj = null) {
  return res.status(statusCode).json({
    success: true,
    client_data: clientDataObj,
    access_token: res.access_token
  });
}

function createJSONErrorResponseToClient(res, statusCode, errorStatus, errorCode) {
  return res.status(statusCode).json({
    success: false,
    error: {
      status: errorStatus,
      code: errorCode
    }
  });
}
// =======================================
module.exports = {
  authenticateCustomJWToken, authenticateFirebaseJWToken,
  createJSONSuccessResponseToClient, createJSONErrorResponseToClient
};
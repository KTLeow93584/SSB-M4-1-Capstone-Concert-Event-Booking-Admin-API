// =======================================
const {
  PROJECT_ENV,
  CLIENT_DEVELOPMENT_IP,
  CLIENT_STAGING_IP,
  CLIENT_PRODUCTION_IP
} = process.env;
// =======================================
const getClientURL = () => {
  switch (PROJECT_ENV) {
    case "Development":
      return CLIENT_DEVELOPMENT_IP;
    case "Staging":
      return CLIENT_STAGING_IP;
    case "Production":
      return CLIENT_PRODUCTION_IP;
    default:
    // Return development by default.
  }
  return CLIENT_DEVELOPMENT_IP;
};

const clientURL = getClientURL();
// =======================================
module.exports = {
  clientURL
};
// =======================================

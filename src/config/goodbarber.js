function required(name, value) {
  if (!value) throw new Error(`Missing env var: ${name}`);
  return value;
}

const goodbarberConfig = {
  baseUrl: required('GOODBARBER_BASE_URL', process.env.GOODBARBER_BASE_URL),
  appId: required('GOODBARBER_APP_ID', process.env.GOODBARBER_APP_ID),
  token: required('GOODBARBER_TOKEN', process.env.GOODBARBER_TOKEN),
  tokenHeader: process.env.GOODBARBER_TOKEN_HEADER || 'token',
};

module.exports = { goodbarberConfig };

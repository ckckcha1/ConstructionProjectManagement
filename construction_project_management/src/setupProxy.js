// Create React App loads this file automatically when running `npm start`.
// Forwards /api requests from the React dev server (localhost:3000) to the
// Express backend (localhost:5000), so data.js can use relative /api URLs.
// Used instead of "proxy" in package.json, which crashes the dev server on
// some machines ("options.allowedHosts[0] should be a non-empty string").
const { createProxyMiddleware } = require('http-proxy-middleware');

module.exports = function (app) {
  app.use(
    '/api',
    createProxyMiddleware({
      target: 'http://localhost:5000',
      changeOrigin: true,
    })
  );
};

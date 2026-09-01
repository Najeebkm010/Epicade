const app = require('../server');

// Vercel rewrites may expose the destination path to the function. Restore the
// requested route when a rewrite supplies it explicitly.
module.exports = (req, res) => {
  const route = new URL(req.url, 'http://localhost').searchParams.get('route');
  if (route) req.url = route === 'home' ? '/' : `/${route}`;
  return app(req, res);
};

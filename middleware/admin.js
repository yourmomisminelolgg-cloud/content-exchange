const authMiddleware = require('./auth');
const db = require('../database/db');

module.exports = (req, res, next) => {
  authMiddleware(req, res, () => {
    if (!req.user.isAdmin) return res.status(403).json({ error: 'Admin access required' });
    next();
  });
};

const jwt = require('jsonwebtoken');
const db = require('../database/db');

module.exports = (req, res, next) => {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }
  const token = auth.split(' ')[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    // Check ban status
    const user = db.prepare('SELECT id, is_banned, ban_reason, is_admin FROM users WHERE id = ?').get(decoded.id);
    if (!user) return res.status(401).json({ error: 'User not found' });
    if (user.is_banned && !user.is_admin) return res.status(403).json({ error: 'Account banned', reason: user.ban_reason });
    req.user = decoded;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Invalid token' });
  }
};

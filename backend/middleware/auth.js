const db = require('../database');

const requireAuth = (req, res, next) => {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  if (!user) {
    req.session.destroy();
    return res.status(401).json({ error: 'Session invalid' });
  }
  if (user.is_banned) {
    return res.status(403).json({ error: 'Account banned', reason: user.ban_reason });
  }
  // Update last seen
  db.prepare('UPDATE users SET last_seen = datetime("now") WHERE id = ?').run(user.id);
  req.user = user;
  next();
};

const requireAdmin = (req, res, next) => {
  requireAuth(req, res, () => {
    if (req.user.role !== 'admin' && req.user.role !== 'moderator') {
      return res.status(403).json({ error: 'Admin access required' });
    }
    next();
  });
};

const requireEmailVerified = (req, res, next) => {
  if (!req.user.email_verified) {
    return res.status(403).json({ error: 'Please verify your email first', code: 'EMAIL_NOT_VERIFIED' });
  }
  next();
};

module.exports = { requireAuth, requireAdmin, requireEmailVerified };

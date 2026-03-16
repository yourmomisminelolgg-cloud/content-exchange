const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const db = require('../database');
const { requireAuth, requireAdmin } = require('../middleware/auth');

// Avatar upload
const avatarStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '../uploads/avatars');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    cb(null, `${req.user.id}${path.extname(file.originalname)}`);
  }
});
const uploadAvatar = multer({ storage: avatarStorage, limits: { fileSize: 5 * 1024 * 1024 } });

// GET leaderboard
router.get('/leaderboard', requireAuth, (req, res) => {
  const { type = 'earned' } = req.query;
  let orderBy = 'total_earned';
  if (type === 'watched') orderBy = 'videos_watched';
  if (type === 'submitted') orderBy = 'videos_submitted';

  const users = db.prepare(`
    SELECT id, username, avatar, is_premium, total_earned, videos_watched, videos_submitted,
    (SELECT COUNT(*) FROM vouches WHERE to_user_id = users.id) as vouch_count
    FROM users WHERE is_banned = 0 AND role != 'admin'
    ORDER BY ${orderBy} DESC LIMIT 50
  `).all();

  res.json({ users });
});

// GET public profile
router.get('/profile/:username', requireAuth, (req, res) => {
  const user = db.prepare(`
    SELECT id, username, avatar, bio, is_premium, total_earned, total_spent,
    videos_watched, videos_submitted, created_at, last_seen,
    (SELECT COUNT(*) FROM vouches WHERE to_user_id = users.id) as vouch_count,
    (SELECT AVG(rating) FROM vouches WHERE to_user_id = users.id) as avg_rating
    FROM users WHERE username = ? AND is_banned = 0
  `).get(req.params.username);

  if (!user) return res.status(404).json({ error: 'User not found' });

  const content = db.prepare(`
    SELECT id, url, platform, title, thumbnail, requested_views, views_received, created_at
    FROM content WHERE user_id = ? AND status = 'active' ORDER BY created_at DESC LIMIT 10
  `).all(user.id);

  const vouches = db.prepare(`
    SELECT v.*, u.username as from_username, u.avatar as from_avatar, u.is_premium as from_premium
    FROM vouches v JOIN users u ON v.from_user_id = u.id
    WHERE v.to_user_id = ? ORDER BY v.created_at DESC LIMIT 10
  `).all(user.id);

  const myVouch = db.prepare('SELECT * FROM vouches WHERE from_user_id = ? AND to_user_id = ?').get(req.user.id, user.id);

  res.json({ user, content, vouches, myVouch });
});

// GET my profile
router.get('/me/profile', requireAuth, (req, res) => {
  const stats = db.prepare(`
    SELECT 
    (SELECT COUNT(*) FROM tickets WHERE user_id = ? AND status = 'approved') as approved_tickets,
    (SELECT COUNT(*) FROM tickets WHERE user_id = ? AND status = 'pending') as pending_tickets,
    (SELECT COUNT(*) FROM referrals WHERE referrer_id = ?) as referrals_count
  `).get(req.user.id, req.user.id, req.user.id);

  const transactions = db.prepare('SELECT * FROM transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT 20').all(req.user.id);

  const { password_hash, email_verify_token, reset_token, ...safeUser } = req.user;
  res.json({ user: safeUser, stats, transactions });
});

// UPDATE profile
router.put('/me/profile', requireAuth, uploadAvatar.single('avatar'), (req, res) => {
  const { bio, username } = req.body;
  let updateFields = [];
  let params = [];

  if (bio !== undefined) { updateFields.push('bio = ?'); params.push(bio.slice(0, 300)); }
  if (username && username !== req.user.username) {
    const exists = db.prepare('SELECT id FROM users WHERE LOWER(username) = LOWER(?) AND id != ?').get(username, req.user.id);
    if (exists) return res.status(400).json({ error: 'Username already taken' });
    if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) return res.status(400).json({ error: 'Invalid username format' });
    updateFields.push('username = ?');
    params.push(username);
  }
  if (req.file) {
    updateFields.push('avatar = ?');
    params.push(`/uploads/avatars/${req.file.filename}`);
  }

  if (updateFields.length === 0) return res.json({ success: true });

  params.push(req.user.id);
  db.prepare(`UPDATE users SET ${updateFields.join(', ')} WHERE id = ?`).run(...params);
  res.json({ success: true });
});

// CHANGE PASSWORD
router.put('/me/password', requireAuth, async (req, res) => {
  const { current_password, new_password } = req.body;
  if (!current_password || !new_password) return res.status(400).json({ error: 'Both passwords required' });
  if (new_password.length < 8) return res.status(400).json({ error: 'New password must be 8+ characters' });

  const valid = await bcrypt.compare(current_password, req.user.password_hash);
  if (!valid) return res.status(400).json({ error: 'Current password incorrect' });

  const hash = await bcrypt.hash(new_password, 12);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, req.user.id);
  res.json({ success: true });
});

// VOUCH for user
router.post('/vouch/:userId', requireAuth, (req, res) => {
  const { message, rating } = req.body;
  if (!message || message.length < 10) return res.status(400).json({ error: 'Message must be at least 10 characters' });
  if (req.params.userId === req.user.id) return res.status(400).json({ error: 'Cannot vouch for yourself' });

  const target = db.prepare('SELECT id, username FROM users WHERE id = ?').get(req.params.userId);
  if (!target) return res.status(404).json({ error: 'User not found' });

  const existing = db.prepare('SELECT id FROM vouches WHERE from_user_id = ? AND to_user_id = ?').get(req.user.id, target.id);
  if (existing) return res.status(400).json({ error: 'You already vouched for this user' });

  const r = Math.min(Math.max(parseInt(rating) || 5, 1), 5);
  db.prepare('INSERT INTO vouches (id, from_user_id, to_user_id, message, rating) VALUES (?, ?, ?, ?, ?)').run(
    uuidv4(), req.user.id, target.id, message, r
  );

  db.prepare('INSERT INTO notifications (id, user_id, type, title, message) VALUES (?, ?, ?, ?, ?)').run(
    uuidv4(), target.id, 'vouch', '⭐ New Vouch!', `${req.user.username} vouched for you!`
  );

  res.json({ success: true });
});

// GET notifications
router.get('/notifications', requireAuth, (req, res) => {
  const notifications = db.prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 30').all(req.user.id);
  const unread = db.prepare('SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = 0').get(req.user.id);
  res.json({ notifications, unread: unread.count });
});

// MARK notifications read
router.put('/notifications/read', requireAuth, (req, res) => {
  db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?').run(req.user.id);
  res.json({ success: true });
});

// ADMIN: get all users
router.get('/admin/all', requireAdmin, (req, res) => {
  const { search, page = 1 } = req.query;
  const limit = 20;
  const offset = (page - 1) * limit;

  let query = 'SELECT id, username, email, role, credits, is_premium, is_banned, email_verified, videos_watched, videos_submitted, total_earned, created_at, last_seen FROM users';
  const params = [];
  if (search) { query += ' WHERE username LIKE ? OR email LIKE ?'; params.push(`%${search}%`, `%${search}%`); }
  query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const users = db.prepare(query).all(...params);
  const total = db.prepare('SELECT COUNT(*) as count FROM users').get();
  res.json({ users, total: total.count });
});

// ADMIN: adjust credits
router.post('/admin/:userId/credits', requireAdmin, (req, res) => {
  const { amount, reason } = req.body;
  const amt = parseInt(amount);
  if (isNaN(amt)) return res.status(400).json({ error: 'Invalid amount' });

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });

  db.prepare('UPDATE users SET credits = credits + ? WHERE id = ?').run(amt, user.id);
  db.prepare('INSERT INTO transactions (id, user_id, type, amount, description) VALUES (?, ?, ?, ?, ?)').run(
    uuidv4(), user.id, 'admin_adjustment', amt, reason || `Admin adjustment by ${req.user.username}`
  );
  db.prepare('INSERT INTO notifications (id, user_id, type, title, message) VALUES (?, ?, ?, ?, ?)').run(
    uuidv4(), user.id, 'credit', amt > 0 ? '💰 Credits Added' : '📉 Credits Adjusted',
    `${Math.abs(amt)} credits ${amt > 0 ? 'added to' : 'removed from'} your account by admin.`
  );

  res.json({ success: true });
});

// ADMIN: ban/unban user
router.post('/admin/:userId/ban', requireAdmin, (req, res) => {
  const { reason, unban } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (user.role === 'admin') return res.status(403).json({ error: 'Cannot ban admin' });

  if (unban) {
    db.prepare('UPDATE users SET is_banned = 0, ban_reason = NULL WHERE id = ?').run(user.id);
    res.json({ success: true, message: 'User unbanned' });
  } else {
    db.prepare('UPDATE users SET is_banned = 1, ban_reason = ? WHERE id = ?').run(reason || 'Violation of terms', user.id);
    res.json({ success: true, message: 'User banned' });
  }
});

// ADMIN: promote to moderator
router.post('/admin/:userId/role', requireAdmin, (req, res) => {
  const { role } = req.body;
  if (!['user', 'moderator'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
  db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, req.params.userId);
  res.json({ success: true });
});

// REFERRAL link info
router.get('/referral/stats', requireAuth, (req, res) => {
  const referrals = db.prepare(`
    SELECT r.*, u.username, u.created_at as joined_at
    FROM referrals r JOIN users u ON r.referred_id = u.id
    WHERE r.referrer_id = ? ORDER BY r.created_at DESC
  `).all(req.user.id);
  res.json({ referralLink: `${process.env.APP_URL || 'http://localhost:3000'}/register?ref=${req.user.id}`, referrals });
});

module.exports = router;

const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const db = require('../database/db');
const auth = require('../middleware/auth');

const avatarStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/avatars'),
  filename: (req, file, cb) => cb(null, `${req.user.id}-${Date.now()}${path.extname(file.originalname)}`)
});
const uploadAvatar = multer({
  storage: avatarStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => file.mimetype.startsWith('image/') ? cb(null, true) : cb(new Error('Only images'))
});

// GET /api/users/leaderboard
router.get('/leaderboard', auth, (req, res) => {
  const { period = 'all' } = req.query;
  let dateFilter = '';
  if (period === 'week') dateFilter = "AND t.created_at > datetime('now', '-7 days')";
  if (period === 'month') dateFilter = "AND t.created_at > datetime('now', '-30 days')";

  const leaders = db.prepare(`
    SELECT u.id, u.username, u.avatar, u.is_premium, u.videos_watched, u.reputation, u.streak,
      COALESCE(SUM(CASE WHEN t.status='approved' ${dateFilter} THEN t.credits_awarded ELSE 0 END), 0) as period_earned,
      (SELECT COUNT(*) FROM tickets t2 WHERE t2.user_id = u.id AND t2.status = 'approved') as total_approved
    FROM users u
    LEFT JOIN tickets t ON t.user_id = u.id
    WHERE u.is_admin = 0 AND u.is_banned = 0
    GROUP BY u.id
    ORDER BY period_earned DESC, u.videos_watched DESC
    LIMIT 50
  `).all();
  res.json(leaders);
});

// GET /api/users/:username
router.get('/:username', auth, (req, res) => {
  const user = db.prepare(`
    SELECT id, uuid, username, avatar, bio, location, website, twitter, youtube,
    credits, total_earned, total_spent, videos_watched, videos_submitted,
    is_premium, reputation, streak, longest_streak, role, created_at,
    (SELECT COUNT(*) FROM vouches v WHERE v.to_user_id = id) as vouch_count,
    (SELECT AVG(rating) FROM vouches v WHERE v.to_user_id = id) as avg_rating
    FROM users WHERE username = ? AND is_banned = 0
  `).get(req.params.username);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const vouches = db.prepare(`
    SELECT v.*, u.avatar as from_avatar FROM vouches v
    JOIN users u ON v.from_user_id = u.id
    WHERE v.to_user_id = ? ORDER BY v.created_at DESC LIMIT 10
  `).all(user.id);

  const content = db.prepare(`
    SELECT id, uuid, title, url, platform, thumbnail, current_views, requested_views, status, created_at
    FROM content WHERE user_id = ? AND status != 'deleted' ORDER BY created_at DESC LIMIT 10
  `).all(user.id);

  res.json({ ...user, vouches, content });
});

// POST /api/users/vouch/:username
router.post('/vouch/:username', auth, (req, res) => {
  const target = db.prepare('SELECT id, username FROM users WHERE username = ?').get(req.params.username);
  if (!target) return res.status(404).json({ error: 'User not found' });
  if (target.id === req.user.id) return res.status(400).json({ error: 'Cannot vouch for yourself' });

  const { message, rating } = req.body;
  const r = Math.max(1, Math.min(5, parseInt(rating) || 5));

  try {
    db.prepare('INSERT INTO vouches (from_user_id, from_username, to_user_id, to_username, message, rating) VALUES (?,?,?,?,?,?)').run(
      req.user.id, req.user.username, target.id, target.username, message || '', r
    );
    db.prepare('UPDATE users SET reputation = reputation + 1 WHERE id = ?').run(target.id);
    db.prepare('INSERT INTO notifications (user_id, type, title, message) VALUES (?,?,?,?)').run(
      target.id, 'vouch', '⭐ New Vouch!', `${req.user.username} vouched for you with ${r}/5 stars!`
    );
    res.json({ success: true });
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(400).json({ error: 'Already vouched for this user' });
    throw e;
  }
});

// GET /api/users/notifications/all
router.get('/notifications/all', auth, (req, res) => {
  const notifs = db.prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50').all(req.user.id);
  res.json(notifs);
});

// POST /api/users/notifications/read
router.post('/notifications/read', auth, (req, res) => {
  db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?').run(req.user.id);
  res.json({ success: true });
});

// GET /api/users/notifications/unread-count
router.get('/notifications/unread-count', auth, (req, res) => {
  const count = db.prepare('SELECT COUNT(*) as c FROM notifications WHERE user_id = ? AND is_read = 0').get(req.user.id);
  res.json({ count: count.c });
});

// PATCH /api/users/profile - update profile
router.patch('/profile', auth, (req, res) => {
  const { bio, location, website, twitter, youtube } = req.body;
  db.prepare('UPDATE users SET bio=?, location=?, website=?, twitter=?, youtube=? WHERE id=?').run(
    bio || '', location || '', website || '', twitter || '', youtube || '', req.user.id
  );
  res.json({ success: true });
});

// POST /api/users/avatar
router.post('/avatar', auth, uploadAvatar.single('avatar'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  db.prepare('UPDATE users SET avatar = ? WHERE id = ?').run(req.file.filename, req.user.id);
  res.json({ success: true, avatar: req.file.filename });
});

// PATCH /api/users/password
router.patch('/password', auth, async (req, res) => {
  const bcrypt = require('bcryptjs');
  const { currentPassword, newPassword } = req.body;
  if (!newPassword || newPassword.length < 8) return res.status(400).json({ error: 'New password must be 8+ chars' });
  const user = db.prepare('SELECT password FROM users WHERE id = ?').get(req.user.id);
  const valid = await bcrypt.compare(currentPassword, user.password);
  if (!valid) return res.status(400).json({ error: 'Current password incorrect' });
  const hashed = await bcrypt.hash(newPassword, 12);
  db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hashed, req.user.id);
  res.json({ success: true });
});

// GET /api/users/announcements/all
router.get('/announcements/all', auth, (req, res) => {
  const announcements = db.prepare('SELECT * FROM announcements ORDER BY is_pinned DESC, created_at DESC LIMIT 20').all();
  res.json(announcements);
});

module.exports = router;

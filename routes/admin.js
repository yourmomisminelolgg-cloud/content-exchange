const express = require('express');
const router = express.Router();
const db = require('../database/db');
const adminAuth = require('../middleware/admin');

// GET /api/admin/stats
router.get('/stats', adminAuth, (req, res) => {
  const stats = {
    totalUsers: db.prepare('SELECT COUNT(*) as c FROM users WHERE is_admin = 0').get().c,
    verifiedUsers: db.prepare('SELECT COUNT(*) as c FROM users WHERE is_verified = 1 AND is_admin = 0').get().c,
    totalContent: db.prepare("SELECT COUNT(*) as c FROM content WHERE status != 'deleted'").get().c,
    activeContent: db.prepare("SELECT COUNT(*) as c FROM content WHERE status = 'active'").get().c,
    pendingTickets: db.prepare("SELECT COUNT(*) as c FROM tickets WHERE status = 'pending'").get().c,
    approvedTickets: db.prepare("SELECT COUNT(*) as c FROM tickets WHERE status = 'approved'").get().c,
    totalCreditsDistributed: db.prepare("SELECT COALESCE(SUM(credits_awarded),0) as s FROM tickets WHERE status='approved'").get().s,
    openSupportTickets: db.prepare("SELECT COUNT(*) as c FROM support_tickets WHERE status = 'open'").get().c,
    pendingReports: db.prepare("SELECT COUNT(*) as c FROM reports WHERE status = 'pending'").get().c,
    newUsersToday: db.prepare("SELECT COUNT(*) as c FROM users WHERE date(created_at) = date('now')").get().c,
    revenueTotal: db.prepare("SELECT COALESCE(SUM(amount_usd),0) as s FROM paypal_orders WHERE status='completed'").get().s
  };
  res.json(stats);
});

// GET /api/admin/users
router.get('/users', adminAuth, (req, res) => {
  const { search, page = 1, limit = 20 } = req.query;
  const offset = (page - 1) * limit;
  let where = 'WHERE 1=1';
  const params = [];
  if (search) {
    where += ' AND (username LIKE ? OR email LIKE ?)';
    params.push(`%${search}%`, `%${search}%`);
  }
  const users = db.prepare(`
    SELECT id, uuid, username, email, credits, is_premium, is_admin, is_banned, is_verified,
    videos_watched, videos_submitted, reputation, created_at, last_seen, role
    FROM users ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?
  `).all(...params, limit, offset);
  const total = db.prepare(`SELECT COUNT(*) as c FROM users ${where}`).get(...params);
  res.json({ users, total: total.c });
});

// POST /api/admin/users/:id/credits - adjust credits
router.post('/users/:id/credits', adminAuth, (req, res) => {
  const { amount, reason } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const adj = parseInt(amount);
  db.prepare('UPDATE users SET credits = MAX(0, credits + ?) WHERE id = ?').run(adj, user.id);
  const updated = db.prepare('SELECT credits FROM users WHERE id = ?').get(user.id);
  db.prepare('INSERT INTO transactions (user_id, type, amount, description, balance_after) VALUES (?,?,?,?,?)').run(
    user.id, 'admin_adjustment', adj, `Admin: ${reason || 'Manual adjustment'}`, updated.credits
  );
  db.prepare('INSERT INTO notifications (user_id, type, title, message) VALUES (?,?,?,?)').run(
    user.id, 'admin', adj > 0 ? '🎁 Credits Added' : '⚠️ Credits Adjusted',
    `Admin ${adj > 0 ? 'added' : 'removed'} ${Math.abs(adj)} credits. ${reason ? 'Reason: ' + reason : ''}`
  );
  res.json({ success: true, newBalance: updated.credits });
});

// POST /api/admin/users/:id/ban
router.post('/users/:id/ban', adminAuth, (req, res) => {
  const { reason } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'Not found' });
  if (user.is_admin) return res.status(400).json({ error: 'Cannot ban admin' });
  db.prepare('UPDATE users SET is_banned = 1, ban_reason = ? WHERE id = ?').run(reason || 'Violation of terms', user.id);
  res.json({ success: true });
});

// POST /api/admin/users/:id/unban
router.post('/users/:id/unban', adminAuth, (req, res) => {
  db.prepare('UPDATE users SET is_banned = 0, ban_reason = NULL WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// POST /api/admin/users/:id/make-premium
router.post('/users/:id/make-premium', adminAuth, (req, res) => {
  const days = parseInt(req.body.days) || 30;
  const expires = new Date(Date.now() + days * 86400000).toISOString();
  db.prepare('UPDATE users SET is_premium = 1, premium_expires = ? WHERE id = ?').run(expires, req.params.id);
  db.prepare('INSERT INTO notifications (user_id, type, title, message) VALUES (?,?,?,?)').run(
    req.params.id, 'premium', '⭐ Premium Activated!', `Your premium has been activated for ${days} days!`
  );
  res.json({ success: true });
});

// GET /api/admin/content
router.get('/content', adminAuth, (req, res) => {
  const { status, page = 1, limit = 20 } = req.query;
  const offset = (page - 1) * limit;
  let where = "WHERE c.status != 'deleted'";
  const params = [];
  if (status) { where += ' AND c.status = ?'; params.push(status); }
  const items = db.prepare(`
    SELECT c.*, u.email as user_email FROM content c JOIN users u ON c.user_id = u.id
    ${where} ORDER BY c.created_at DESC LIMIT ? OFFSET ?
  `).all(...params, limit, offset);
  const total = db.prepare(`SELECT COUNT(*) as c FROM content c ${where}`).get(...params);
  res.json({ items, total: total.c });
});

// POST /api/admin/content/:id/feature
router.post('/content/:id/feature', adminAuth, (req, res) => {
  db.prepare('UPDATE content SET is_featured = 1 WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// DELETE /api/admin/content/:id
router.delete('/content/:id', adminAuth, (req, res) => {
  db.prepare("UPDATE content SET status = 'deleted' WHERE id = ?").run(req.params.id);
  res.json({ success: true });
});

// POST /api/admin/announcements
router.post('/announcements', adminAuth, (req, res) => {
  const { title, content, type, isPinned } = req.body;
  if (!title || !content) return res.status(400).json({ error: 'Title and content required' });
  const r = db.prepare('INSERT INTO announcements (title, content, type, author_id, author_username, is_pinned) VALUES (?,?,?,?,?,?)').run(
    title, content, type || 'info', req.user.id, req.user.username, isPinned ? 1 : 0
  );
  res.json({ success: true, id: r.lastInsertRowid });
});

// DELETE /api/admin/announcements/:id
router.delete('/announcements/:id', adminAuth, (req, res) => {
  db.prepare('DELETE FROM announcements WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// GET /api/admin/reports
router.get('/reports', adminAuth, (req, res) => {
  const reports = db.prepare(`
    SELECT r.*, u.username as reporter_username, c.url as content_url, ru.username as reported_username
    FROM reports r
    LEFT JOIN users u ON r.reporter_id = u.id
    LEFT JOIN content c ON r.content_id = c.id
    LEFT JOIN users ru ON r.reported_user_id = ru.id
    WHERE r.status = 'pending' ORDER BY r.created_at DESC LIMIT 50
  `).all();
  res.json(reports);
});

// POST /api/admin/reports/:id/resolve
router.post('/reports/:id/resolve', adminAuth, (req, res) => {
  db.prepare("UPDATE reports SET status = 'resolved', resolved_by = ? WHERE id = ?").run(req.user.id, req.params.id);
  res.json({ success: true });
});

// DELETE /api/admin/chat/:id - delete chat message
router.delete('/chat/:id', adminAuth, (req, res) => {
  db.prepare('UPDATE chat_messages SET is_deleted = 1 WHERE id = ?').run(req.params.id);
  const io = req.app.get('io');
  if (io) io.emit('message_deleted', { id: parseInt(req.params.id) });
  res.json({ success: true });
});

// GET /api/admin/support
router.get('/support', adminAuth, (req, res) => {
  const tickets = db.prepare(`
    SELECT st.*, (SELECT COUNT(*) FROM support_messages sm WHERE sm.ticket_id = st.id) as message_count
    FROM support_tickets st ORDER BY st.updated_at DESC LIMIT 50
  `).all();
  res.json(tickets);
});

// POST /api/admin/support/:id/close
router.post('/support/:id/close', adminAuth, (req, res) => {
  db.prepare("UPDATE support_tickets SET status = 'closed', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(req.params.id);
  res.json({ success: true });
});

module.exports = router;

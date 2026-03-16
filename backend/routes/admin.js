const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../database');
const { requireAuth, requireAdmin } = require('../middleware/auth');

// ANNOUNCEMENTS
router.get('/announcements', requireAuth, (req, res) => {
  const items = db.prepare(`
    SELECT a.*, u.username as admin_username
    FROM announcements a JOIN users u ON a.admin_id = u.id
    ORDER BY a.pinned DESC, a.created_at DESC LIMIT 20
  `).all();
  res.json({ items });
});

router.post('/announcements', requireAdmin, (req, res) => {
  const { title, content, type = 'info', pinned = false } = req.body;
  if (!title || !content) return res.status(400).json({ error: 'Title and content required' });

  const id = uuidv4();
  db.prepare('INSERT INTO announcements (id, admin_id, title, content, type, pinned) VALUES (?, ?, ?, ?, ?, ?)').run(
    id, req.user.id, title, content, type, pinned ? 1 : 0
  );
  res.json({ success: true, id });
});

router.delete('/announcements/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM announcements WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// ADMIN STATS DASHBOARD
router.get('/admin/stats', requireAdmin, (req, res) => {
  const stats = {
    users: db.prepare('SELECT COUNT(*) as c FROM users').get().c,
    active_content: db.prepare("SELECT COUNT(*) as c FROM content WHERE status = 'active'").get().c,
    pending_tickets: db.prepare("SELECT COUNT(*) as c FROM tickets WHERE status = 'pending'").get().c,
    total_tickets: db.prepare('SELECT COUNT(*) as c FROM tickets').get().c,
    approved_today: db.prepare("SELECT COUNT(*) as c FROM tickets WHERE status = 'approved' AND DATE(reviewed_at) = DATE('now')").get().c,
    credits_distributed: db.prepare("SELECT SUM(amount) as s FROM transactions WHERE type = 'watch_reward'").get().s || 0,
    credits_purchased: db.prepare("SELECT SUM(credits) as s FROM credit_purchases WHERE status = 'completed'").get().s || 0,
    revenue: db.prepare("SELECT SUM(amount_usd) as s FROM credit_purchases WHERE status = 'completed'").get().s || 0,
    open_support: db.prepare("SELECT COUNT(*) as c FROM support_tickets WHERE status = 'open'").get().c,
    pending_reports: db.prepare("SELECT COUNT(*) as c FROM user_reports WHERE status = 'pending'").get().c,
    new_users_today: db.prepare("SELECT COUNT(*) as c FROM users WHERE DATE(created_at) = DATE('now')").get().c,
    messages_today: db.prepare("SELECT COUNT(*) as c FROM chat_messages WHERE DATE(created_at) = DATE('now')").get().c,
  };
  res.json({ stats });
});

// ADMIN: content management
router.get('/admin/content', requireAdmin, (req, res) => {
  const { status = 'active', page = 1 } = req.query;
  const limit = 20;
  const offset = (page - 1) * limit;

  const items = db.prepare(`
    SELECT c.*, u.username, u.email FROM content c
    JOIN users u ON c.user_id = u.id
    WHERE c.status = ? ORDER BY c.created_at DESC LIMIT ? OFFSET ?
  `).all(status, limit, offset);
  const total = db.prepare('SELECT COUNT(*) as count FROM content WHERE status = ?').get(status);
  res.json({ items, total: total.count });
});

router.post('/admin/content/:id/status', requireAdmin, (req, res) => {
  const { status } = req.body;
  if (!['active', 'paused', 'removed'].includes(status)) return res.status(400).json({ error: 'Invalid status' });
  db.prepare('UPDATE content SET status = ? WHERE id = ?').run(status, req.params.id);
  res.json({ success: true });
});

// ADMIN: user reports
router.get('/admin/reports', requireAdmin, (req, res) => {
  const reports = db.prepare(`
    SELECT r.*, 
    u1.username as reporter_name,
    u2.username as reported_name, u2.email as reported_email
    FROM user_reports r
    JOIN users u1 ON r.reporter_id = u1.id
    JOIN users u2 ON r.reported_id = u2.id
    WHERE r.status = 'pending' ORDER BY r.created_at DESC
  `).all();
  res.json({ reports });
});

router.post('/admin/reports/:id/resolve', requireAdmin, (req, res) => {
  db.prepare('UPDATE user_reports SET status = ? WHERE id = ?').run(req.body.status || 'resolved', req.params.id);
  res.json({ success: true });
});

// REPORT user
router.post('/report/:userId', requireAuth, (req, res) => {
  const { reason, details } = req.body;
  if (!reason) return res.status(400).json({ error: 'Reason required' });
  if (req.params.userId === req.user.id) return res.status(400).json({ error: 'Cannot report yourself' });

  db.prepare('INSERT INTO user_reports (id, reporter_id, reported_id, reason, details) VALUES (?, ?, ?, ?, ?)').run(
    uuidv4(), req.user.id, req.params.userId, reason, details || ''
  );
  res.json({ success: true });
});

// SUPPORT TICKETS
router.post('/support/new', requireAuth, (req, res) => {
  const { subject, message, category, priority } = req.body;
  if (!subject || !message) return res.status(400).json({ error: 'Subject and message required' });

  const ticketId = uuidv4();
  db.prepare('INSERT INTO support_tickets (id, user_id, subject, category, priority) VALUES (?, ?, ?, ?, ?)').run(
    ticketId, req.user.id, subject, category || 'general', priority || 'normal'
  );
  db.prepare('INSERT INTO support_messages (id, ticket_id, sender_id, message) VALUES (?, ?, ?, ?)').run(
    uuidv4(), ticketId, req.user.id, message
  );
  res.json({ success: true, ticketId });
});

router.get('/support/my', requireAuth, (req, res) => {
  const tickets = db.prepare(`
    SELECT t.*, 
    (SELECT COUNT(*) FROM support_messages WHERE ticket_id = t.id) as message_count,
    (SELECT message FROM support_messages WHERE ticket_id = t.id ORDER BY created_at DESC LIMIT 1) as last_message
    FROM support_tickets t WHERE t.user_id = ? ORDER BY t.updated_at DESC
  `).all(req.user.id);
  res.json({ tickets });
});

router.get('/support/:ticketId', requireAuth, (req, res) => {
  const ticket = db.prepare('SELECT * FROM support_tickets WHERE id = ?').get(req.params.ticketId);
  if (!ticket) return res.status(404).json({ error: 'Not found' });
  if (ticket.user_id !== req.user.id && req.user.role !== 'admin' && req.user.role !== 'moderator') {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const messages = db.prepare(`
    SELECT sm.*, u.username, u.avatar, u.role FROM support_messages sm
    JOIN users u ON sm.sender_id = u.id
    WHERE sm.ticket_id = ? ORDER BY sm.created_at ASC
  `).all(req.params.ticketId);

  res.json({ ticket, messages });
});

router.post('/support/:ticketId/reply', requireAuth, (req, res) => {
  const { message } = req.body;
  if (!message) return res.status(400).json({ error: 'Message required' });

  const ticket = db.prepare('SELECT * FROM support_tickets WHERE id = ?').get(req.params.ticketId);
  if (!ticket) return res.status(404).json({ error: 'Not found' });
  const isStaff = req.user.role === 'admin' || req.user.role === 'moderator';
  if (ticket.user_id !== req.user.id && !isStaff) return res.status(403).json({ error: 'Forbidden' });
  if (ticket.status === 'closed' && !isStaff) return res.status(400).json({ error: 'Ticket is closed' });

  db.prepare('INSERT INTO support_messages (id, ticket_id, sender_id, message, is_staff) VALUES (?, ?, ?, ?, ?)').run(
    uuidv4(), ticket.id, req.user.id, message, isStaff ? 1 : 0
  );
  db.prepare("UPDATE support_tickets SET status = 'open', updated_at = datetime('now') WHERE id = ?").run(ticket.id);

  if (isStaff) {
    db.prepare('INSERT INTO notifications (id, user_id, type, title, message, link) VALUES (?, ?, ?, ?, ?, ?)').run(
      uuidv4(), ticket.user_id, 'support', '💬 Support Reply', `Staff replied to your ticket: ${ticket.subject}`, `/support/${ticket.id}`
    );
  }

  res.json({ success: true });
});

router.post('/support/:ticketId/close', requireAuth, (req, res) => {
  const ticket = db.prepare('SELECT * FROM support_tickets WHERE id = ?').get(req.params.ticketId);
  if (!ticket) return res.status(404).json({ error: 'Not found' });
  const isStaff = req.user.role === 'admin' || req.user.role === 'moderator';
  if (ticket.user_id !== req.user.id && !isStaff) return res.status(403).json({ error: 'Forbidden' });

  db.prepare("UPDATE support_tickets SET status = 'closed', updated_at = datetime('now') WHERE id = ?").run(ticket.id);
  res.json({ success: true });
});

// ADMIN: support queue
router.get('/admin/support', requireAdmin, (req, res) => {
  const { status = 'open' } = req.query;
  const tickets = db.prepare(`
    SELECT t.*, u.username, u.email,
    (SELECT COUNT(*) FROM support_messages WHERE ticket_id = t.id) as message_count
    FROM support_tickets t JOIN users u ON t.user_id = u.id
    WHERE t.status = ? ORDER BY 
    CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
    t.created_at ASC
  `).all(status);
  res.json({ tickets });
});

module.exports = router;

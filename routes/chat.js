const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../database/db');
const auth = require('../middleware/auth');
const adminAuth = require('../middleware/admin');

// GET /api/chat/history/:room
router.get('/history/:room', auth, (req, res) => {
  const { room } = req.params;
  const messages = db.prepare(`
    SELECT * FROM chat_messages WHERE room = ? AND is_deleted = 0
    ORDER BY created_at DESC LIMIT 50
  `).all(room);
  res.json(messages.reverse());
});

// GET /api/chat/rooms
router.get('/rooms', auth, (req, res) => {
  res.json([
    { id: 'general', name: 'General', icon: '💬', description: 'Main community chat' },
    { id: 'creators', name: 'Creators', icon: '🎬', description: 'Creator-only discussions' },
    { id: 'promotions', name: 'Promotions', icon: '📣', description: 'Share your content' },
    { id: 'help', name: 'Help & Tips', icon: '💡', description: 'Get help from the community' }
  ]);
});

// DELETE /api/chat/:id (admin only)
router.delete('/:id', adminAuth, (req, res) => {
  db.prepare('UPDATE chat_messages SET is_deleted = 1 WHERE id = ?').run(req.params.id);
  const io = req.app.get('io');
  if (io) io.emit('message_deleted', { id: parseInt(req.params.id) });
  res.json({ success: true });
});

// Support Tickets
// GET /api/chat/support - get user's support tickets
router.get('/support/tickets', auth, (req, res) => {
  const tickets = db.prepare(`
    SELECT st.*, (SELECT COUNT(*) FROM support_messages sm WHERE sm.ticket_id = st.id) as message_count,
    (SELECT sm.message FROM support_messages sm WHERE sm.ticket_id = st.id ORDER BY sm.created_at DESC LIMIT 1) as last_message
    FROM support_tickets st WHERE st.user_id = ? ORDER BY st.updated_at DESC
  `).all(req.user.id);
  res.json(tickets);
});

// POST /api/chat/support - create support ticket
router.post('/support', auth, (req, res) => {
  const { subject, category, message } = req.body;
  if (!subject || !message) return res.status(400).json({ error: 'Subject and message required' });

  const uuid = uuidv4();
  const r = db.prepare('INSERT INTO support_tickets (uuid, user_id, username, subject, category) VALUES (?,?,?,?,?)').run(
    uuid, req.user.id, req.user.username, subject, category || 'general'
  );
  db.prepare('INSERT INTO support_messages (ticket_id, user_id, username, message, is_admin) VALUES (?,?,?,?,?)').run(
    r.lastInsertRowid, req.user.id, req.user.username, message, 0
  );

  // Notify admins
  const admins = db.prepare('SELECT id FROM users WHERE is_admin = 1').all();
  admins.forEach(a => {
    db.prepare('INSERT INTO notifications (user_id, type, title, message) VALUES (?,?,?,?)').run(
      a.id, 'support', '🎫 New Support Ticket', `${req.user.username}: ${subject}`
    );
  });

  res.json({ success: true, uuid, id: r.lastInsertRowid });
});

// GET /api/chat/support/:uuid - get ticket messages
router.get('/support/:uuid', auth, (req, res) => {
  const ticket = db.prepare('SELECT * FROM support_tickets WHERE uuid = ? AND (user_id = ? OR 1 = ?)').get(
    req.params.uuid, req.user.id, req.user.isAdmin ? 1 : 0
  );
  if (!ticket) return res.status(404).json({ error: 'Ticket not found' });
  const messages = db.prepare('SELECT * FROM support_messages WHERE ticket_id = ? ORDER BY created_at ASC').all(ticket.id);
  res.json({ ticket, messages });
});

// POST /api/chat/support/:uuid/message - reply to ticket
router.post('/support/:uuid/message', auth, (req, res) => {
  const { message } = req.body;
  if (!message) return res.status(400).json({ error: 'Message required' });

  const ticket = db.prepare('SELECT * FROM support_tickets WHERE uuid = ?').get(req.params.uuid);
  if (!ticket) return res.status(404).json({ error: 'Not found' });
  if (ticket.user_id !== req.user.id && !req.user.isAdmin) return res.status(403).json({ error: 'Forbidden' });

  const isAdmin = req.user.isAdmin ? 1 : 0;
  db.prepare('INSERT INTO support_messages (ticket_id, user_id, username, message, is_admin) VALUES (?,?,?,?,?)').run(
    ticket.id, req.user.id, req.user.username, message, isAdmin
  );
  db.prepare("UPDATE support_tickets SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(
    isAdmin ? 'replied' : 'open', ticket.id
  );

  // Notify other party
  const notifyId = isAdmin ? ticket.user_id : null;
  if (notifyId) {
    db.prepare('INSERT INTO notifications (user_id, type, title, message) VALUES (?,?,?,?)').run(
      notifyId, 'support_reply', '💬 Support Reply', `Admin replied to your ticket: ${ticket.subject}`
    );
  }

  // Emit via socket
  const io = req.app.get('io');
  if (io) io.to(`support_${ticket.id}`).emit('support_message', { message, username: req.user.username, isAdmin, createdAt: new Date().toISOString() });

  res.json({ success: true });
});

module.exports = router;

const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('../database');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { sendTicketApprovalEmail } = require('../middleware/email');

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '../uploads/screenshots');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    cb(null, `${uuidv4()}${path.extname(file.originalname)}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error('Only image files allowed'));
  }
});

// SUBMIT proof ticket
router.post('/submit', requireAuth, upload.single('screenshot'), (req, res) => {
  const { content_id, message } = req.body;

  if (!req.file) return res.status(400).json({ error: 'Screenshot required' });
  if (!content_id) return res.status(400).json({ error: 'Content ID required' });

  const content = db.prepare('SELECT * FROM content WHERE id = ? AND status = "active"').get(content_id);
  if (!content) return res.status(404).json({ error: 'Content not found or inactive' });
  if (content.user_id === req.user.id) return res.status(400).json({ error: 'Cannot submit proof for your own content' });

  // Check for existing pending/approved ticket
  const existing = db.prepare(`
    SELECT id FROM tickets WHERE user_id = ? AND content_id = ? AND status != 'rejected'
  `).get(req.user.id, content_id);
  if (existing) return res.status(400).json({ error: 'You already submitted proof for this video' });

  const ticketId = uuidv4();
  const screenshotPath = `/uploads/screenshots/${req.file.filename}`;

  db.prepare(`
    INSERT INTO tickets (id, user_id, content_id, screenshot_path, message, credits_amount)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(ticketId, req.user.id, content_id, screenshotPath, message || '', content.credits_per_view);

  // Notify content owner
  db.prepare('INSERT INTO notifications (id, user_id, type, title, message, link) VALUES (?, ?, ?, ?, ?, ?)').run(
    uuidv4(), content.user_id, 'ticket', 'New Watch Proof', `${req.user.username} watched your ${content.platform} video!`, `/tickets/${ticketId}`
  );

  res.json({ success: true, ticketId, message: 'Proof submitted! Awaiting admin review.' });
});

// GET my tickets
router.get('/my', requireAuth, (req, res) => {
  const tickets = db.prepare(`
    SELECT t.*, c.url, c.platform, c.title, c.thumbnail,
    u.username as content_owner
    FROM tickets t
    JOIN content c ON t.content_id = c.id
    JOIN users u ON c.user_id = u.id
    WHERE t.user_id = ? ORDER BY t.created_at DESC
  `).all(req.user.id);
  res.json({ tickets });
});

// ADMIN: get all pending tickets
router.get('/admin/pending', requireAdmin, (req, res) => {
  const { status = 'pending', page = 1 } = req.query;
  const limit = 20;
  const offset = (page - 1) * limit;

  const tickets = db.prepare(`
    SELECT t.*, 
    u.username, u.email, u.credits as user_credits,
    c.url, c.platform, c.title, c.thumbnail, c.credits_per_view
    FROM tickets t
    JOIN users u ON t.user_id = u.id
    JOIN content c ON t.content_id = c.id
    WHERE t.status = ? ORDER BY t.created_at ASC LIMIT ? OFFSET ?
  `).all(status, limit, offset);

  const total = db.prepare('SELECT COUNT(*) as count FROM tickets WHERE status = ?').get(status);
  res.json({ tickets, total: total.count });
});

// ADMIN: approve ticket
router.post('/:id/approve', requireAdmin, (req, res) => {
  const ticket = db.prepare(`
    SELECT t.*, u.email, u.username, c.platform
    FROM tickets t JOIN users u ON t.user_id = u.id JOIN content c ON t.content_id = c.id
    WHERE t.id = ?
  `).get(req.params.id);

  if (!ticket) return res.status(404).json({ error: 'Ticket not found' });
  if (ticket.status !== 'pending') return res.status(400).json({ error: 'Ticket already reviewed' });

  const { credits_override, admin_note } = req.body;
  const credits = parseInt(credits_override) || ticket.credits_amount;

  db.prepare('UPDATE tickets SET status = ?, admin_note = ?, reviewed_by = ?, reviewed_at = datetime("now") WHERE id = ?')
    .run('approved', admin_note || '', req.user.id, ticket.id);
  db.prepare('UPDATE users SET credits = credits + ?, total_earned = total_earned + ?, videos_watched = videos_watched + 1 WHERE id = ?')
    .run(credits, credits, ticket.user_id);
  db.prepare('UPDATE content SET views_received = views_received + 1 WHERE id = ?').run(ticket.content_id);
  db.prepare('INSERT INTO transactions (id, user_id, type, amount, description, reference) VALUES (?, ?, ?, ?, ?, ?)').run(
    uuidv4(), ticket.user_id, 'watch_reward', credits, `Approved: watched ${ticket.platform} video`, ticket.id
  );
  db.prepare('INSERT INTO notifications (id, user_id, type, title, message) VALUES (?, ?, ?, ?, ?)').run(
    uuidv4(), ticket.user_id, 'credit', '✅ Proof Approved!', `You earned ${credits} credits for watching a video!`
  );

  try { sendTicketApprovalEmail(ticket.email, ticket.username, credits); } catch (e) {}

  res.json({ success: true });
});

// ADMIN: reject ticket
router.post('/:id/reject', requireAdmin, (req, res) => {
  const { admin_note } = req.body;
  const ticket = db.prepare('SELECT * FROM tickets WHERE id = ?').get(req.params.id);
  if (!ticket) return res.status(404).json({ error: 'Ticket not found' });
  if (ticket.status !== 'pending') return res.status(400).json({ error: 'Already reviewed' });

  db.prepare('UPDATE tickets SET status = ?, admin_note = ?, reviewed_by = ?, reviewed_at = datetime("now") WHERE id = ?')
    .run('rejected', admin_note || '', req.user.id, ticket.id);

  db.prepare('INSERT INTO notifications (id, user_id, type, title, message) VALUES (?, ?, ?, ?, ?)').run(
    uuidv4(), ticket.user_id, 'ticket', '❌ Proof Rejected', `Your proof was rejected. Reason: ${admin_note || 'Does not meet requirements'}`
  );

  res.json({ success: true });
});

module.exports = router;

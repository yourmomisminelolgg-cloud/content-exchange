const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const path = require('path');
const db = require('../database/db');
const auth = require('../middleware/auth');
const adminAuth = require('../middleware/admin');

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/tickets'),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${uuidv4()}${path.extname(file.originalname)}`)
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only images allowed'));
  }
});

// GET /api/tickets - my tickets
router.get('/', auth, (req, res) => {
  const { status, page = 1, limit = 20 } = req.query;
  const offset = (page - 1) * limit;
  let where = 'WHERE t.user_id = ?';
  const params = [req.user.id];
  if (status) { where += ' AND t.status = ?'; params.push(status); }

  const items = db.prepare(`
    SELECT t.*, c.title as content_title, c.url as content_url, c.platform as content_platform, c.thumbnail as content_thumbnail
    FROM tickets t JOIN content c ON t.content_id = c.id
    ${where} ORDER BY t.created_at DESC LIMIT ? OFFSET ?
  `).all(...params, limit, offset);

  const total = db.prepare(`SELECT COUNT(*) as c FROM tickets t ${where}`).get(...params);
  res.json({ items, total: total.c });
});

// POST /api/tickets - submit proof
router.post('/', auth, upload.single('screenshot'), (req, res) => {
  const { contentId, message } = req.body;
  if (!contentId) return res.status(400).json({ error: 'Content ID required' });
  if (!req.file) return res.status(400).json({ error: 'Screenshot required' });

  const content = db.prepare('SELECT * FROM content WHERE id = ? AND status = ?').get(contentId, 'active');
  if (!content) return res.status(404).json({ error: 'Content not found or inactive' });
  if (content.user_id === req.user.id) return res.status(400).json({ error: 'Cannot submit proof for your own content' });

  // Check duplicate
  const existing = db.prepare("SELECT id FROM tickets WHERE user_id = ? AND content_id = ? AND status IN ('pending','approved')").get(req.user.id, contentId);
  if (existing) return res.status(400).json({ error: 'You already submitted proof for this content' });

  const uuid = uuidv4();
  const screenshotPath = req.file.filename;
  db.prepare(`
    INSERT INTO tickets (uuid, user_id, username, content_id, screenshot_path, message)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(uuid, req.user.id, req.user.username, contentId, screenshotPath, message || '');

  // Add to watch history
  db.prepare('INSERT OR IGNORE INTO watch_history (user_id, content_id) VALUES (?, ?)').run(req.user.id, contentId);
  db.prepare('UPDATE users SET videos_watched = videos_watched + 1 WHERE id = ?').run(req.user.id);

  // Update streak
  const user = db.prepare('SELECT last_watch_date, streak FROM users WHERE id = ?').get(req.user.id);
  const today = new Date().toDateString();
  const yesterday = new Date(Date.now() - 86400000).toDateString();
  let newStreak = user.streak;
  if (user.last_watch_date !== today) {
    newStreak = user.last_watch_date === yesterday ? user.streak + 1 : 1;
    db.prepare('UPDATE users SET streak = ?, longest_streak = MAX(longest_streak, ?), last_watch_date = ? WHERE id = ?').run(newStreak, newStreak, today, req.user.id);
  }

  // Notify content owner
  db.prepare('INSERT INTO notifications (user_id, type, title, message) VALUES (?,?,?,?)').run(
    content.user_id, 'ticket', '📋 New Proof Submitted', `${req.user.username} submitted proof for your content!`
  );

  res.json({ success: true, uuid, streak: newStreak });
});

// GET /api/tickets/admin - admin: all pending tickets
router.get('/admin/pending', adminAuth, (req, res) => {
  const { status = 'pending', page = 1, limit = 20 } = req.query;
  const offset = (page - 1) * limit;
  const items = db.prepare(`
    SELECT t.*, c.title as content_title, c.url as content_url, c.platform as content_platform,
    c.credits_per_view, u.email as user_email
    FROM tickets t
    JOIN content c ON t.content_id = c.id
    JOIN users u ON t.user_id = u.id
    WHERE t.status = ? ORDER BY t.created_at ASC LIMIT ? OFFSET ?
  `).all(status, limit, offset);
  const total = db.prepare('SELECT COUNT(*) as c FROM tickets WHERE status = ?').get(status);
  res.json({ items, total: total.c });
});

// POST /api/tickets/:uuid/approve - admin approve
router.post('/:uuid/approve', adminAuth, (req, res) => {
  const ticket = db.prepare('SELECT * FROM tickets WHERE uuid = ?').get(req.params.uuid);
  if (!ticket) return res.status(404).json({ error: 'Ticket not found' });
  if (ticket.status !== 'pending') return res.status(400).json({ error: 'Ticket already reviewed' });

  const content = db.prepare('SELECT * FROM content WHERE id = ?').get(ticket.content_id);
  const creditsToAward = content.credits_per_view;

  // Award credits to watcher
  db.prepare('UPDATE users SET credits = credits + ?, total_earned = total_earned + ? WHERE id = ?').run(creditsToAward, creditsToAward, ticket.user_id);
  const watcher = db.prepare('SELECT credits FROM users WHERE id = ?').get(ticket.user_id);
  db.prepare('INSERT INTO transactions (user_id, type, amount, description, balance_after) VALUES (?,?,?,?,?)').run(
    ticket.user_id, 'watch_reward', creditsToAward, `Approved: watched ${content.title || content.url}`, watcher.credits
  );

  // Deduct from content pool
  db.prepare('UPDATE content SET current_views = current_views + 1, total_credits_pool = total_credits_pool - ? WHERE id = ?').run(creditsToAward, content.id);
  
  // Deactivate if exhausted
  const updatedContent = db.prepare('SELECT * FROM content WHERE id = ?').get(content.id);
  if (updatedContent.current_views >= updatedContent.requested_views || updatedContent.total_credits_pool <= 0) {
    db.prepare("UPDATE content SET status = 'completed' WHERE id = ?").run(content.id);
  }

  // Update ticket
  db.prepare("UPDATE tickets SET status = 'approved', reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP, credits_awarded = ?, admin_note = ? WHERE uuid = ?").run(
    req.user.id, creditsToAward, req.body.note || '', req.params.uuid
  );

  // Notify watcher
  db.prepare('INSERT INTO notifications (user_id, type, title, message) VALUES (?,?,?,?)').run(
    ticket.user_id, 'ticket_approved', '✅ Proof Approved!', `Your proof was approved! +${creditsToAward} credits added.`
  );

  // Notify content owner
  db.prepare('INSERT INTO notifications (user_id, type, title, message) VALUES (?,?,?,?)').run(
    content.user_id, 'view_counted', '👁️ New View Counted', `${ticket.username} watched your content and was approved!`
  );

  res.json({ success: true, creditsAwarded: creditsToAward });
});

// POST /api/tickets/:uuid/reject - admin reject
router.post('/:uuid/reject', adminAuth, (req, res) => {
  const ticket = db.prepare('SELECT * FROM tickets WHERE uuid = ?').get(req.params.uuid);
  if (!ticket) return res.status(404).json({ error: 'Ticket not found' });
  if (ticket.status !== 'pending') return res.status(400).json({ error: 'Already reviewed' });

  db.prepare("UPDATE tickets SET status = 'rejected', reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP, admin_note = ? WHERE uuid = ?").run(
    req.user.id, req.body.reason || 'Proof insufficient', req.params.uuid
  );

  db.prepare('INSERT INTO notifications (user_id, type, title, message) VALUES (?,?,?,?)').run(
    ticket.user_id, 'ticket_rejected', '❌ Proof Rejected', `Your proof was rejected. Reason: ${req.body.reason || 'Proof insufficient'}`
  );

  res.json({ success: true });
});

module.exports = router;

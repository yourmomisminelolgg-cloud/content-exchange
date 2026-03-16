const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../database');
const { requireAuth, requireEmailVerified } = require('../middleware/auth');

// GET watch feed
router.get('/feed', requireAuth, (req, res) => {
  const { page = 1, platform } = req.query;
  const limit = 12;
  const offset = (page - 1) * limit;

  let query = `
    SELECT c.*, u.username, u.avatar, u.is_premium,
    (SELECT COUNT(*) FROM tickets t WHERE t.content_id = c.id AND t.user_id = ? AND t.status != 'rejected') as user_watched
    FROM content c
    JOIN users u ON c.user_id = u.id
    WHERE c.status = 'active' AND c.user_id != ? AND c.views_received < c.requested_views
  `;
  const params = [req.user.id, req.user.id];

  if (platform) { query += ' AND c.platform = ?'; params.push(platform); }

  query += ' ORDER BY u.is_premium DESC, c.created_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const items = db.prepare(query).all(...params);
  const total = db.prepare(`SELECT COUNT(*) as count FROM content WHERE status = 'active' AND user_id != ? AND views_received < requested_views`).get(req.user.id);

  res.json({ items, total: total.count, page: parseInt(page), limit });
});

// GET my content
router.get('/my', requireAuth, (req, res) => {
  const items = db.prepare(`
    SELECT c.*, 
    (SELECT COUNT(*) FROM tickets t WHERE t.content_id = c.id AND t.status = 'approved') as approved_views
    FROM content c WHERE c.user_id = ? ORDER BY c.created_at DESC
  `).all(req.user.id);
  res.json({ items });
});

// SUBMIT content
router.post('/submit', requireAuth, requireEmailVerified, (req, res) => {
  const { url, platform, description, requested_views, title } = req.body;

  if (!url || !platform) return res.status(400).json({ error: 'URL and platform required' });

  const validPlatforms = ['youtube', 'tiktok', 'instagram', 'twitter', 'twitch', 'other'];
  if (!validPlatforms.includes(platform.toLowerCase())) return res.status(400).json({ error: 'Invalid platform' });

  const reqViews = Math.min(Math.max(parseInt(requested_views) || 10, 1), 1000);
  const creditsPerView = 5;
  const totalCost = reqViews * creditsPerView;

  if (req.user.credits < totalCost) {
    return res.status(400).json({ error: `Not enough credits. Need ${totalCost}, have ${req.user.credits}.` });
  }

  // Extract thumbnail
  let thumbnail = '';
  if (platform === 'youtube') {
    const match = url.match(/(?:v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
    if (match) thumbnail = `https://img.youtube.com/vi/${match[1]}/maxresdefault.jpg`;
  }

  const id = uuidv4();
  db.prepare(`
    INSERT INTO content (id, user_id, url, platform, title, description, thumbnail, requested_views, credits_per_view)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, req.user.id, url, platform.toLowerCase(), title || '', description || '', thumbnail, reqViews, creditsPerView);

  // Deduct credits
  db.prepare('UPDATE users SET credits = credits - ?, total_spent = total_spent + ?, videos_submitted = videos_submitted + 1 WHERE id = ?').run(totalCost, totalCost, req.user.id);
  db.prepare('INSERT INTO transactions (id, user_id, type, amount, description, reference) VALUES (?, ?, ?, ?, ?, ?)').run(
    uuidv4(), req.user.id, 'content_submit', -totalCost, `Submitted ${platform} content: ${title || url}`, id
  );

  res.json({ success: true, id, message: `Content submitted! ${totalCost} credits deducted.` });
});

// DELETE content
router.delete('/:id', requireAuth, (req, res) => {
  const content = db.prepare('SELECT * FROM content WHERE id = ?').get(req.params.id);
  if (!content) return res.status(404).json({ error: 'Not found' });
  if (content.user_id !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });

  const remainingViews = content.requested_views - content.views_received;
  const refund = remainingViews * content.credits_per_view;

  db.prepare('UPDATE content SET status = ? WHERE id = ?').run('removed', content.id);
  if (refund > 0 && content.user_id === req.user.id) {
    db.prepare('UPDATE users SET credits = credits + ? WHERE id = ?').run(refund, req.user.id);
    db.prepare('INSERT INTO transactions (id, user_id, type, amount, description) VALUES (?, ?, ?, ?, ?)').run(
      uuidv4(), req.user.id, 'content_refund', refund, `Refund for removed content`
    );
  }

  res.json({ success: true, refund });
});

// GET single content
router.get('/:id', requireAuth, (req, res) => {
  const content = db.prepare(`
    SELECT c.*, u.username, u.avatar, u.is_premium
    FROM content c JOIN users u ON c.user_id = u.id
    WHERE c.id = ?
  `).get(req.params.id);
  if (!content) return res.status(404).json({ error: 'Not found' });
  res.json({ content });
});

module.exports = router;

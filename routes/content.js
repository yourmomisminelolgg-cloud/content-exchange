const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../database/db');
const auth = require('../middleware/auth');

// GET /api/content - watch queue (all active content, excluding own)
router.get('/', auth, (req, res) => {
  const { platform, category, page = 1, limit = 20 } = req.query;
  const offset = (page - 1) * limit;
  let where = `WHERE c.status = 'active' AND c.user_id != ? AND c.current_views < c.requested_views AND c.total_credits_pool > 0`;
  const params = [req.user.id];
  if (platform) { where += ' AND c.platform = ?'; params.push(platform); }
  if (category) { where += ' AND c.category = ?'; params.push(category); }

  // Exclude already watched
  where += ` AND c.id NOT IN (SELECT content_id FROM watch_history WHERE user_id = ?)`;
  params.push(req.user.id);

  const items = db.prepare(`
    SELECT c.*, u.avatar, u.is_premium, u.reputation
    FROM content c JOIN users u ON c.user_id = u.id
    ${where} ORDER BY c.is_featured DESC, c.created_at DESC LIMIT ? OFFSET ?
  `).all(...params, limit, offset);

  const total = db.prepare(`SELECT COUNT(*) as c FROM content c ${where}`).get(...params);
  res.json({ items, total: total.c, page: parseInt(page) });
});

// GET /api/content/my - my submissions
router.get('/my', auth, (req, res) => {
  const items = db.prepare(`
    SELECT c.*, 
      (SELECT COUNT(*) FROM tickets t WHERE t.content_id = c.id AND t.status = 'approved') as approved_tickets,
      (SELECT COUNT(*) FROM tickets t WHERE t.content_id = c.id AND t.status = 'pending') as pending_tickets
    FROM content c WHERE c.user_id = ? ORDER BY c.created_at DESC
  `).all(req.user.id);
  res.json(items);
});

// GET /api/content/:uuid
router.get('/:uuid', auth, (req, res) => {
  const item = db.prepare(`
    SELECT c.*, u.avatar, u.bio, u.reputation, u.is_premium
    FROM content c JOIN users u ON c.user_id = u.id WHERE c.uuid = ?
  `).get(req.params.uuid);
  if (!item) return res.status(404).json({ error: 'Not found' });
  res.json(item);
});

// POST /api/content - submit content
router.post('/', auth, (req, res) => {
  const { url, platform, title, description, category, tags, requestedViews, creditsPerView } = req.body;

  if (!url || !platform) return res.status(400).json({ error: 'URL and platform required' });

  const validPlatforms = ['youtube', 'tiktok', 'instagram', 'twitter', 'twitch', 'other'];
  if (!validPlatforms.includes(platform)) return res.status(400).json({ error: 'Invalid platform' });

  const views = Math.max(1, Math.min(10000, parseInt(requestedViews) || 10));
  const cpv = Math.max(1, Math.min(50, parseInt(creditsPerView) || 5));
  const totalCost = views * cpv;

  // Check credits
  const user = db.prepare('SELECT credits FROM users WHERE id = ?').get(req.user.id);
  if (user.credits < totalCost) {
    return res.status(400).json({ error: `Not enough credits. Need ${totalCost}, have ${user.credits}` });
  }

  // Auto-detect thumbnail based on URL
  let thumbnail = '';
  if (platform === 'youtube') {
    const match = url.match(/(?:v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
    if (match) thumbnail = `https://img.youtube.com/vi/${match[1]}/maxresdefault.jpg`;
  }

  const contentUuid = uuidv4();
  db.prepare(`
    INSERT INTO content (uuid, user_id, username, title, url, platform, thumbnail, description, category, tags, credits_per_view, total_credits_pool, requested_views)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(contentUuid, req.user.id, req.user.username, title || '', url, platform, thumbnail, description || '', category || 'general', tags || '', cpv, totalCost, views);

  // Deduct credits
  db.prepare('UPDATE users SET credits = credits - ?, total_spent = total_spent + ?, videos_submitted = videos_submitted + 1 WHERE id = ?').run(totalCost, totalCost, req.user.id);
  const updatedUser = db.prepare('SELECT credits FROM users WHERE id = ?').get(req.user.id);
  db.prepare('INSERT INTO transactions (user_id, type, amount, description, balance_after) VALUES (?,?,?,?,?)').run(
    req.user.id, 'content_submit', -totalCost, `Submitted: ${title || url}`, updatedUser.credits
  );

  res.json({ success: true, uuid: contentUuid });
});

// DELETE /api/content/:uuid - remove content (owner or admin)
router.delete('/:uuid', auth, (req, res) => {
  const item = db.prepare('SELECT * FROM content WHERE uuid = ?').get(req.params.uuid);
  if (!item) return res.status(404).json({ error: 'Not found' });
  if (item.user_id !== req.user.id && !req.user.isAdmin) return res.status(403).json({ error: 'Forbidden' });

  // Refund remaining credits
  const remainingViews = item.requested_views - item.current_views;
  const refund = remainingViews * item.credits_per_view;
  if (refund > 0 && item.user_id === req.user.id) {
    db.prepare('UPDATE users SET credits = credits + ? WHERE id = ?').run(refund, item.user_id);
    const u = db.prepare('SELECT credits FROM users WHERE id = ?').get(item.user_id);
    db.prepare('INSERT INTO transactions (user_id, type, amount, description, balance_after) VALUES (?,?,?,?,?)').run(
      item.user_id, 'refund', refund, `Refund: deleted content`, u.credits
    );
  }

  db.prepare("UPDATE content SET status = 'deleted' WHERE uuid = ?").run(req.params.uuid);
  res.json({ success: true, refund });
});

// POST /api/content/:uuid/report
router.post('/:uuid/report', auth, (req, res) => {
  const item = db.prepare('SELECT id, user_id FROM content WHERE uuid = ?').get(req.params.uuid);
  if (!item) return res.status(404).json({ error: 'Not found' });
  const { reason, description } = req.body;
  db.prepare('INSERT INTO reports (reporter_id, content_id, reported_user_id, reason, description) VALUES (?,?,?,?,?)').run(
    req.user.id, item.id, item.user_id, reason || 'other', description || ''
  );
  res.json({ success: true });
});

// GET /api/content/stats/platform
router.get('/stats/overview', auth, (req, res) => {
  const stats = {
    total: db.prepare("SELECT COUNT(*) as c FROM content WHERE status='active'").get().c,
    youtube: db.prepare("SELECT COUNT(*) as c FROM content WHERE platform='youtube' AND status='active'").get().c,
    tiktok: db.prepare("SELECT COUNT(*) as c FROM content WHERE platform='tiktok' AND status='active'").get().c,
    instagram: db.prepare("SELECT COUNT(*) as c FROM content WHERE platform='instagram' AND status='active'").get().c,
    totalCreditsDistributed: db.prepare("SELECT SUM(credits_awarded) as s FROM tickets WHERE status='approved'").get().s || 0
  };
  res.json(stats);
});

module.exports = router;

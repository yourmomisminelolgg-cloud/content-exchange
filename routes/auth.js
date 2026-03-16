require('dotenv').config();
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const db = require('../database/db');
const { body, validationResult } = require('express-validator');
const authMiddleware = require('../middleware/auth');
const { Resend } = require('resend');

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

const emailBase = (content) => `
<div style="font-family:'DM Sans',Arial,sans-serif;max-width:600px;margin:0 auto;background:#09090B;color:#FAFAFA;border-radius:16px;overflow:hidden;">
  <div style="background:linear-gradient(135deg,#5B5BD6,#8B5CF6);padding:32px 40px;text-align:center;">
    <h1 style="margin:0;font-size:24px;font-weight:700;letter-spacing:-0.5px;">Content Exchange</h1>
    <p style="margin:4px 0 0;color:rgba(255,255,255,0.7);font-size:14px;">Creator Platform</p>
  </div>
  <div style="padding:40px;">${content}</div>
  <div style="padding:20px 40px;border-top:1px solid #27272A;text-align:center;">
    <p style="color:#52525B;font-size:12px;margin:0;">© 2025 Content Exchange. All rights reserved.</p>
  </div>
</div>`;

async function sendEmail(to, subject, html) {
  if (!resend) {
    console.log('[Email] Skipped — no RESEND_API_KEY in .env');
    return;
  }
  try {
    console.log('[Email] Sending to:', to, '| Subject:', subject);
    const result = await resend.emails.send({
      from: process.env.EMAIL_FROM || 'Content Exchange <onboarding@resend.dev>',
      to,
      subject,
      html
    });
    console.log('[Email] Success:', JSON.stringify(result));
  } catch (e) {
    console.error('[Email] FAILED:', e.message);
    console.error('[Email] Full error:', JSON.stringify(e));
  }
}

// POST /api/auth/register
router.post('/register', [
  body('username').trim().isLength({ min: 3, max: 20 }).matches(/^[a-zA-Z0-9_]+$/).withMessage('Username must be 3-20 chars, letters/numbers/underscores only'),
  body('email').isEmail().normalizeEmail().withMessage('Valid email required'),
  body('password').isLength({ min: 8 }).withMessage('Password must be 8+ chars')
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });

  const { username, email, password, referralCode } = req.body;
  try {
    const existing = db.prepare('SELECT id, username, email FROM users WHERE LOWER(email)=LOWER(?) OR LOWER(username)=LOWER(?)').get(email, username);
    if (existing) {
      return res.status(400).json({ error: existing.email.toLowerCase() === email.toLowerCase() ? 'Email already registered' : 'Username already taken' });
    }

    const hashedPw = await bcrypt.hash(password, 12);
    const verifyToken = uuidv4();
    const userUuid = uuidv4();
    const userRefCode = Math.random().toString(36).substring(2, 8).toUpperCase();

    let referredBy = null;
    if (referralCode) {
      const referrer = db.prepare('SELECT id FROM users WHERE referral_code = ?').get(referralCode.toUpperCase());
      if (referrer) referredBy = referrer.id;
    }

    // Auto-verify if SMTP not configured, otherwise send email
    const smtpConfigured = !!process.env.RESEND_API_KEY;
    const autoVerify = !smtpConfigured ? 1 : 0;

    db.prepare(`
      INSERT INTO users (uuid, username, email, password, verify_token, referral_code, referred_by, is_verified)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(userUuid, username, email, hashedPw, verifyToken, userRefCode, referredBy, autoVerify);

    const newUser = db.prepare('SELECT id FROM users WHERE uuid = ?').get(userUuid);

    if (referredBy) {
      db.prepare('UPDATE users SET credits = credits + 100, total_referrals = total_referrals + 1 WHERE id = ?').run(referredBy);
      const refUser = db.prepare('SELECT credits FROM users WHERE id = ?').get(referredBy);
      db.prepare('INSERT INTO transactions (user_id, type, amount, description, balance_after) VALUES (?,?,?,?,?)').run(referredBy, 'referral_bonus', 100, `Referral bonus: ${username} joined`, refUser.credits);
      db.prepare('INSERT INTO notifications (user_id, type, title, message) VALUES (?,?,?,?)').run(referredBy, 'referral', '🎁 Referral Bonus!', `${username} joined using your referral link! +100 credits added.`);
    }

    if (smtpConfigured) {
      const verifyUrl = `${process.env.APP_URL}/api/auth/verify/${verifyToken}`;
      await sendEmail(email, 'Verify your Content Exchange account', emailBase(`
        <h2 style="margin-top:0;font-size:22px;">Welcome, ${username}! 👋</h2>
        <p style="color:#A1A1AA;line-height:1.7;">Click below to verify your email and claim your <strong style="color:#5B5BD6;">50 welcome credits</strong>.</p>
        <div style="text-align:center;margin:32px 0;">
          <a href="${verifyUrl}" style="display:inline-block;background:linear-gradient(135deg,#5B5BD6,#8B5CF6);color:white;padding:14px 36px;border-radius:10px;text-decoration:none;font-weight:600;font-size:16px;">Verify Email →</a>
        </div>
      `));
      res.json({ success: true, message: 'Account created! Check your email to verify.' });
    } else {
      res.json({ success: true, message: 'Account created! You can now log in.', autoVerified: true });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// GET /api/auth/verify/:token
router.get('/verify/:token', (req, res) => {
  const user = db.prepare('SELECT id FROM users WHERE verify_token = ?').get(req.params.token);
  if (!user) return res.redirect(`${process.env.APP_URL || ''}/?error=invalid_token`);
  db.prepare('UPDATE users SET is_verified = 1, verify_token = NULL WHERE id = ?').run(user.id);
  db.prepare('INSERT INTO notifications (user_id, type, title, message) VALUES (?,?,?,?)').run(user.id, 'system', '✅ Email Verified!', 'Your email is verified. Welcome to Content Exchange!');
  res.redirect(`${process.env.APP_URL || ''}/?verified=1`);
});

// POST /api/auth/login
router.post('/login', [
  body('email').isEmail().normalizeEmail(),
  body('password').notEmpty()
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ error: 'Invalid credentials' });

  const { email, password } = req.body;
  try {
    const user = db.prepare('SELECT * FROM users WHERE LOWER(email) = LOWER(?)').get(email);
    if (!user) return res.status(401).json({ error: 'Invalid email or password' });
    if (user.is_banned) return res.status(403).json({ error: `Account banned: ${user.ban_reason || 'Contact support'}` });

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(401).json({ error: 'Invalid email or password' });
    if (!user.is_verified) return res.status(401).json({ error: 'Please verify your email first', needsVerification: true, email: user.email });

    db.prepare('UPDATE users SET last_seen = CURRENT_TIMESTAMP WHERE id = ?').run(user.id);

    const token = jwt.sign(
      { id: user.id, uuid: user.uuid, username: user.username, email: user.email, isAdmin: user.is_admin === 1 },
      process.env.JWT_SECRET,
      { expiresIn: '14d' }
    );

    res.json({
      token,
      user: {
        id: user.id, uuid: user.uuid, username: user.username, email: user.email,
        credits: user.credits, isPremium: user.is_premium === 1, isAdmin: user.is_admin === 1,
        avatar: user.avatar, streak: user.streak
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// POST /api/auth/forgot-password
router.post('/forgot-password', async (req, res) => {
  const { email } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE LOWER(email) = LOWER(?)').get(email);
  if (!user) return res.json({ success: true });
  const token = uuidv4();
  db.prepare('UPDATE users SET reset_token = ?, reset_expires = ? WHERE id = ?').run(token, Date.now() + 3600000, user.id);
  const resetUrl = `${process.env.APP_URL || ''}/?reset=${token}`;
  await sendEmail(email, 'Reset your Content Exchange password', emailBase(`
    <h2 style="margin-top:0;">Reset Password</h2>
    <p style="color:#A1A1AA;">Click below to reset your password. This link expires in 1 hour.</p>
    <div style="text-align:center;margin:32px 0;">
      <a href="${resetUrl}" style="display:inline-block;background:#5B5BD6;color:white;padding:14px 36px;border-radius:10px;text-decoration:none;font-weight:600;">Reset Password</a>
    </div>
    <p style="color:#3F3F46;font-size:12px;">If you didn't request this, ignore this email.</p>
  `));
  res.json({ success: true });
});

// POST /api/auth/reset-password
router.post('/reset-password', async (req, res) => {
  const { token, password } = req.body;
  if (!password || password.length < 8) return res.status(400).json({ error: 'Password must be 8+ chars' });
  const user = db.prepare('SELECT * FROM users WHERE reset_token = ? AND reset_expires > ?').get(token, Date.now());
  if (!user) return res.status(400).json({ error: 'Invalid or expired reset token' });
  const hashed = await bcrypt.hash(password, 12);
  db.prepare('UPDATE users SET password = ?, reset_token = NULL, reset_expires = NULL WHERE id = ?').run(hashed, user.id);
  res.json({ success: true });
});

// POST /api/auth/resend-verification
router.post('/resend-verification', async (req, res) => {
  const { email } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE LOWER(email) = LOWER(?) AND is_verified = 0').get(email);
  if (!user) return res.status(400).json({ error: 'Not found or already verified' });
  const verifyUrl = `${process.env.APP_URL}/api/auth/verify/${user.verify_token}`;
  await sendEmail(email, 'Verify your Content Exchange account', emailBase(`
    <h2 style="margin-top:0;">Verify your email</h2>
    <p style="color:#A1A1AA;">Here's your verification link:</p>
    <div style="text-align:center;margin:32px 0;">
      <a href="${verifyUrl}" style="display:inline-block;background:#5B5BD6;color:white;padding:14px 36px;border-radius:10px;text-decoration:none;font-weight:600;">Verify Email</a>
    </div>
  `));
  res.json({ success: true });
});

// GET /api/auth/me
router.get('/me', authMiddleware, (req, res) => {
  const user = db.prepare(`
    SELECT id, uuid, username, email, credits, total_earned, total_spent, videos_watched,
    videos_submitted, is_premium, is_admin, avatar, bio, streak, longest_streak, referral_code,
    total_referrals, role, reputation, created_at, location, website, twitter, youtube
    FROM users WHERE id = ?
  `).get(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(user);
});

module.exports = router;

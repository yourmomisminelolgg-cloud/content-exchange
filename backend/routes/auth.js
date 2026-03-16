const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { body, validationResult } = require('express-validator');
const db = require('../database');
const { requireAuth } = require('../middleware/auth');
const { sendVerificationEmail, sendPasswordResetEmail } = require('../middleware/email');

// Rate limiting for auth endpoints
const rateLimit = require('express-rate-limit');
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, message: { error: 'Too many attempts, try again later' } });

// REGISTER
router.post('/register', authLimiter, [
  body('username').trim().isLength({ min: 3, max: 20 }).matches(/^[a-zA-Z0-9_]+$/).withMessage('Username must be 3-20 chars, letters/numbers/underscore only'),
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 8 }).matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/).withMessage('Password must be 8+ chars with uppercase, lowercase, and number'),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ error: errors.array()[0].msg });
  }

  const { username, email, password, referralCode } = req.body;

  // Check for existing
  const existingEmail = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existingEmail) return res.status(400).json({ error: 'Email already registered' });

  const existingUsername = db.prepare('SELECT id FROM users WHERE LOWER(username) = LOWER(?)').get(username);
  if (existingUsername) return res.status(400).json({ error: 'Username already taken' });

  const userId = uuidv4();
  const passwordHash = await bcrypt.hash(password, 12);
  const verifyToken = uuidv4();
  const verifyExpires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  db.prepare(`
    INSERT INTO users (id, username, email, password_hash, email_verify_token, email_verify_expires, credits)
    VALUES (?, ?, ?, ?, ?, ?, 50)
  `).run(userId, username, email, passwordHash, verifyToken, verifyExpires);

  // Handle referral
  if (referralCode) {
    const referrer = db.prepare('SELECT id FROM users WHERE id = ?').get(referralCode);
    if (referrer && referrer.id !== userId) {
      db.prepare('INSERT INTO referrals (id, referrer_id, referred_id) VALUES (?, ?, ?)').run(uuidv4(), referrer.id, userId);
      db.prepare('UPDATE users SET credits = credits + 25 WHERE id = ?').run(referrer.id);
      db.prepare('UPDATE users SET credits = credits + 10 WHERE id = ?').run(userId);
      db.prepare('INSERT INTO transactions (id, user_id, type, amount, description) VALUES (?, ?, ?, ?, ?)').run(
        uuidv4(), referrer.id, 'referral_bonus', 25, `Referral bonus for inviting ${username}`
      );
      db.prepare('INSERT INTO notifications (id, user_id, type, title, message) VALUES (?, ?, ?, ?, ?)').run(
        uuidv4(), referrer.id, 'credit', 'Referral Bonus!', `${username} joined using your referral link. +25 credits!`
      );
    }
  }

  db.prepare('INSERT INTO transactions (id, user_id, type, amount, description) VALUES (?, ?, ?, ?, ?)').run(
    uuidv4(), userId, 'welcome_bonus', 50, 'Welcome bonus credits'
  );

  // Send verification email
  try {
    await sendVerificationEmail(email, username, verifyToken);
  } catch (e) {
    console.error('Email send failed:', e.message);
  }

  res.json({ success: true, message: 'Account created! Please check your email to verify your account.' });
});

// VERIFY EMAIL
router.get('/verify-email', (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).json({ error: 'Invalid token' });

  const user = db.prepare('SELECT * FROM users WHERE email_verify_token = ?').get(token);
  if (!user) return res.status(400).json({ error: 'Invalid or expired verification link' });
  if (new Date(user.email_verify_expires) < new Date()) return res.status(400).json({ error: 'Verification link expired. Please request a new one.' });

  db.prepare('UPDATE users SET email_verified = 1, email_verify_token = NULL, email_verify_expires = NULL WHERE id = ?').run(user.id);

  // Auto login after verify
  req.session.userId = user.id;
  res.json({ success: true, message: 'Email verified! Welcome to Content Exchange.' });
});

// RESEND VERIFICATION
router.post('/resend-verification', requireAuth, async (req, res) => {
  if (req.user.email_verified) return res.status(400).json({ error: 'Email already verified' });

  const token = uuidv4();
  const expires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  db.prepare('UPDATE users SET email_verify_token = ?, email_verify_expires = ? WHERE id = ?').run(token, expires, req.user.id);

  try {
    await sendVerificationEmail(req.user.email, req.user.username, token);
    res.json({ success: true, message: 'Verification email sent!' });
  } catch (e) {
    res.status(500).json({ error: 'Failed to send email. Please try again.' });
  }
});

// LOGIN
router.post('/login', authLimiter, async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase().trim());
  if (!user) return res.status(401).json({ error: 'Invalid email or password' });
  if (user.is_banned) return res.status(403).json({ error: 'Account banned', reason: user.ban_reason });

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) return res.status(401).json({ error: 'Invalid email or password' });

  req.session.userId = user.id;
  db.prepare('UPDATE users SET last_seen = datetime("now") WHERE id = ?').run(user.id);

  const { password_hash, email_verify_token, reset_token, ...safeUser } = user;
  res.json({ success: true, user: safeUser });
});

// LOGOUT
router.post('/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

// FORGOT PASSWORD
router.post('/forgot-password', authLimiter, async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase().trim());
  // Always return success to prevent email enumeration
  if (!user) return res.json({ success: true, message: 'If that email exists, you\'ll receive a reset link.' });

  const token = uuidv4();
  const expires = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  db.prepare('UPDATE users SET reset_token = ?, reset_token_expires = ? WHERE id = ?').run(token, expires, user.id);

  try {
    await sendPasswordResetEmail(user.email, user.username, token);
  } catch (e) {
    console.error('Email error:', e.message);
  }

  res.json({ success: true, message: 'If that email exists, you\'ll receive a reset link.' });
});

// RESET PASSWORD
router.post('/reset-password', async (req, res) => {
  const { token, password } = req.body;
  if (!token || !password) return res.status(400).json({ error: 'Token and password required' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });

  const user = db.prepare('SELECT * FROM users WHERE reset_token = ?').get(token);
  if (!user) return res.status(400).json({ error: 'Invalid or expired reset link' });
  if (new Date(user.reset_token_expires) < new Date()) return res.status(400).json({ error: 'Reset link expired' });

  const hash = await bcrypt.hash(password, 12);
  db.prepare('UPDATE users SET password_hash = ?, reset_token = NULL, reset_token_expires = NULL WHERE id = ?').run(hash, user.id);

  res.json({ success: true, message: 'Password reset successfully. You can now log in.' });
});

// GET CURRENT USER
router.get('/me', requireAuth, (req, res) => {
  const { password_hash, email_verify_token, reset_token, ...safeUser } = req.user;
  res.json({ user: safeUser });
});

module.exports = router;

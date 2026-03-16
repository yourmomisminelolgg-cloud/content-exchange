require('dotenv').config();
const { Database: WasmDB } = require('node-sqlite3-wasm');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

if (!fs.existsSync('uploads')) fs.mkdirSync('uploads');
if (!fs.existsSync('uploads/tickets')) fs.mkdirSync('uploads/tickets');
if (!fs.existsSync('uploads/avatars')) fs.mkdirSync('uploads/avatars');

// ── Compatibility shim: makes node-sqlite3-wasm behave like better-sqlite3 ──
// better-sqlite3: stmt.run(a, b, c)  — spread args
// node-sqlite3-wasm: stmt.run([a, b, c]) — array
// This wrapper normalises both so all existing route code works unchanged.
class Statement {
  constructor(wasmStmt) { this._s = wasmStmt; }
  _toArr(args) { return args.length === 1 && Array.isArray(args[0]) ? args[0] : args; }
  run(...args)  { return this._s.run(this._toArr(args)); }
  get(...args)  { return this._s.get(this._toArr(args)) || null; }
  all(...args)  { return this._s.all(this._toArr(args)); }
}

class Database {
  constructor(filePath) { this._db = new WasmDB(filePath); }
  exec(sql)    { return this._db.exec(sql); }
  pragma(str)  { this._db.exec(`PRAGMA ${str}`); }
  prepare(sql) { return new Statement(this._db.prepare(sql)); }
}

const dbPath = path.join(__dirname, 'content_exchange.db');

// Auto-clean stale lock dir left by a previous crashed process
const lockDir = dbPath + '.lock';
if (fs.existsSync(lockDir)) {
  try { fs.rmdirSync(lockDir, { recursive: true }); } catch(e) {}
}

const db = new Database(dbPath);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uuid TEXT UNIQUE NOT NULL,
    username TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    avatar TEXT DEFAULT NULL,
    banner TEXT DEFAULT NULL,
    credits INTEGER DEFAULT 50,
    total_earned INTEGER DEFAULT 0,
    total_spent INTEGER DEFAULT 0,
    videos_watched INTEGER DEFAULT 0,
    videos_submitted INTEGER DEFAULT 0,
    is_premium INTEGER DEFAULT 0,
    premium_expires DATETIME DEFAULT NULL,
    is_admin INTEGER DEFAULT 0,
    is_banned INTEGER DEFAULT 0,
    ban_reason TEXT DEFAULT NULL,
    is_verified INTEGER DEFAULT 0,
    verify_token TEXT DEFAULT NULL,
    reset_token TEXT DEFAULT NULL,
    reset_expires INTEGER DEFAULT NULL,
    bio TEXT DEFAULT '',
    location TEXT DEFAULT '',
    website TEXT DEFAULT '',
    twitter TEXT DEFAULT '',
    youtube TEXT DEFAULT '',
    streak INTEGER DEFAULT 0,
    longest_streak INTEGER DEFAULT 0,
    last_watch_date TEXT DEFAULT NULL,
    referral_code TEXT UNIQUE,
    referred_by INTEGER DEFAULT NULL,
    total_referrals INTEGER DEFAULT 0,
    role TEXT DEFAULT 'creator',
    reputation INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_seen DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS content (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uuid TEXT UNIQUE NOT NULL,
    user_id INTEGER NOT NULL,
    username TEXT NOT NULL,
    title TEXT DEFAULT '',
    url TEXT NOT NULL,
    platform TEXT NOT NULL,
    thumbnail TEXT DEFAULT '',
    description TEXT DEFAULT '',
    category TEXT DEFAULT 'general',
    tags TEXT DEFAULT '',
    credits_per_view INTEGER NOT NULL DEFAULT 5,
    total_credits_pool INTEGER NOT NULL DEFAULT 0,
    requested_views INTEGER DEFAULT 0,
    current_views INTEGER DEFAULT 0,
    status TEXT DEFAULT 'active',
    is_featured INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS tickets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uuid TEXT UNIQUE NOT NULL,
    user_id INTEGER NOT NULL,
    username TEXT NOT NULL,
    content_id INTEGER NOT NULL,
    screenshot_path TEXT,
    message TEXT DEFAULT '',
    status TEXT DEFAULT 'pending',
    admin_note TEXT DEFAULT '',
    reviewed_by INTEGER DEFAULT NULL,
    reviewed_at DATETIME DEFAULT NULL,
    credits_awarded INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (content_id) REFERENCES content(id)
  );

  CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    type TEXT NOT NULL,
    amount INTEGER NOT NULL,
    description TEXT DEFAULT '',
    reference TEXT DEFAULT '',
    balance_after INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS chat_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    username TEXT NOT NULL,
    avatar TEXT DEFAULT NULL,
    message TEXT NOT NULL,
    room TEXT DEFAULT 'general',
    reply_to INTEGER DEFAULT NULL,
    reactions TEXT DEFAULT '{}',
    is_deleted INTEGER DEFAULT 0,
    is_pinned INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS support_tickets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uuid TEXT UNIQUE NOT NULL,
    user_id INTEGER NOT NULL,
    username TEXT NOT NULL,
    subject TEXT NOT NULL,
    category TEXT DEFAULT 'general',
    status TEXT DEFAULT 'open',
    priority TEXT DEFAULT 'normal',
    assigned_to INTEGER DEFAULT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS support_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticket_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    username TEXT NOT NULL,
    message TEXT NOT NULL,
    is_admin INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (ticket_id) REFERENCES support_tickets(id)
  );

  CREATE TABLE IF NOT EXISTS announcements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    type TEXT DEFAULT 'info',
    author_id INTEGER NOT NULL,
    author_username TEXT NOT NULL,
    is_pinned INTEGER DEFAULT 0,
    views INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (author_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS vouches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_user_id INTEGER NOT NULL,
    from_username TEXT NOT NULL,
    to_user_id INTEGER NOT NULL,
    to_username TEXT NOT NULL,
    message TEXT DEFAULT '',
    rating INTEGER DEFAULT 5,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(from_user_id, to_user_id),
    FOREIGN KEY (from_user_id) REFERENCES users(id),
    FOREIGN KEY (to_user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    is_read INTEGER DEFAULT 0,
    link TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS paypal_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    order_id TEXT UNIQUE NOT NULL,
    package_id TEXT NOT NULL,
    amount_usd REAL NOT NULL,
    credits INTEGER NOT NULL,
    status TEXT DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    captured_at DATETIME DEFAULT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reporter_id INTEGER NOT NULL,
    content_id INTEGER DEFAULT NULL,
    reported_user_id INTEGER DEFAULT NULL,
    reason TEXT NOT NULL,
    description TEXT DEFAULT '',
    status TEXT DEFAULT 'pending',
    resolved_by INTEGER DEFAULT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS watch_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    content_id INTEGER NOT NULL,
    watched_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, content_id),
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (content_id) REFERENCES content(id)
  );

  CREATE TABLE IF NOT EXISTS credit_packages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    credits INTEGER NOT NULL,
    price_usd REAL NOT NULL,
    bonus_credits INTEGER DEFAULT 0,
    is_popular INTEGER DEFAULT 0,
    is_active INTEGER DEFAULT 1
  );
`);

// Seed default credit packages
const pkgCount = db.prepare('SELECT COUNT(*) as c FROM credit_packages').get();
if (!pkgCount || pkgCount.c === 0) {
  const pkgs = [
    { name: 'Starter', credits: 100, price_usd: 2.99, bonus_credits: 0, is_popular: 0 },
    { name: 'Creator', credits: 500, price_usd: 9.99, bonus_credits: 50, is_popular: 1 },
    { name: 'Pro', credits: 1200, price_usd: 19.99, bonus_credits: 200, is_popular: 0 },
    { name: 'Elite', credits: 3000, price_usd: 39.99, bonus_credits: 750, is_popular: 0 },
  ];
  const insert = db.prepare('INSERT INTO credit_packages (name, credits, price_usd, bonus_credits, is_popular) VALUES (?,?,?,?,?)');
  pkgs.forEach(p => insert.run(p.name, p.credits, p.price_usd, p.bonus_credits, p.is_popular));
}

// Create default admin
const adminExists = db.prepare('SELECT id FROM users WHERE is_admin = 1').get();
if (!adminExists) {
  const pw = bcrypt.hashSync(process.env.ADMIN_PASSWORD || 'admin1234', 12);
  const ref = Math.random().toString(36).substring(2, 8).toUpperCase();
  db.prepare(`
    INSERT INTO users (uuid, username, email, password, is_admin, is_verified, credits, referral_code, role)
    VALUES (?, ?, ?, ?, 1, 1, 99999, ?, 'admin')
  `).run(uuidv4(), 'admin', process.env.ADMIN_EMAIL || 'admin@contentexchange.com', pw, ref);

  const admin = db.prepare('SELECT id, username FROM users WHERE is_admin = 1').get();
  db.prepare(`
    INSERT INTO announcements (title, content, type, author_id, author_username, is_pinned)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    '🎉 Welcome to Content Exchange!',
    "We're thrilled to launch Content Exchange — watch content, earn credits, and promote your own videos. Join the community and let's grow together!",
    'success', admin.id, admin.username, 1
  );
}

module.exports = db;

require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const session = require('express-session');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: process.env.FRONTEND_URL || 'http://localhost:5173', credentials: true }
});

// Security
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true,
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Session
const sessionMiddleware = session({
  secret: process.env.SESSION_SECRET || 'cx-super-secret-key-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  }
});
app.use(sessionMiddleware);

// Static files
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/content', require('./routes/content'));
app.use('/api/tickets', require('./routes/tickets'));
app.use('/api/users', require('./routes/users'));
app.use('/api/payments', require('./routes/payments'));
app.use('/api', require('./routes/admin'));

// Health check
app.get('/api/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

// SOCKET.IO CHAT
const db = require('./database');
const { requireAuth } = require('./middleware/auth');

// Share session with Socket.IO
io.use((socket, next) => {
  sessionMiddleware(socket.request, {}, next);
});

const onlineUsers = new Map();

io.on('connection', (socket) => {
  const userId = socket.request.session?.userId;
  if (!userId) { socket.disconnect(); return; }

  const user = db.prepare('SELECT id, username, avatar, role, is_premium, is_banned FROM users WHERE id = ?').get(userId);
  if (!user || user.is_banned) { socket.disconnect(); return; }

  socket.user = user;
  onlineUsers.set(userId, { username: user.username, avatar: user.avatar, is_premium: user.is_premium });
  io.emit('online_count', onlineUsers.size);

  socket.on('join_room', (room) => {
    const validRooms = ['general', 'creators', 'announcements'];
    if (!validRooms.includes(room)) return;
    socket.join(room);

    // Send last 50 messages
    const messages = db.prepare(`
      SELECT cm.*, u.username, u.avatar, u.role, u.is_premium
      FROM chat_messages cm JOIN users u ON cm.user_id = u.id
      WHERE cm.room = ? AND cm.is_deleted = 0
      ORDER BY cm.created_at DESC LIMIT 50
    `).all(room).reverse();
    socket.emit('message_history', messages);
  });

  socket.on('send_message', (data) => {
    const { room, message } = data;
    if (!message || message.trim().length === 0) return;
    if (message.length > 500) return;
    const validRooms = ['general', 'creators'];
    if (!validRooms.includes(room)) return;

    const msgId = uuidv4();
    db.prepare('INSERT INTO chat_messages (id, user_id, room, message) VALUES (?, ?, ?, ?)').run(
      msgId, userId, room, message.trim()
    );

    io.to(room).emit('new_message', {
      id: msgId,
      user_id: userId,
      username: user.username,
      avatar: user.avatar,
      role: user.role,
      is_premium: user.is_premium,
      room,
      message: message.trim(),
      created_at: new Date().toISOString(),
    });
  });

  socket.on('delete_message', (msgId) => {
    if (user.role !== 'admin' && user.role !== 'moderator') return;
    db.prepare('UPDATE chat_messages SET is_deleted = 1, deleted_by = ? WHERE id = ?').run(userId, msgId);
    io.emit('message_deleted', msgId);
  });

  socket.on('disconnect', () => {
    onlineUsers.delete(userId);
    io.emit('online_count', onlineUsers.size);
  });
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => console.log(`\n🚀 Content Exchange backend running on port ${PORT}\n`));

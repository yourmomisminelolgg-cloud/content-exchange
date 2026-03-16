require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const jwt = require('jsonwebtoken');
const db = require('./database/db');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

// Security
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Rate limiting
app.use('/api/auth/', rateLimit({ windowMs: 15 * 60 * 1000, max: 20, message: { error: 'Too many requests' } }));
app.use('/api/', rateLimit({ windowMs: 15 * 60 * 1000, max: 500 }));

// Static files
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use(express.static(path.join(__dirname, 'public')));

// Make io available to routes
app.set('io', io);

// API Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/content', require('./routes/content'));
app.use('/api/tickets', require('./routes/tickets'));
app.use('/api/payments', require('./routes/payments'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/users', require('./routes/users'));
app.use('/api/chat', require('./routes/chat'));

// Socket.io authentication middleware
io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) return next(new Error('Authentication required'));
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    socket.user = decoded;
    next();
  } catch {
    next(new Error('Invalid token'));
  }
});

const onlineUsers = new Map(); // userId -> { username, avatar }

io.on('connection', (socket) => {
  const { id, username } = socket.user;
  onlineUsers.set(id, username);
  io.emit('online_count', onlineUsers.size);
  io.emit('user_joined', { username, count: onlineUsers.size });

  // Join general room by default
  socket.join('general');

  socket.on('join_room', (room) => {
    // Leave other rooms except admin
    socket.rooms.forEach(r => { if (r !== socket.id && r !== 'admin_room') socket.leave(r); });
    socket.join(room);
  });

  socket.on('join_admin', () => {
    if (socket.user.isAdmin) socket.join('admin_room');
  });

  socket.on('join_support', (ticketId) => {
    socket.join(`support_${ticketId}`);
  });

  socket.on('chat_message', (data) => {
    if (!data.message || data.message.trim().length === 0) return;
    if (data.message.length > 500) return;

    const room = data.room || 'general';
    const user = db.prepare('SELECT avatar, is_banned FROM users WHERE id = ?').get(id);
    if (user?.is_banned) return;

    const r = db.prepare('INSERT INTO chat_messages (user_id, username, avatar, message, room, reply_to) VALUES (?,?,?,?,?,?)').run(
      id, username, user?.avatar || null, data.message.trim(), room, data.replyTo || null
    );

    const msg = {
      id: r.lastInsertRowid,
      userId: id,
      username,
      avatar: user?.avatar || null,
      message: data.message.trim(),
      room,
      replyTo: data.replyTo || null,
      createdAt: new Date().toISOString()
    };
    io.to(room).emit('chat_message', msg);
  });

  socket.on('typing', (data) => {
    socket.to(data.room || 'general').emit('typing', { username });
  });

  socket.on('reaction', (data) => {
    const msg = db.prepare('SELECT reactions FROM chat_messages WHERE id = ?').get(data.messageId);
    if (!msg) return;
    let reactions = {};
    try { reactions = JSON.parse(msg.reactions); } catch {}
    if (!reactions[data.emoji]) reactions[data.emoji] = [];
    const idx = reactions[data.emoji].indexOf(id);
    if (idx === -1) reactions[data.emoji].push(id);
    else reactions[data.emoji].splice(idx, 1);
    if (reactions[data.emoji].length === 0) delete reactions[data.emoji];
    db.prepare('UPDATE chat_messages SET reactions = ? WHERE id = ?').run(JSON.stringify(reactions), data.messageId);
    io.emit('reaction_update', { messageId: data.messageId, reactions });
  });

  socket.on('disconnect', () => {
    onlineUsers.delete(id);
    io.emit('online_count', onlineUsers.size);
    io.emit('user_left', { username, count: onlineUsers.size });
  });
});

// Catch-all: serve frontend
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n🚀 Content Exchange running at http://localhost:${PORT}`);
  console.log(`   Mode: ${process.env.PAYPAL_MODE || 'sandbox'}`);
  console.log(`   Admin: ${process.env.ADMIN_EMAIL || 'admin@contentexchange.com'}\n`);
});

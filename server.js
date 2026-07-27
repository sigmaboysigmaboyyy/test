const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { initDB } = require('./db');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  maxHttpBufferSize: 1e7 // 10MB limit
});

const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

let db = null;
const userSockets = new Map(); // userId -> Set(socket.id)

// --------------------------------------------------------------------------
// AUTH MIDDLEWARE
// --------------------------------------------------------------------------
async function authMiddleware(req, res, next) {
  const token = req.cookies.messenger_token;
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  const session = await db.get(
    'SELECT s.*, u.username, u.avatar FROM sessions s JOIN users u ON s.user_id = u.id WHERE s.token = ? AND s.expires_at > DATETIME("now")',
    [token]
  );

  if (!session) {
    res.clearCookie('messenger_token');
    return res.status(401).json({ error: 'Session expired' });
  }

  req.user = { id: session.user_id, username: session.username, avatar: session.avatar };
  next();
}

// Helper: Generate Session
async function createSession(userId, res) {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(); // 30 days

  await db.run('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)', [token, userId, expiresAt]);

  res.cookie('messenger_token', token, {
    httpOnly: true,
    maxAge: 30 * 24 * 60 * 60 * 1000,
    sameSite: 'lax'
  });
}

// --------------------------------------------------------------------------
// REST API - AUTHENTICATION
// --------------------------------------------------------------------------
app.post('/api/register', async (req, res) => {
  try {
    const { username, password, avatar } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

    const trimmedUser = username.trim();
    if (trimmedUser.length < 2) return res.status(400).json({ error: 'Username too short' });

    const existing = await db.get('SELECT id FROM users WHERE LOWER(username) = LOWER(?)', [trimmedUser]);
    if (existing) return res.status(400).json({ error: 'Username already taken' });

    const hash = await bcrypt.hash(password, 10);
    const result = await db.run(
      'INSERT INTO users (username, password_hash, avatar) VALUES (?, ?, ?)',
      [trimmedUser, hash, avatar || '⚡']
    );

    await createSession(result.lastID, res);
    res.json({ id: result.lastID, username: trimmedUser, avatar: avatar || '⚡' });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

    const user = await db.get('SELECT * FROM users WHERE LOWER(username) = LOWER(?)', [username.trim()]);
    if (!user) return res.status(400).json({ error: 'Invalid username or password' });

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(400).json({ error: 'Invalid username or password' });

    await createSession(user.id, res);
    res.json({ id: user.id, username: user.username, avatar: user.avatar });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/logout', authMiddleware, async (req, res) => {
  const token = req.cookies.messenger_token;
  if (token) {
    await db.run('DELETE FROM sessions WHERE token = ?', [token]);
  }
  res.clearCookie('messenger_token');
  res.json({ ok: true });
});

app.get('/api/me', authMiddleware, (req, res) => {
  res.json(req.user);
});

app.get('/api/users/search', authMiddleware, async (req, res) => {
  const q = req.query.q || '';
  if (!q.trim()) return res.json([]);
  const users = await db.all(
    'SELECT id, username, avatar FROM users WHERE LOWER(username) LIKE LOWER(?) AND id != ? LIMIT 10',
    [`%${q.trim()}%`, req.user.id]
  );
  res.json(users);
});

// --------------------------------------------------------------------------
// REST API - SERVERS & CHANNELS
// --------------------------------------------------------------------------
app.get('/api/servers', authMiddleware, async (req, res) => {
  const servers = await db.all(
    'SELECT s.* FROM servers s JOIN server_members sm ON s.id = sm.server_id WHERE sm.user_id = ? ORDER BY s.id ASC',
    [req.user.id]
  );
  res.json(servers);
});

app.post('/api/servers', authMiddleware, async (req, res) => {
  const { name, icon } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Server name required' });

  const inviteCode = crypto.randomBytes(4).toString('hex');
  const serverResult = await db.run(
    'INSERT INTO servers (name, icon, owner_id, invite_code) VALUES (?, ?, ?, ?)',
    [name.trim(), icon || '🛡️', req.user.id, inviteCode]
  );

  const serverId = serverResult.lastID;
  await db.run('INSERT INTO server_members (server_id, user_id) VALUES (?, ?)', [serverId, req.user.id]);
  
  // Default channel
  const chanResult = await db.run('INSERT INTO channels (server_id, name) VALUES (?, ?)', [serverId, 'general']);

  res.json({
    id: serverId,
    name: name.trim(),
    icon: icon || '🛡️',
    invite_code: inviteCode,
    defaultChannelId: chanResult.lastID
  });
});

app.post('/api/servers/join', authMiddleware, async (req, res) => {
  const { inviteCode } = req.body;
  if (!inviteCode) return res.status(400).json({ error: 'Invite code required' });

  const serverObj = await db.get('SELECT * FROM servers WHERE invite_code = ?', [inviteCode.trim()]);
  if (!serverObj) return res.status(404).json({ error: 'Invalid server invite code' });

  await db.run('INSERT OR IGNORE INTO server_members (server_id, user_id) VALUES (?, ?)', [serverObj.id, req.user.id]);
  res.json(serverObj);
});

app.get('/api/servers/:serverId/channels', authMiddleware, async (req, res) => {
  const channels = await db.all('SELECT * FROM channels WHERE server_id = ? ORDER BY id ASC', [req.params.serverId]);
  res.json(channels);
});

app.post('/api/servers/:serverId/channels', authMiddleware, async (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Channel name required' });

  const chanName = name.trim().toLowerCase().replace(/\s+/g, '-');
  const result = await db.run('INSERT INTO channels (server_id, name) VALUES (?, ?)', [req.params.serverId, chanName]);
  res.json({ id: result.lastID, server_id: req.params.serverId, name: chanName });
});

app.get('/api/channels/:channelId/messages', authMiddleware, async (req, res) => {
  const messages = await db.all(
    `SELECT cm.*, u.username as sender_name, u.avatar as sender_avatar 
     FROM channel_messages cm 
     JOIN users u ON cm.sender_id = u.id 
     WHERE cm.channel_id = ? 
     ORDER BY cm.id ASC LIMIT 100`,
    [req.params.channelId]
  );
  res.json(messages);
});

// --------------------------------------------------------------------------
// REST API - DIRECT MESSAGES (DMs)
// --------------------------------------------------------------------------
app.get('/api/dms', authMiddleware, async (req, res) => {
  const dms = await db.all(
    `SELECT d.id, 
            CASE WHEN d.user1_id = ? THEN u2.id ELSE u1.id END as partner_id,
            CASE WHEN d.user1_id = ? THEN u2.username ELSE u1.username END as partner_name,
            CASE WHEN d.user1_id = ? THEN u2.avatar ELSE u1.avatar END as partner_avatar
     FROM dms d
     JOIN users u1 ON d.user1_id = u1.id
     JOIN users u2 ON d.user2_id = u2.id
     WHERE d.user1_id = ? OR d.user2_id = ?
     ORDER BY d.id DESC`,
    [req.user.id, req.user.id, req.user.id, req.user.id, req.user.id]
  );
  res.json(dms);
});

app.post('/api/dms', authMiddleware, async (req, res) => {
  const { targetUserId } = req.body;
  if (!targetUserId) return res.status(400).json({ error: 'Target user required' });

  const partner = await db.get('SELECT id, username, avatar FROM users WHERE id = ?', [targetUserId]);
  if (!partner) return res.status(404).json({ error: 'User not found' });

  const u1 = Math.min(req.user.id, partner.id);
  const u2 = Math.max(req.user.id, partner.id);

  let dm = await db.get('SELECT * FROM dms WHERE user1_id = ? AND user2_id = ?', [u1, u2]);
  if (!dm) {
    const result = await db.run('INSERT INTO dms (user1_id, user2_id) VALUES (?, ?)', [u1, u2]);
    dm = { id: result.lastID, user1_id: u1, user2_id: u2 };
  }

  res.json({
    id: dm.id,
    partner_id: partner.id,
    partner_name: partner.username,
    partner_avatar: partner.avatar
  });
});

app.get('/api/dms/:dmId/messages', authMiddleware, async (req, res) => {
  const messages = await db.all(
    `SELECT dm.*, u.username as sender_name, u.avatar as sender_avatar 
     FROM dm_messages dm 
     JOIN users u ON dm.sender_id = u.id 
     WHERE dm.dm_id = ? 
     ORDER BY dm.id ASC LIMIT 100`,
    [req.params.dmId]
  );
  res.json(messages);
});

app.get('/health', (req, res) => res.status(200).send('OK'));

// Fallback to index.html for SPA
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/socket.io')) return next();
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// --------------------------------------------------------------------------
// SOCKET.IO AUTHENTICATED SERVER
// --------------------------------------------------------------------------
io.use(async (socket, next) => {
  const req = socket.request;
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) return next(new Error('Authentication error'));

  const cookies = cookieParser.signedCookies(
    require('cookie').parse(cookieHeader),
    'secret'
  );
  const token = cookies.messenger_token || require('cookie').parse(cookieHeader).messenger_token;

  if (!token) return next(new Error('Authentication error'));

  const session = await db.get(
    'SELECT s.*, u.username, u.avatar FROM sessions s JOIN users u ON s.user_id = u.id WHERE s.token = ? AND s.expires_at > DATETIME("now")',
    [token]
  );

  if (!session) return next(new Error('Authentication error'));

  socket.user = { id: session.user_id, username: session.username, avatar: session.avatar };
  next();
});

io.on('connection', (socket) => {
  const userId = socket.user.id;

  if (!userSockets.has(userId)) {
    userSockets.set(userId, new Set());
  }
  userSockets.get(userId).add(socket.id);

  // Join Channel
  socket.on('join_channel', (channelId) => {
    socket.join(`channel_${channelId}`);
  });

  socket.on('leave_channel', (channelId) => {
    socket.leave(`channel_${channelId}`);
  });

  // Channel Message
  socket.on('send_channel_message', async ({ channelId, text, attachment }) => {
    if (!text && !attachment) return;

    const result = await db.run(
      'INSERT INTO channel_messages (channel_id, sender_id, text, attachment) VALUES (?, ?, ?, ?)',
      [channelId, userId, text || '', attachment ? JSON.stringify(attachment) : null]
    );

    const msg = {
      id: result.lastID,
      channel_id: channelId,
      sender_id: userId,
      sender_name: socket.user.username,
      sender_avatar: socket.user.avatar,
      text: text || '',
      attachment: attachment || null,
      created_at: new Date().toISOString()
    };

    io.to(`channel_${channelId}`).emit('new_channel_message', msg);
  });

  // DM Message
  socket.on('send_dm_message', async ({ dmId, targetUserId, text, attachment }) => {
    if (!text && !attachment) return;

    const result = await db.run(
      'INSERT INTO dm_messages (dm_id, sender_id, text, attachment) VALUES (?, ?, ?, ?)',
      [dmId, userId, text || '', attachment ? JSON.stringify(attachment) : null]
    );

    const msg = {
      id: result.lastID,
      dm_id: dmId,
      sender_id: userId,
      sender_name: socket.user.username,
      sender_avatar: socket.user.avatar,
      text: text || '',
      attachment: attachment || null,
      created_at: new Date().toISOString()
    };

    // Emit to sender sockets
    const senderSockets = userSockets.get(userId);
    if (senderSockets) {
      senderSockets.forEach(sId => io.to(sId).emit('new_dm_message', msg));
    }

    // Emit to target recipient sockets
    const targetSockets = userSockets.get(targetUserId);
    if (targetSockets) {
      targetSockets.forEach(sId => io.to(sId).emit('new_dm_message', msg));
    }
  });

  // WebRTC Signaling Handlers
  socket.on('call_user', ({ targetSocketId, offer, callType }) => {
    io.to(targetSocketId).emit('incoming_call', {
      callerId: socket.id,
      callerName: socket.user.username,
      callerAvatar: socket.user.avatar,
      offer,
      callType
    });
  });

  socket.on('answer_call', ({ targetSocketId, answer }) => {
    io.to(targetSocketId).emit('call_accepted', {
      responderId: socket.id,
      answer
    });
  });

  socket.on('ice_candidate', ({ targetSocketId, candidate }) => {
    io.to(targetSocketId).emit('ice_candidate', {
      senderId: socket.id,
      candidate
    });
  });

  socket.on('end_call', ({ targetSocketId }) => {
    io.to(targetSocketId).emit('call_ended', {
      senderId: socket.id
    });
  });

  socket.on('toggle_media', ({ targetSocketId, mediaType, enabled }) => {
    io.to(targetSocketId).emit('remote_media_toggled', {
      senderId: socket.id,
      mediaType,
      enabled
    });
  });

  socket.on('disconnect', () => {
    if (userSockets.has(userId)) {
      userSockets.get(userId).delete(socket.id);
      if (userSockets.get(userId).size === 0) {
        userSockets.delete(userId);
      }
    }
  });
});

// Start Server after DB init
initDB().then((database) => {
  db = database;
  server.listen(PORT, () => {
    console.log(`\n==================================================`);
    console.log(`🚀 Whisper Platform running on http://localhost:${PORT}`);
    console.log(`==================================================\n`);
  });
});


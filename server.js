const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// In-memory data store
const MAX_HISTORY = 150;
const messages = [];
const onlineUsers = new Map(); // socket.id -> { id, username, color, avatar, joinedAt }

// Pre-fill welcoming message if empty
if (messages.length === 0) {
  messages.push({
    id: 'sys-welcome',
    type: 'system',
    text: '👋 Welcome to Whisper Lite — Instant Public Chat! Share the link with friends to chat in real-time.',
    time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    timestamp: Date.now()
  });
}

io.on('connection', (socket) => {
  console.log(`[Connect] Socket connected: ${socket.id}`);

  // Send current message history to newly connected client
  socket.emit('chat:history', messages);
  socket.emit('users:online_count', onlineUsers.size);

  // User registers nickname on entrance
  socket.on('user:join', (userData) => {
    const username = (userData.username || 'Anonymous').trim().slice(0, 25);
    const color = userData.color || '#6366f1';
    const avatar = userData.avatar || '💬';

    const userObj = {
      socketId: socket.id,
      username,
      color,
      avatar,
      joinedAt: Date.now()
    };

    onlineUsers.set(socket.id, userObj);

    // Notify user of successful registration
    socket.emit('user:registered', userObj);

    // Broadcast updated user list to everyone
    io.emit('users:list', Array.from(onlineUsers.values()));

    // System message in chat feed
    const sysMsg = {
      id: 'sys-' + Date.now() + '-' + Math.random().toString(36).substring(2, 7),
      type: 'system',
      text: `✨ ${username} joined the chat`,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      timestamp: Date.now()
    };
    messages.push(sysMsg);
    if (messages.length > MAX_HISTORY) messages.shift();
    io.emit('chat:message', sysMsg);
  });

  // Handle incoming chat message
  socket.on('chat:send', (data) => {
    const user = onlineUsers.get(socket.id);
    if (!user) return; // Must be registered

    const text = (data.text || '').trim();
    const image = data.image || null;

    if (!text && !image) return;

    const msgObj = {
      id: 'msg-' + Date.now() + '-' + Math.random().toString(36).substring(2, 7),
      type: 'user',
      socketId: socket.id,
      username: user.username,
      color: user.color,
      avatar: user.avatar,
      text: text.slice(0, 2000), // Max text length
      image: image,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      timestamp: Date.now()
    };

    messages.push(msgObj);
    if (messages.length > MAX_HISTORY) messages.shift();

    io.emit('chat:message', msgObj);
  });

  // Handle typing indicator
  socket.on('user:typing', (isTyping) => {
    const user = onlineUsers.get(socket.id);
    if (!user) return;
    socket.broadcast.emit('user:typing_status', {
      socketId: socket.id,
      username: user.username,
      isTyping: !!isTyping
    });
  });

  // Update nickname / avatar / color
  socket.on('user:update_profile', (newProfile) => {
    const user = onlineUsers.get(socket.id);
    if (!user) return;

    const oldName = user.username;
    const newName = (newProfile.username || oldName).trim().slice(0, 25);
    const newColor = newProfile.color || user.color;
    const newAvatar = newProfile.avatar || user.avatar;

    user.username = newName;
    user.color = newColor;
    user.avatar = newAvatar;
    onlineUsers.set(socket.id, user);

    socket.emit('user:registered', user);
    io.emit('users:list', Array.from(onlineUsers.values()));

    if (oldName !== newName) {
      const sysMsg = {
        id: 'sys-' + Date.now() + '-' + Math.random().toString(36).substring(2, 7),
        type: 'system',
        text: `✏️ ${oldName} changed nickname to ${newName}`,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        timestamp: Date.now()
      };
      messages.push(sysMsg);
      if (messages.length > MAX_HISTORY) messages.shift();
      io.emit('chat:message', sysMsg);
    }
  });

  // Handle disconnect
  socket.on('disconnect', () => {
    const user = onlineUsers.get(socket.id);
    if (user) {
      onlineUsers.delete(socket.id);
      io.emit('users:list', Array.from(onlineUsers.values()));

      const sysMsg = {
        id: 'sys-' + Date.now() + '-' + Math.random().toString(36).substring(2, 7),
        type: 'system',
        text: `👋 ${user.username} left the chat`,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        timestamp: Date.now()
      };
      messages.push(sysMsg);
      if (messages.length > MAX_HISTORY) messages.shift();
      io.emit('chat:message', sysMsg);
    }
    console.log(`[Disconnect] Socket disconnected: ${socket.id}`);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Whisper Lite Chat running on http://localhost:${PORT}`);
});

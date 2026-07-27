const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  maxHttpBufferSize: 1e7 // 10MB limit for image attachments
});

const PORT = process.env.PORT || 3000;

// Serve static assets from public folder
app.use(express.static(path.join(__dirname, 'public')));

// Health check route for Render
app.get('/health', (req, res) => res.status(200).send('OK'));


// In-memory data store for active rooms and recent chat messages
const rooms = new Map(); // roomID -> { users: Map(socketId -> userData), messages: [] }

io.on('connection', (socket) => {
  let currentRoom = null;
  let currentUser = null;

  socket.on('join_room', ({ room, username, avatar }) => {
    // Normalize room ID
    const roomID = (room || 'secret-chat').trim().toLowerCase();
    
    // Clean up previous room if any
    if (currentRoom && rooms.has(currentRoom)) {
      socket.leave(currentRoom);
      const rData = rooms.get(currentRoom);
      rData.users.delete(socket.id);
      io.to(currentRoom).emit('room_users', Array.from(rData.users.values()));
    }

    currentRoom = roomID;
    currentUser = {
      id: socket.id,
      username: username || 'Anonymous',
      avatar: avatar || '⚡',
      joinedAt: new Date().toISOString()
    };

    socket.join(roomID);

    if (!rooms.has(roomID)) {
      rooms.set(roomID, {
        users: new Map(),
        messages: []
      });
    }

    const roomData = rooms.get(roomID);
    roomData.users.set(socket.id, currentUser);

    // Send chat history and current user list to joining user
    socket.emit('init_room', {
      room: roomID,
      user: currentUser,
      messages: roomData.messages,
      users: Array.from(roomData.users.values())
    });

    // Notify room about new user
    socket.to(roomID).emit('user_joined', {
      user: currentUser,
      users: Array.from(roomData.users.values())
    });

    // Send system message
    const sysMsg = {
      id: 'sys_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
      system: true,
      text: `${currentUser.username} joined the chat`,
      timestamp: new Date().toISOString()
    };
    roomData.messages.push(sysMsg);
    if (roomData.messages.length > 200) roomData.messages.shift();
    io.to(roomID).emit('new_message', sysMsg);
  });

  socket.on('send_message', (data) => {
    if (!currentRoom || !rooms.has(currentRoom)) return;

    const roomData = rooms.get(currentRoom);
    const message = {
      id: 'msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
      senderId: socket.id,
      senderName: currentUser.username,
      senderAvatar: currentUser.avatar,
      text: data.text || '',
      attachment: data.attachment || null, // { type: 'image'|'file', name, url, size }
      timestamp: new Date().toISOString(),
      reactions: {}
    };

    roomData.messages.push(message);
    if (roomData.messages.length > 200) roomData.messages.shift();

    io.to(currentRoom).emit('new_message', message);
  });

  socket.on('typing', ({ isTyping }) => {
    if (!currentRoom) return;
    socket.to(currentRoom).emit('user_typing', {
      userId: socket.id,
      username: currentUser ? currentUser.username : 'Friend',
      isTyping
    });
  });

  socket.on('add_reaction', ({ messageId, emoji }) => {
    if (!currentRoom || !rooms.has(currentRoom)) return;
    const roomData = rooms.get(currentRoom);
    const msg = roomData.messages.find(m => m.id === messageId);
    if (msg) {
      if (!msg.reactions[emoji]) {
        msg.reactions[emoji] = [];
      }
      const userIndex = msg.reactions[emoji].indexOf(currentUser.username);
      if (userIndex > -1) {
        msg.reactions[emoji].splice(userIndex, 1);
        if (msg.reactions[emoji].length === 0) delete msg.reactions[emoji];
      } else {
        msg.reactions[emoji].push(currentUser.username);
      }
      io.to(currentRoom).emit('message_reaction_updated', { messageId, reactions: msg.reactions });
    }
  });

  socket.on('disconnect', () => {
    if (currentRoom && rooms.has(currentRoom)) {
      const roomData = rooms.get(currentRoom);
      roomData.users.delete(socket.id);
      
      if (currentUser) {
        const sysMsg = {
          id: 'sys_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
          system: true,
          text: `${currentUser.username} left the chat`,
          timestamp: new Date().toISOString()
        };
        roomData.messages.push(sysMsg);
        io.to(currentRoom).emit('new_message', sysMsg);
      }

      io.to(currentRoom).emit('room_users', Array.from(roomData.users.values()));
      
      // Clean up empty room after 1 hour if no users
      if (roomData.users.size === 0) {
        setTimeout(() => {
          if (rooms.has(currentRoom) && rooms.get(currentRoom).users.size === 0) {
            rooms.delete(currentRoom);
          }
        }, 3600000);
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`\n==================================================`);
  console.log(`🚀 Messenger server running on http://localhost:${PORT}`);
  console.log(`==================================================\n`);
});

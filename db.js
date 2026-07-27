const fs = require('fs');
const path = require('path');

const DB_FILE = path.join(__dirname, 'messenger_data.json');

let data = {
  users: [], // { id, username, password_hash, avatar, created_at }
  sessions: [], // { token, user_id, expires_at }
  servers: [], // { id, name, icon, owner_id, invite_code, created_at }
  server_members: [], // { server_id, user_id, joined_at }
  channels: [], // { id, server_id, name, created_at }
  channel_messages: [], // { id, channel_id, sender_id, text, attachment, created_at }
  dms: [], // { id, user1_id, user2_id, created_at }
  dm_messages: [] // { id, dm_id, sender_id, text, attachment, created_at }
};

let autoIncrement = {
  users: 1,
  servers: 1,
  channels: 1,
  channel_messages: 1,
  dms: 1,
  dm_messages: 1
};

function loadData() {
  if (fs.existsSync(DB_FILE)) {
    try {
      const raw = fs.readFileSync(DB_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      data = { ...data, ...parsed };

      // Restore auto increments
      for (const key of Object.keys(autoIncrement)) {
        if (data[key] && data[key].length > 0) {
          const maxId = Math.max(...data[key].map(item => item.id || 0));
          autoIncrement[key] = maxId + 1;
        }
      }
    } catch (e) {
      console.error('Error loading DB file, resetting:', e);
    }
  } else {
    saveData();
  }
}

function saveData() {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {
    console.error('Error saving DB file:', e);
  }
}

async function initDB() {
  loadData();
  console.log('📦 Pure JS Persistent Database initialized cleanly.');
  return dbWrapper;
}

const dbWrapper = {
  async get(queryType, params = []) {
    loadData();
    const now = new Date().toISOString();

    if (queryType.includes('FROM sessions')) {
      const token = params[0];
      const session = data.sessions.find(s => s.token === token && s.expires_at > now);
      if (!session) return null;
      const user = data.users.find(u => u.id === session.user_id);
      if (!user) return null;
      return { ...session, username: user.username, avatar: user.avatar };
    }

    if (queryType.includes('LOWER(username) = LOWER(?)')) {
      const uname = params[0].toLowerCase();
      return data.users.find(u => u.username.toLowerCase() === uname) || null;
    }

    if (queryType.includes('FROM users WHERE id = ?')) {
      const uid = params[0];
      return data.users.find(u => u.id === uid) || null;
    }

    if (queryType.includes('FROM servers WHERE invite_code = ?')) {
      const code = params[0];
      return data.servers.find(s => s.invite_code === code) || null;
    }

    if (queryType.includes('FROM dms WHERE user1_id = ? AND user2_id = ?')) {
      const [u1, u2] = params;
      return data.dms.find(d => d.user1_id === u1 && d.user2_id === u2) || null;
    }

    return null;
  },

  async all(queryType, params = []) {
    loadData();

    if (queryType.includes('LIKE LOWER(?)')) {
      const search = params[0].replace(/%/g, '').toLowerCase();
      const currentUserId = params[1];
      return data.users
        .filter(u => u.username.toLowerCase().includes(search) && u.id !== currentUserId)
        .slice(0, 10)
        .map(u => ({ id: u.id, username: u.username, avatar: u.avatar }));
    }

    if (queryType.includes('FROM servers s JOIN server_members')) {
      const userId = params[0];
      const joinedServerIds = data.server_members.filter(sm => sm.user_id === userId).map(sm => sm.server_id);
      return data.servers.filter(s => joinedServerIds.includes(s.id));
    }

    if (queryType.includes('FROM channels WHERE server_id = ?')) {
      const serverId = Number(params[0]);
      return data.channels.filter(c => c.server_id === serverId);
    }

    if (queryType.includes('FROM channel_messages')) {
      const channelId = Number(params[0]);
      return data.channel_messages
        .filter(m => m.channel_id === channelId)
        .slice(-100)
        .map(m => {
          const sender = data.users.find(u => u.id === m.sender_id) || { username: 'Unknown', avatar: '⚡' };
          return {
            ...m,
            sender_name: sender.username,
            sender_avatar: sender.avatar
          };
        });
    }

    if (queryType.includes('FROM dms d')) {
      const userId = params[0];
      const userDms = data.dms.filter(d => d.user1_id === userId || d.user2_id === userId);
      return userDms.map(d => {
        const partnerId = d.user1_id === userId ? d.user2_id : d.user1_id;
        const partner = data.users.find(u => u.id === partnerId) || { username: 'User', avatar: '⚡' };
        return {
          id: d.id,
          partner_id: partner.id,
          partner_name: partner.username,
          partner_avatar: partner.avatar
        };
      });
    }

    if (queryType.includes('FROM dm_messages')) {
      const dmId = Number(params[0]);
      return data.dm_messages
        .filter(m => m.dm_id === dmId)
        .slice(-100)
        .map(m => {
          const sender = data.users.find(u => u.id === m.sender_id) || { username: 'Unknown', avatar: '⚡' };
          return {
            ...m,
            sender_name: sender.username,
            sender_avatar: sender.avatar
          };
        });
    }

    return [];
  },

  async run(queryType, params = []) {
    loadData();

    if (queryType.includes('INSERT INTO users')) {
      const [username, password_hash, avatar] = params;
      const newUser = {
        id: autoIncrement.users++,
        username,
        password_hash,
        avatar: avatar || '⚡',
        created_at: new Date().toISOString()
      };
      data.users.push(newUser);
      saveData();
      return { lastID: newUser.id };
    }

    if (queryType.includes('INSERT INTO sessions')) {
      const [token, user_id, expires_at] = params;
      data.sessions.push({ token, user_id, expires_at });
      saveData();
      return { lastID: token };
    }

    if (queryType.includes('DELETE FROM sessions')) {
      const token = params[0];
      data.sessions = data.sessions.filter(s => s.token !== token);
      saveData();
      return {};
    }

    if (queryType.includes('INSERT INTO servers')) {
      const [name, icon, owner_id, invite_code] = params;
      const newServer = {
        id: autoIncrement.servers++,
        name,
        icon: icon || '🛡️',
        owner_id,
        invite_code,
        created_at: new Date().toISOString()
      };
      data.servers.push(newServer);
      saveData();
      return { lastID: newServer.id };
    }

    if (queryType.includes('INSERT INTO server_members') || queryType.includes('INSERT OR IGNORE INTO server_members')) {
      const [server_id, user_id] = params;
      const exists = data.server_members.some(sm => sm.server_id === server_id && sm.user_id === user_id);
      if (!exists) {
        data.server_members.push({ server_id, user_id, joined_at: new Date().toISOString() });
        saveData();
      }
      return {};
    }

    if (queryType.includes('INSERT INTO channels')) {
      const [server_id, name] = params;
      const newChannel = {
        id: autoIncrement.channels++,
        server_id: Number(server_id),
        name,
        created_at: new Date().toISOString()
      };
      data.channels.push(newChannel);
      saveData();
      return { lastID: newChannel.id };
    }

    if (queryType.includes('INSERT INTO channel_messages')) {
      const [channel_id, sender_id, text, attachment] = params;
      const newMsg = {
        id: autoIncrement.channel_messages++,
        channel_id: Number(channel_id),
        sender_id,
        text,
        attachment,
        created_at: new Date().toISOString()
      };
      data.channel_messages.push(newMsg);
      saveData();
      return { lastID: newMsg.id };
    }

    if (queryType.includes('INSERT INTO dms')) {
      const [user1_id, user2_id] = params;
      const newDm = {
        id: autoIncrement.dms++,
        user1_id,
        user2_id,
        created_at: new Date().toISOString()
      };
      data.dms.push(newDm);
      saveData();
      return { lastID: newDm.id };
    }

    if (queryType.includes('INSERT INTO dm_messages')) {
      const [dm_id, sender_id, text, attachment] = params;
      const newMsg = {
        id: autoIncrement.dm_messages++,
        dm_id: Number(dm_id),
        sender_id,
        text,
        attachment,
        created_at: new Date().toISOString()
      };
      data.dm_messages.push(newMsg);
      saveData();
      return { lastID: newMsg.id };
    }

    return {};
  }
};

module.exports = { initDB };

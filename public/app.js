/* ==========================================================================
   Whisper Messenger - Client Application Logic
   ========================================================================== */

document.addEventListener('DOMContentLoaded', () => {
  const socket = io();

  // State
  let currentRoom = '';
  let currentUser = { username: '', avatar: '⚡' };
  let activeUsers = [];
  let currentAttachment = null;
  let typingTimeout = null;
  let isSoundEnabled = true;

  // DOM Elements - Modals & Layout
  const joinModal = document.getElementById('joinModal');
  const chatView = document.getElementById('chatView');
  const joinForm = document.getElementById('joinForm');
  const usernameInput = document.getElementById('usernameInput');
  const roomInput = document.getElementById('roomInput');
  const randomRoomBtn = document.getElementById('randomRoomBtn');
  const avatarOptions = document.querySelectorAll('.avatar-option');

  // DOM Elements - Sidebar & Header
  const sidebar = document.getElementById('sidebar');
  const toggleSidebarBtn = document.getElementById('toggleSidebarBtn');
  const closeSidebarBtn = document.getElementById('closeSidebarBtn');
  const displayRoomName = document.getElementById('displayRoomName');
  const headerRoomTitle = document.getElementById('headerRoomTitle');
  const welcomeRoomName = document.getElementById('welcomeRoomName');
  const userCount = document.getElementById('userCount');
  const usersList = document.getElementById('usersList');
  const myAvatarDisplay = document.getElementById('myAvatarDisplay');
  const myNameDisplay = document.getElementById('myNameDisplay');
  const copyLinkBtn = document.getElementById('copyLinkBtn');
  const headerShareBtn = document.getElementById('headerShareBtn');
  const soundToggleBtn = document.getElementById('soundToggleBtn');
  const soundIcon = document.getElementById('soundIcon');
  const leaveBtn = document.getElementById('leaveBtn');

  // DOM Elements - Messages & Input
  const messagesContainer = document.getElementById('messagesContainer');
  const typingIndicator = document.getElementById('typingIndicator');
  const typingText = document.getElementById('typingText');
  const messageForm = document.getElementById('messageForm');
  const messageInput = document.getElementById('messageInput');
  const attachBtn = document.getElementById('attachBtn');
  const fileInput = document.getElementById('fileInput');
  const attachmentPreviewBar = document.getElementById('attachmentPreviewBar');
  const imagePreview = document.getElementById('imagePreview');
  const filePreview = document.getElementById('filePreview');
  const fileName = document.getElementById('fileName');
  const removeAttachmentBtn = document.getElementById('removeAttachmentBtn');
  const toast = document.getElementById('toast');
  const toastMsg = document.getElementById('toastMsg');

  // --------------------------------------------------------------------------
  // INITIALIZATION & URL PARSING
  // --------------------------------------------------------------------------
  const urlParams = new URLSearchParams(window.location.search);
  const roomParam = urlParams.get('room');
  
  if (roomParam) {
    roomInput.value = roomParam.trim();
  } else {
    roomInput.value = generateRoomCode();
  }

  // Auto focus name input
  usernameInput.focus();

  // --------------------------------------------------------------------------
  // EVENT LISTENERS - JOIN FORM & AVATAR SELECTOR
  // --------------------------------------------------------------------------
  avatarOptions.forEach(opt => {
    opt.addEventListener('click', () => {
      avatarOptions.forEach(o => o.classList.remove('selected'));
      opt.classList.add('selected');
      currentUser.avatar = opt.dataset.avatar;
    });
  });

  randomRoomBtn.addEventListener('click', () => {
    roomInput.value = generateRoomCode();
  });

  joinForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = usernameInput.value.trim();
    const room = roomInput.value.trim();

    if (!name || !room) return;

    currentUser.username = name;
    currentRoom = room.toLowerCase();

    // Emit join event to server
    socket.emit('join_room', {
      room: currentRoom,
      username: currentUser.username,
      avatar: currentUser.avatar
    });

    // Update UI components
    myAvatarDisplay.textContent = currentUser.avatar;
    myNameDisplay.textContent = currentUser.username;
    displayRoomName.textContent = currentRoom;
    headerRoomTitle.textContent = `# ${currentRoom}`;
    welcomeRoomName.textContent = currentRoom;

    joinModal.classList.add('hidden');
    chatView.classList.remove('hidden');
    messageInput.focus();

    // Update URL query string without reloading page
    const newUrl = `${window.location.pathname}?room=${encodeURIComponent(currentRoom)}`;
    window.history.pushState({ path: newUrl }, '', newUrl);
  });

  // --------------------------------------------------------------------------
  // SOCKET.IO EVENT HANDLERS
  // --------------------------------------------------------------------------
  socket.on('init_room', (data) => {
    messagesContainer.querySelectorAll('.msg-group, .system-message').forEach(el => el.remove());
    renderUsersList(data.users);

    if (data.messages && data.messages.length > 0) {
      data.messages.forEach(msg => appendMessage(msg));
    }
  });

  socket.on('user_joined', (data) => {
    renderUsersList(data.users);
    playChime(600);
  });

  socket.on('room_users', (users) => {
    renderUsersList(users);
  });

  socket.on('new_message', (msg) => {
    appendMessage(msg);
    if (!msg.system && msg.senderId !== socket.id) {
      playChime(800);
    }
  });

  socket.on('user_typing', (data) => {
    if (data.isTyping) {
      typingText.textContent = `${data.username} is typing...`;
      typingIndicator.classList.remove('hidden');
    } else {
      typingIndicator.classList.add('hidden');
    }
  });

  socket.on('message_reaction_updated', ({ messageId, reactions }) => {
    const msgEl = document.getElementById(messageId);
    if (msgEl) {
      const pillsContainer = msgEl.querySelector('.reaction-pills');
      if (pillsContainer) {
        pillsContainer.innerHTML = '';
        for (const [emoji, users] of Object.entries(reactions)) {
          const pill = document.createElement('span');
          pill.className = `reaction-pill ${users.includes(currentUser.username) ? 'active' : ''}`;
          pill.innerHTML = `${emoji} ${users.length}`;
          pill.title = users.join(', ');
          pill.onclick = () => socket.emit('add_reaction', { messageId, emoji });
          pillsContainer.appendChild(pill);
        }
      }
    }
  });

  // --------------------------------------------------------------------------
  // MESSAGE SENDING & TYPING HANDLING
  // --------------------------------------------------------------------------
  messageInput.addEventListener('input', () => {
    autoExpandTextarea(messageInput);

    socket.emit('typing', { isTyping: true });
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => {
      socket.emit('typing', { isTyping: false });
    }, 1500);
  });

  messageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      messageForm.dispatchEvent(new Event('submit'));
    }
  });

  messageForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = messageInput.value.trim();

    if (!text && !currentAttachment) return;

    socket.emit('send_message', {
      text,
      attachment: currentAttachment
    });

    // Reset Input
    messageInput.value = '';
    messageInput.style.height = 'auto';
    clearAttachment();
    socket.emit('typing', { isTyping: false });
  });

  // --------------------------------------------------------------------------
  // ATTACHMENTS (IMAGE & FILE)
  // --------------------------------------------------------------------------
  attachBtn.addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (file.size > 8 * 1024 * 1024) {
      showToast('File size must be under 8MB');
      fileInput.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const isImg = file.type.startsWith('image/');
      currentAttachment = {
        type: isImg ? 'image' : 'file',
        name: file.name,
        size: formatBytes(file.size),
        url: event.target.result
      };

      if (isImg) {
        imagePreview.src = event.target.result;
        imagePreview.classList.remove('hidden');
        filePreview.classList.add('hidden');
      } else {
        fileName.textContent = `${file.name} (${formatBytes(file.size)})`;
        filePreview.classList.remove('hidden');
        imagePreview.classList.add('hidden');
      }

      attachmentPreviewBar.classList.remove('hidden');
    };

    reader.readAsDataURL(file);
  });

  removeAttachmentBtn.addEventListener('click', clearAttachment);

  function clearAttachment() {
    currentAttachment = null;
    fileInput.value = '';
    attachmentPreviewBar.classList.add('hidden');
    imagePreview.src = '';
    imagePreview.classList.add('hidden');
    filePreview.classList.add('hidden');
  }

  // --------------------------------------------------------------------------
  // MESSAGE RENDERING
  // --------------------------------------------------------------------------
  function appendMessage(msg) {
    if (msg.system) {
      const sysEl = document.createElement('div');
      sysEl.className = 'system-message';
      sysEl.textContent = msg.text;
      messagesContainer.appendChild(sysEl);
      scrollToBottom();
      return;
    }

    const isMine = msg.senderId === socket.id;

    const group = document.createElement('div');
    group.id = msg.id;
    group.className = `msg-group ${isMine ? 'my-msg' : 'friend-msg'}`;

    const avatar = document.createElement('div');
    avatar.className = 'msg-avatar';
    avatar.textContent = msg.senderAvatar || '⚡';

    const contentWrapper = document.createElement('div');
    contentWrapper.className = 'msg-content-wrapper';

    const sender = document.createElement('div');
    sender.className = 'msg-sender';
    sender.textContent = isMine ? 'You' : msg.senderName;

    const bubble = document.createElement('div');
    bubble.className = 'msg-bubble';

    if (msg.text) {
      const textSpan = document.createElement('div');
      textSpan.textContent = msg.text;
      bubble.appendChild(textSpan);
    }

    if (msg.attachment) {
      if (msg.attachment.type === 'image') {
        const img = document.createElement('img');
        img.src = msg.attachment.url;
        img.className = 'msg-attachment-img';
        img.alt = msg.attachment.name;
        img.onclick = () => window.open(msg.attachment.url, '_blank');
        bubble.appendChild(img);
      } else {
        const fileLink = document.createElement('a');
        fileLink.href = msg.attachment.url;
        fileLink.download = msg.attachment.name;
        fileLink.className = 'msg-attachment-file';
        fileLink.innerHTML = `<i class="fa-solid fa-file-arrow-down"></i> ${escapeHtml(msg.attachment.name)} (${msg.attachment.size})`;
        bubble.appendChild(fileLink);
      }
    }

    const timeSpan = document.createElement('span');
    timeSpan.className = 'msg-time';
    timeSpan.textContent = formatTime(msg.timestamp);
    bubble.appendChild(timeSpan);

    // Reactions container
    const reactionsDiv = document.createElement('div');
    reactionsDiv.className = 'reaction-pills';

    contentWrapper.appendChild(sender);
    contentWrapper.appendChild(bubble);
    contentWrapper.appendChild(reactionsDiv);

    group.appendChild(avatar);
    group.appendChild(contentWrapper);

    // Quick reaction shortcut on double click
    bubble.addEventListener('dblclick', () => {
      socket.emit('add_reaction', { messageId: msg.id, emoji: '❤️' });
    });

    messagesContainer.appendChild(group);
    scrollToBottom();
  }

  function renderUsersList(users) {
    activeUsers = users;
    userCount.textContent = users.length;
    usersList.innerHTML = '';

    users.forEach(u => {
      const li = document.createElement('li');
      li.className = 'user-item';
      const isSelf = u.id === socket.id;

      li.innerHTML = `
        <span class="user-avatar-small">${escapeHtml(u.avatar)}</span>
        <span class="user-item-name">${escapeHtml(u.username)}</span>
        ${isSelf ? '<span class="you-tag">YOU</span>' : ''}
      `;
      usersList.appendChild(li);
    });

    document.getElementById('headerStatus').textContent = `${users.length} member${users.length === 1 ? '' : 's'} in private room`;
  }

  // --------------------------------------------------------------------------
  // SIDEBAR & CONTROLS
  // --------------------------------------------------------------------------
  toggleSidebarBtn.addEventListener('click', () => sidebar.classList.add('open'));
  closeSidebarBtn.addEventListener('click', () => sidebar.classList.remove('open'));

  const shareHandler = () => {
    const inviteUrl = `${window.location.origin}?room=${encodeURIComponent(currentRoom)}`;
    navigator.clipboard.writeText(inviteUrl).then(() => {
      showToast('Invite link copied to clipboard!');
    }).catch(() => {
      showToast(`Room code: ${currentRoom}`);
    });
  };

  copyLinkBtn.addEventListener('click', shareHandler);
  headerShareBtn.addEventListener('click', shareHandler);

  soundToggleBtn.addEventListener('click', () => {
    isSoundEnabled = !isSoundEnabled;
    soundIcon.className = isSoundEnabled ? 'fa-solid fa-volume-high' : 'fa-solid fa-volume-xmark';
    showToast(isSoundEnabled ? 'Sound enabled' : 'Sound muted');
  });

  leaveBtn.addEventListener('click', () => {
    window.location.href = window.location.pathname;
  });

  // --------------------------------------------------------------------------
  // UTILITIES
  // --------------------------------------------------------------------------
  function generateRoomCode() {
    const adjectives = ['duo', 'secret', 'hyper', 'nexus', 'cosmic', 'shadow', 'pulse'];
    const nouns = ['room', 'chat', 'nest', 'zone', 'vault', 'link', 'lounge'];
    const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
    const noun = nouns[Math.floor(Math.random() * nouns.length)];
    const num = Math.floor(100 + Math.random() * 900);
    return `${adj}-${noun}-${num}`;
  }

  function scrollToBottom() {
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }

  function autoExpandTextarea(textarea) {
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';
  }

  function showToast(msg) {
    toastMsg.textContent = msg;
    toast.classList.remove('hidden');
    setTimeout(() => toast.classList.add('hidden'), 3000);
  }

  function formatTime(isoString) {
    const date = new Date(isoString);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function formatBytes(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1048576).toFixed(1) + ' MB';
  }

  function escapeHtml(str) {
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  // Audio Notification Synthesis via Web Audio API
  function playChime(freq = 600) {
    if (!isSoundEnabled) return;
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(freq * 1.5, ctx.currentTime + 0.12);

      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.12);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start();
      osc.stop(ctx.currentTime + 0.12);
    } catch (e) {
      // AudioContext might be blocked until user interaction
    }
  }
});

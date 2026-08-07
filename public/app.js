(function() {
  'use strict';

  // --- Web Audio API sound effects ---
  let soundEnabled = true;
  let audioCtx = null;

  function getAudioContext() {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
    return audioCtx;
  }

  function playSendSound() {
    if (!soundEnabled) return;
    try {
      const ctx = getAudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
      osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.12); // A5
      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.15);
    } catch (e) {
      // Audio context blocked until interaction
    }
  }

  function playReceiveSound() {
    if (!soundEnabled) return;
    try {
      const ctx = getAudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(440, ctx.currentTime); // A4
      osc.frequency.exponentialRampToValueAtTime(659.25, ctx.currentTime + 0.15); // E5
      gain.gain.setValueAtTime(0.18, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.18);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.18);
    } catch (e) {}
  }

  // --- Random Nickname Generator ---
  const NICK_PREFIXES = ['Cyber', 'Neon', 'Solar', 'Shadow', 'Viper', 'Pixel', 'Alpha', 'Cosmic', 'Hyper', 'Zen', 'Astra', 'Quantum'];
  const NICK_NOUNS = ['Falcon', 'Wolf', 'Panda', 'Echo', 'Rider', 'Phoenix', 'Byte', 'Fox', 'Spark', 'Nexus', 'Blade', 'Vortex'];

  function generateRandomNick() {
    const p = NICK_PREFIXES[Math.floor(Math.random() * NICK_PREFIXES.length)];
    const n = NICK_NOUNS[Math.floor(Math.random() * NICK_NOUNS.length)];
    const num = Math.floor(Math.random() * 90 + 10);
    return `${p}${n}_${num}`;
  }

  // --- DOM Elements ---
  const nicknameModal = document.getElementById('nicknameModal');
  const nicknameForm = document.getElementById('nicknameForm');
  const modalNickname = document.getElementById('modalNickname');
  const btnRandomNick = document.getElementById('btnRandomNick');
  const avatarGrid = document.getElementById('avatarGrid');
  const colorPickerList = document.getElementById('colorPickerList');

  const appContainer = document.getElementById('appContainer');
  const btnEditProfile = document.getElementById('btnEditProfile');
  const userBadgeAvatar = document.getElementById('userBadgeAvatar');
  const userBadgeName = document.getElementById('userBadgeName');
  const btnToggleSound = document.getElementById('btnToggleSound');
  const soundIcon = document.getElementById('soundIcon');
  const btnToggleUsers = document.getElementById('btnToggleUsers');
  const onlineBadgeMobile = document.getElementById('onlineBadgeMobile');

  const messagesContainer = document.getElementById('messagesContainer');
  const messagesList = document.getElementById('messagesList');
  const typingBanner = document.getElementById('typingBanner');
  const typingText = document.getElementById('typingText');

  const chatForm = document.getElementById('chatForm');
  const messageInput = document.getElementById('messageInput');
  const btnAttachImage = document.getElementById('btnAttachImage');
  const imageInput = document.getElementById('imageInput');
  const attachmentPreview = document.getElementById('attachmentPreview');
  const previewImg = document.getElementById('previewImg');
  const btnRemoveAttachment = document.getElementById('btnRemoveAttachment');

  const btnToggleEmoji = document.getElementById('btnToggleEmoji');
  const emojiPicker = document.getElementById('emojiPicker');

  const usersSidebar = document.getElementById('usersSidebar');
  const usersList = document.getElementById('usersList');
  const onlineUsersCount = document.getElementById('onlineUsersCount');

  const profileModal = document.getElementById('profileModal');
  const editProfileForm = document.getElementById('editProfileForm');
  const editNickname = document.getElementById('editNickname');
  const editAvatarGrid = document.getElementById('editAvatarGrid');
  const editColorPickerList = document.getElementById('editColorPickerList');
  const btnCancelEdit = document.getElementById('btnCancelEdit');

  // State
  let currentUser = {
    username: '',
    avatar: '🚀',
    color: '#6366f1'
  };
  let attachedImageData = null;
  let typingTimeout = null;
  let isTypingSent = false;
  let socket = null;

  // --- Avatar & Color Selectors Handler ---
  function setupSelectorGrid(container, targetProp, callback) {
    container.addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      container.querySelectorAll('button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      callback(btn.dataset[targetProp]);
    });
  }

  setupSelectorGrid(avatarGrid, 'avatar', (val) => currentUser.avatar = val);
  setupSelectorGrid(colorPickerList, 'color', (val) => currentUser.color = val);

  // Randomize button click
  btnRandomNick.addEventListener('click', () => {
    modalNickname.value = generateRandomNick();
  });

  // --- Initialize App & Socket ---
  function init() {
    const saved = localStorage.getItem('whisper_user');
    if (saved) {
      try {
        currentUser = JSON.parse(saved);
      } catch (e) {}
    }

    if (currentUser.username) {
      nicknameModal.classList.remove('active');
      connectSocket();
    } else {
      modalNickname.value = generateRandomNick();
      nicknameModal.classList.add('active');
    }
  }

  // First time submit
  nicknameForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = modalNickname.value.trim();
    if (!name) return;

    currentUser.username = name;
    localStorage.setItem('whisper_user', JSON.stringify(currentUser));
    nicknameModal.classList.remove('active');
    connectSocket();
  });

  // Connect to Socket.io backend
  function connectSocket() {
    updateProfileBadge();
    socket = io();

    socket.on('connect', () => {
      socket.emit('user:join', currentUser);
    });

    socket.on('user:registered', (userData) => {
      currentUser.username = userData.username;
      currentUser.color = userData.color;
      currentUser.avatar = userData.avatar;
      updateProfileBadge();
    });

    socket.on('chat:history', (history) => {
      messagesList.innerHTML = '';
      history.forEach(renderMessage);
      scrollToBottom();
    });

    socket.on('chat:message', (msg) => {
      renderMessage(msg);
      scrollToBottom();

      if (msg.type === 'user') {
        if (msg.socketId === socket.id) {
          playSendSound();
        } else {
          playReceiveSound();
        }
      }
    });

    socket.on('users:list', (users) => {
      renderUsersList(users);
    });

    socket.on('users:online_count', (count) => {
      onlineUsersCount.textContent = count;
      onlineBadgeMobile.textContent = count;
    });

    socket.on('user:typing_status', (data) => {
      if (data.isTyping) {
        typingText.textContent = `${data.username} печатает...`;
        typingBanner.classList.remove('hidden');
      } else {
        typingBanner.classList.add('hidden');
      }
    });
  }

  function updateProfileBadge() {
    userBadgeName.textContent = currentUser.username;
    userBadgeAvatar.textContent = currentUser.avatar;
    userBadgeAvatar.style.backgroundColor = currentUser.color;
  }

  // --- Render Messages ---
  function renderMessage(msg) {
    if (msg.type === 'system') {
      const sysEl = document.createElement('div');
      sysEl.className = 'msg-system';
      sysEl.textContent = msg.text;
      messagesList.appendChild(sysEl);
      return;
    }

    const isSelf = socket && msg.socketId === socket.id;
    const msgEl = document.createElement('div');
    msgEl.className = `msg-user ${isSelf ? 'msg-self' : ''}`;

    let imgHTML = '';
    if (msg.image) {
      imgHTML = `<img src="${escapeHTML(msg.image)}" class="msg-img" alt="shared image">`;
    }

    msgEl.innerHTML = `
      <div class="msg-avatar" style="background-color: ${msg.color}">${escapeHTML(msg.avatar)}</div>
      <div class="msg-content">
        <div class="msg-header">
          <span class="msg-username" style="color: ${isSelf ? '#ffffff' : msg.color}">${escapeHTML(msg.username)}</span>
          <span class="msg-time">${escapeHTML(msg.time)}</span>
        </div>
        <div class="msg-bubble">
          ${msg.text ? escapeHTML(msg.text) : ''}
          ${imgHTML}
        </div>
      </div>
    `;

    messagesList.appendChild(msgEl);
  }

  function scrollToBottom() {
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }

  function escapeHTML(str) {
    if (!str) return '';
    return str.replace(/[&<>"']/g, (m) => {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[m];
    });
  }

  // --- Users List Renderer ---
  function renderUsersList(users) {
    onlineUsersCount.textContent = users.length;
    onlineBadgeMobile.textContent = users.length;
    usersList.innerHTML = '';

    users.forEach(u => {
      const isYou = socket && u.socketId === socket.id;
      const uEl = document.createElement('div');
      uEl.className = 'user-item';
      uEl.innerHTML = `
        <div class="user-avatar-sm" style="background-color: ${u.color}">
          ${escapeHTML(u.avatar)}
          <span class="online-dot"></span>
        </div>
        <span class="user-item-name">
          ${escapeHTML(u.username)} ${isYou ? '<span class="user-item-you">(Вы)</span>' : ''}
        </span>
      `;
      usersList.appendChild(uEl);
    });
  }

  // --- Send Message Handling ---
  chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = messageInput.value.trim();

    if (!text && !attachedImageData) return;

    socket.emit('chat:send', {
      text: text,
      image: attachedImageData
    });

    messageInput.value = '';
    clearAttachment();
    stopTyping();
    messageInput.focus();
  });

  // Typing event listener
  messageInput.addEventListener('input', () => {
    if (!socket) return;
    if (!isTypingSent) {
      isTypingSent = true;
      socket.emit('user:typing', true);
    }
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(stopTyping, 2000);
  });

  // Send on Enter (Shift+Enter for new line)
  messageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      chatForm.dispatchEvent(new Event('submit'));
    }
  });

  function stopTyping() {
    if (isTypingSent && socket) {
      isTypingSent = false;
      socket.emit('user:typing', false);
    }
  }

  // --- Image Upload Handling ---
  btnAttachImage.addEventListener('click', () => imageInput.click());

  imageInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (file.size > 3 * 1024 * 1024) {
      alert('Файл слишком большой! Пожалуйста выберите картинку до 3 МБ.');
      return;
    }

    const reader = new FileReader();
    reader.onload = function(evt) {
      attachedImageData = evt.target.result;
      previewImg.src = attachedImageData;
      attachmentPreview.classList.remove('hidden');
    };
    reader.readAsDataURL(file);
  });

  btnRemoveAttachment.addEventListener('click', clearAttachment);

  function clearAttachment() {
    attachedImageData = null;
    imageInput.value = '';
    attachmentPreview.classList.add('hidden');
    previewImg.src = '';
  }

  // --- Emoji Picker ---
  btnToggleEmoji.addEventListener('click', () => {
    emojiPicker.classList.toggle('hidden');
  });

  emojiPicker.addEventListener('click', (e) => {
    if (e.target.tagName === 'SPAN') {
      messageInput.value += e.target.textContent;
      emojiPicker.classList.add('hidden');
      messageInput.focus();
    }
  });

  // Close emoji picker on click outside
  document.addEventListener('click', (e) => {
    if (!emojiPicker.contains(e.target) && e.target !== btnToggleEmoji) {
      emojiPicker.classList.add('hidden');
    }
  });

  // Sound toggle
  btnToggleSound.addEventListener('click', () => {
    soundEnabled = !soundEnabled;
    soundIcon.textContent = soundEnabled ? '🔔' : '🔕';
  });

  // Mobile sidebar toggle
  btnToggleUsers.addEventListener('click', () => {
    usersSidebar.classList.toggle('active');
  });

  // --- Edit Profile Modal ---
  btnEditProfile.addEventListener('click', () => {
    editNickname.value = currentUser.username;
    renderEditProfileGrids();
    profileModal.classList.add('active');
  });

  btnCancelEdit.addEventListener('click', () => {
    profileModal.classList.remove('active');
  });

  function renderEditProfileGrids() {
    editAvatarGrid.innerHTML = avatarGrid.innerHTML;
    editColorPickerList.innerHTML = colorPickerList.innerHTML;

    let selectedAvatar = currentUser.avatar;
    let selectedColor = currentUser.color;

    setupSelectorGrid(editAvatarGrid, 'avatar', (val) => selectedAvatar = val);
    setupSelectorGrid(editColorPickerList, 'color', (val) => selectedColor = val);

    editProfileForm.onsubmit = (e) => {
      e.preventDefault();
      const newName = editNickname.value.trim();
      if (!newName) return;

      currentUser.username = newName;
      currentUser.avatar = selectedAvatar;
      currentUser.color = selectedColor;

      localStorage.setItem('whisper_user', JSON.stringify(currentUser));
      if (socket) {
        socket.emit('user:update_profile', currentUser);
      }
      profileModal.classList.remove('active');
    };
  }

  // Run initial setup
  init();

})();

/* ==========================================================================
   Whisper Platform - Client Logic (Auth, DMs, Servers, Channels & WebRTC)
   ========================================================================== */

document.addEventListener('DOMContentLoaded', () => {
  let socket = null;

  // Application State
  let currentUser = null;
  let activeView = 'dms'; // 'dms' | 'server'
  let activeServerId = null;
  let activeChannelId = null;
  let activeDm = null; // { id, partner_id, partner_name, partner_avatar }
  let userServers = [];
  let userDms = [];

  // WebRTC State
  let peerConnection = null;
  let localStream = null;
  let remoteStream = null;
  let activeCallPeer = null;
  let incomingCallData = null;
  let isAudioMuted = false;
  let isVideoMuted = true;
  let isScreenSharing = false;
  let ringtoneTimer = null;

  const rtcConfig = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' }
    ]
  };

  // DOM Elements - Auth & Modals
  const authModal = document.getElementById('authModal');
  const mainLayout = document.getElementById('mainLayout');
  const authForm = document.getElementById('authForm');
  const tabLogin = document.getElementById('tabLogin');
  const tabRegister = document.getElementById('tabRegister');
  const authUsername = document.getElementById('authUsername');
  const authPassword = document.getElementById('authPassword');
  const avatarGroup = document.getElementById('avatarGroup');
  const avatarOptions = document.querySelectorAll('#avatarSelector .avatar-option');
  const authErrorMsg = document.getElementById('authErrorMsg');
  const authSubmitBtn = document.getElementById('authSubmitBtn');

  // DOM Elements - Server Rail & Sidebar
  const homeRailBtn = document.getElementById('homeRailBtn');
  const serversRailList = document.getElementById('serversRailList');
  const openCreateServerBtn = document.getElementById('openCreateServerBtn');
  const openJoinServerBtn = document.getElementById('openJoinServerBtn');
  const sidebarTitle = document.getElementById('sidebarTitle');
  const openNewDmBtn = document.getElementById('openNewDmBtn');
  const sidebarItemsList = document.getElementById('sidebarItemsList');
  const myAvatarDisplay = document.getElementById('myAvatarDisplay');
  const myNameDisplay = document.getElementById('myNameDisplay');
  const logoutBtn = document.getElementById('logoutBtn');

  // DOM Elements - Chat Header & Streams
  const headerTitle = document.getElementById('headerTitle');
  const headerSubtext = document.getElementById('headerSubtext');
  const messagesContainer = document.getElementById('messagesContainer');
  const welcomeBanner = document.getElementById('welcomeBanner');
  const welcomeTitle = document.getElementById('welcomeTitle');
  const welcomeDesc = document.getElementById('welcomeDesc');
  const messageForm = document.getElementById('messageForm');
  const messageInput = document.getElementById('messageInput');
  const attachBtn = document.getElementById('attachBtn');
  const fileInput = document.getElementById('fileInput');

  // DOM Elements - Call Controls
  const startAudioCallBtn = document.getElementById('startAudioCallBtn');
  const startVideoCallBtn = document.getElementById('startVideoCallBtn');
  const startScreenShareBtn = document.getElementById('startScreenShareBtn');
  const incomingCallModal = document.getElementById('incomingCallModal');
  const callerAvatarDisplay = document.getElementById('callerAvatarDisplay');
  const callerNameDisplay = document.getElementById('callerNameDisplay');
  const callTypeLabel = document.getElementById('callTypeLabel');
  const acceptCallBtn = document.getElementById('acceptCallBtn');
  const declineCallBtn = document.getElementById('declineCallBtn');
  const callStage = document.getElementById('callStage');
  const remoteVideo = document.getElementById('remoteVideo');
  const localVideo = document.getElementById('localVideo');
  const remoteAvatarFallback = document.getElementById('remoteAvatarFallback');
  const localAvatarFallback = document.getElementById('localAvatarFallback');
  const remoteCallAvatar = document.getElementById('remoteCallAvatar');
  const remoteCallName = document.getElementById('remoteCallName');
  const localCallAvatar = document.getElementById('localCallAvatar');
  const localCallName = document.getElementById('localCallName');
  const remoteLiveBadge = document.getElementById('remoteLiveBadge');
  const localLiveBadge = document.getElementById('localLiveBadge');
  const toggleMicBtn = document.getElementById('toggleMicBtn');
  const toggleCamBtn = document.getElementById('toggleCamBtn');
  const toggleScreenShareBtn = document.getElementById('toggleScreenShareBtn');
  const endCallBtn = document.getElementById('endCallBtn');

  // DOM Elements - New DM & Server Modals
  const newDmModal = document.getElementById('newDmModal');
  const searchUserInput = document.getElementById('searchUserInput');
  const userSearchResults = document.getElementById('userSearchResults');
  const closeNewDmBtn = document.getElementById('closeNewDmBtn');

  const createServerModal = document.getElementById('createServerModal');
  const createServerForm = document.getElementById('createServerForm');
  const serverNameInput = document.getElementById('serverNameInput');
  const serverIconOptions = document.querySelectorAll('#serverIconSelector .avatar-option');
  const closeCreateServerBtn = document.getElementById('closeCreateServerBtn');

  const joinServerModal = document.getElementById('joinServerModal');
  const joinServerForm = document.getElementById('joinServerForm');
  const joinInviteInput = document.getElementById('joinInviteInput');
  const closeJoinServerBtn = document.getElementById('closeJoinServerBtn');

  const toast = document.getElementById('toast');
  const toastMsg = document.getElementById('toastMsg');

  let selectedAvatar = '⚡';
  let selectedServerIcon = '🛡️';
  let isRegisterMode = false;
  let currentAttachment = null;

  // --------------------------------------------------------------------------
  // AUTHENTICATION CHECK ON STARTUP
  // --------------------------------------------------------------------------
  checkAuthSession();

  async function checkAuthSession() {
    try {
      const res = await fetch('/api/me');
      if (res.ok) {
        currentUser = await res.json();
        onAuthSuccess();
      } else {
        showAuthModal();
      }
    } catch (e) {
      showAuthModal();
    }
  }

  function showAuthModal() {
    authModal.classList.remove('hidden');
    mainLayout.classList.add('hidden');
  }

  function onAuthSuccess() {
    authModal.classList.add('hidden');
    mainLayout.classList.remove('hidden');

    myAvatarDisplay.textContent = currentUser.avatar;
    myNameDisplay.textContent = currentUser.username;
    localCallAvatar.textContent = currentUser.avatar;
    localCallName.textContent = currentUser.username;

    // Connect Socket.io
    socket = io({ reConnection: true });
    setupSocketListeners();

    // Load Initial Data
    loadServers();
    loadDms();
  }

  // Auth Form Tabs Switcher
  tabLogin.addEventListener('click', () => {
    isRegisterMode = false;
    tabLogin.classList.add('active');
    tabRegister.classList.remove('active');
    avatarGroup.classList.add('hidden');
    authSubmitBtn.innerHTML = 'Log In <i class="fa-solid fa-arrow-right"></i>';
    authErrorMsg.classList.add('hidden');
  });

  tabRegister.addEventListener('click', () => {
    isRegisterMode = true;
    tabRegister.classList.add('active');
    tabLogin.classList.remove('active');
    avatarGroup.classList.remove('hidden');
    authSubmitBtn.innerHTML = 'Create Account <i class="fa-solid fa-arrow-right"></i>';
    authErrorMsg.classList.add('hidden');
  });

  avatarOptions.forEach(opt => {
    opt.addEventListener('click', () => {
      avatarOptions.forEach(o => o.classList.remove('selected'));
      opt.classList.add('selected');
      selectedAvatar = opt.dataset.avatar;
    });
  });

  authForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    authErrorMsg.classList.add('hidden');

    const username = authUsername.value.trim();
    const password = authPassword.value;
    const endpoint = isRegisterMode ? '/api/register' : '/api/login';

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, avatar: selectedAvatar })
      });

      const data = await res.json();
      if (!res.ok) {
        authErrorMsg.textContent = data.error || 'Authentication failed';
        authErrorMsg.classList.remove('hidden');
        return;
      }

      currentUser = data;
      onAuthSuccess();
    } catch (err) {
      authErrorMsg.textContent = 'Server connection error';
      authErrorMsg.classList.remove('hidden');
    }
  });

  logoutBtn.addEventListener('click', async () => {
    await fetch('/api/logout', { method: 'POST' });
    window.location.reload();
  });

  // --------------------------------------------------------------------------
  // SERVERS & CHANNELS NAVIGATION
  // --------------------------------------------------------------------------
  async function loadServers() {
    try {
      const res = await fetch('/api/servers');
      if (res.ok) {
        userServers = await res.json();
        renderServersRail();
      }
    } catch (e) {}
  }

  function renderServersRail() {
    serversRailList.innerHTML = '';
    userServers.forEach(srv => {
      const btn = document.createElement('button');
      btn.className = `rail-btn ${activeView === 'server' && activeServerId === srv.id ? 'active' : ''}`;
      btn.title = srv.name;
      btn.textContent = srv.icon || '🛡️';
      btn.onclick = () => selectServer(srv);
      serversRailList.appendChild(btn);
    });
  }

  homeRailBtn.addEventListener('click', selectHomeView);

  function selectHomeView() {
    activeView = 'dms';
    activeServerId = null;
    activeChannelId = null;
    homeRailBtn.classList.add('active');
    renderServersRail();

    sidebarTitle.textContent = 'Direct Messages';
    openNewDmBtn.classList.remove('hidden');
    renderDmsList();

    if (activeDm) selectDm(activeDm);
    else showWelcome('💬', 'Welcome to Whisper DMs', 'Select or search a contact to start chatting privately.');
  }

  async function selectServer(serverObj) {
    activeView = 'server';
    activeServerId = serverObj.id;
    activeDm = null;
    homeRailBtn.classList.remove('active');
    renderServersRail();

    sidebarTitle.textContent = serverObj.name;
    openNewDmBtn.classList.add('hidden');

    // Fetch Server Channels
    const res = await fetch(`/api/servers/${serverObj.id}/channels`);
    if (res.ok) {
      const channels = await res.json();
      renderChannelsList(channels);
      if (channels.length > 0) selectChannel(channels[0]);
    }
  }

  function renderChannelsList(channels) {
    sidebarItemsList.innerHTML = '';
    channels.forEach(ch => {
      const li = document.createElement('li');
      li.className = `nav-item ${activeChannelId === ch.id ? 'active' : ''}`;
      li.innerHTML = `<span class="nav-item-icon">#</span> <span>${escapeHtml(ch.name)}</span>`;
      li.onclick = () => selectChannel(ch);
      sidebarItemsList.appendChild(li);
    });
  }

  async function selectChannel(channel) {
    activeChannelId = channel.id;
    headerTitle.textContent = `# ${channel.name}`;
    headerSubtext.textContent = `Server Channel`;

    if (socket) socket.emit('join_channel', channel.id);

    const res = await fetch(`/api/channels/${channel.id}/messages`);
    if (res.ok) {
      const messages = await res.json();
      renderMessages(messages);
    }
  }

  // --------------------------------------------------------------------------
  // DIRECT MESSAGES (DMs)
  // --------------------------------------------------------------------------
  async function loadDms() {
    try {
      const res = await fetch('/api/dms');
      if (res.ok) {
        userDms = await res.json();
        if (activeView === 'dms') renderDmsList();
      }
    } catch (e) {}
  }

  function renderDmsList() {
    sidebarItemsList.innerHTML = '';
    userDms.forEach(dm => {
      const li = document.createElement('li');
      li.className = `nav-item ${activeDm && activeDm.id === dm.id ? 'active' : ''}`;
      li.innerHTML = `
        <span class="nav-item-icon">${escapeHtml(dm.partner_avatar)}</span>
        <span>${escapeHtml(dm.partner_name)}</span>
      `;
      li.onclick = () => selectDm(dm);
      sidebarItemsList.appendChild(li);
    });
  }

  async function selectDm(dm) {
    activeDm = dm;
    activeChannelId = null;
    headerTitle.textContent = `@ ${dm.partner_name}`;
    headerSubtext.textContent = `Private Direct Message`;

    renderDmsList();

    const res = await fetch(`/api/dms/${dm.id}/messages`);
    if (res.ok) {
      const messages = await res.json();
      renderMessages(messages);
    }
  }

  // Search User & Create DM
  openNewDmBtn.addEventListener('click', () => {
    newDmModal.classList.remove('hidden');
    searchUserInput.focus();
  });
  closeNewDmBtn.addEventListener('click', () => newDmModal.classList.add('hidden'));

  searchUserInput.addEventListener('input', async () => {
    const q = searchUserInput.value.trim();
    if (!q) {
      userSearchResults.innerHTML = '';
      return;
    }

    const res = await fetch(`/api/users/search?q=${encodeURIComponent(q)}`);
    if (res.ok) {
      const users = await res.json();
      userSearchResults.innerHTML = '';
      users.forEach(u => {
        const li = document.createElement('li');
        li.className = 'search-result-item';
        li.innerHTML = `<span>${u.avatar}</span> <strong>${escapeHtml(u.username)}</strong>`;
        li.onclick = async () => {
          const createRes = await fetch('/api/dms', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ targetUserId: u.id })
          });
          if (createRes.ok) {
            const dmObj = await createRes.json();
            newDmModal.classList.add('hidden');
            await loadDms();
            selectDm(dmObj);
          }
        };
        userSearchResults.appendChild(li);
      });
    }
  });

  // --------------------------------------------------------------------------
  // CREATE & JOIN SERVER MODALS
  // --------------------------------------------------------------------------
  openCreateServerBtn.addEventListener('click', () => createServerModal.classList.remove('hidden'));
  closeCreateServerBtn.addEventListener('click', () => createServerModal.classList.add('hidden'));

  serverIconOptions.forEach(opt => {
    opt.addEventListener('click', () => {
      serverIconOptions.forEach(o => o.classList.remove('selected'));
      opt.classList.add('selected');
      selectedServerIcon = opt.dataset.icon;
    });
  });

  createServerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = serverNameInput.value.trim();
    if (!name) return;

    const res = await fetch('/api/servers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, icon: selectedServerIcon })
    });

    if (res.ok) {
      const serverObj = await res.json();
      createServerModal.classList.add('hidden');
      serverNameInput.value = '';
      await loadServers();
      selectServer(serverObj);
      showToast(`Server created! Invite Code: ${serverObj.invite_code}`);
    }
  });

  openJoinServerBtn.addEventListener('click', () => joinServerModal.classList.remove('hidden'));
  closeJoinServerBtn.addEventListener('click', () => joinServerModal.classList.add('hidden'));

  joinServerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const inviteCode = joinInviteInput.value.trim();
    if (!inviteCode) return;

    const res = await fetch('/api/servers/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ inviteCode })
    });

    if (res.ok) {
      const serverObj = await res.json();
      joinServerModal.classList.add('hidden');
      joinInviteInput.value = '';
      await loadServers();
      selectServer(serverObj);
      showToast(`Joined server: ${serverObj.name}`);
    } else {
      showToast('Invalid invite code');
    }
  });

  // --------------------------------------------------------------------------
  // MESSAGING & ATTACHMENTS
  // --------------------------------------------------------------------------
  messageForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = messageInput.value.trim();
    if (!text && !currentAttachment) return;

    if (activeView === 'dms' && activeDm) {
      socket.emit('send_dm_message', {
        dmId: activeDm.id,
        targetUserId: activeDm.partner_id,
        text,
        attachment: currentAttachment
      });
    } else if (activeView === 'server' && activeChannelId) {
      socket.emit('send_channel_message', {
        channelId: activeChannelId,
        text,
        attachment: currentAttachment
      });
    }

    messageInput.value = '';
    messageInput.style.height = 'auto';
    clearAttachment();
  });

  function renderMessages(messages) {
    messagesContainer.innerHTML = '';
    if (messages.length === 0) {
      showWelcome('💬', 'No messages yet', 'Start the conversation!');
      return;
    }

    messages.forEach(msg => {
      const isMine = msg.sender_id === currentUser.id;
      const group = document.createElement('div');
      group.className = `msg-group ${isMine ? 'my-msg' : 'friend-msg'}`;

      const avatar = document.createElement('div');
      avatar.className = 'msg-avatar';
      avatar.textContent = msg.sender_avatar || '⚡';

      const contentWrapper = document.createElement('div');
      contentWrapper.className = 'msg-content-wrapper';

      const sender = document.createElement('div');
      sender.className = 'msg-sender';
      sender.textContent = isMine ? 'You' : msg.sender_name;

      const bubble = document.createElement('div');
      bubble.className = 'msg-bubble';

      if (msg.text) {
        const textSpan = document.createElement('div');
        textSpan.textContent = msg.text;
        bubble.appendChild(textSpan);
      }

      if (msg.attachment) {
        const att = typeof msg.attachment === 'string' ? JSON.parse(msg.attachment) : msg.attachment;
        if (att.type === 'image') {
          const img = document.createElement('img');
          img.src = att.url;
          img.className = 'msg-attachment-img';
          bubble.appendChild(img);
        }
      }

      const timeSpan = document.createElement('span');
      timeSpan.className = 'msg-time';
      timeSpan.textContent = formatTime(msg.created_at);
      bubble.appendChild(timeSpan);

      contentWrapper.appendChild(sender);
      contentWrapper.appendChild(bubble);
      group.appendChild(avatar);
      group.appendChild(contentWrapper);
      messagesContainer.appendChild(group);
    });

    scrollToBottom();
  }

  function appendMessageToCurrent(msg) {
    const isMine = msg.sender_id === currentUser.id;
    const group = document.createElement('div');
    group.className = `msg-group ${isMine ? 'my-msg' : 'friend-msg'}`;

    const avatar = document.createElement('div');
    avatar.className = 'msg-avatar';
    avatar.textContent = msg.sender_avatar || '⚡';

    const contentWrapper = document.createElement('div');
    contentWrapper.className = 'msg-content-wrapper';

    const sender = document.createElement('div');
    sender.className = 'msg-sender';
    sender.textContent = isMine ? 'You' : msg.sender_name;

    const bubble = document.createElement('div');
    bubble.className = 'msg-bubble';

    if (msg.text) {
      const textSpan = document.createElement('div');
      textSpan.textContent = msg.text;
      bubble.appendChild(textSpan);
    }

    const timeSpan = document.createElement('span');
    timeSpan.className = 'msg-time';
    timeSpan.textContent = formatTime(msg.created_at);
    bubble.appendChild(timeSpan);

    contentWrapper.appendChild(sender);
    contentWrapper.appendChild(bubble);
    group.appendChild(avatar);
    group.appendChild(contentWrapper);
    messagesContainer.appendChild(group);

    scrollToBottom();
  }

  // --------------------------------------------------------------------------
  // SOCKET LISTENERS FOR DMs & CHANNELS
  // --------------------------------------------------------------------------
  function setupSocketListeners() {
    socket.on('new_channel_message', (msg) => {
      if (activeView === 'server' && activeChannelId === msg.channel_id) {
        appendMessageToCurrent(msg);
      }
    });

    socket.on('new_dm_message', (msg) => {
      if (activeView === 'dms' && activeDm && activeDm.id === msg.dm_id) {
        appendMessageToCurrent(msg);
      } else {
        loadDms(); // Refresh DMs list
        playChime(800);
      }
    });

    socket.on('incoming_call', (data) => {
      incomingCallData = data;
      callerAvatarDisplay.textContent = data.callerAvatar;
      callerNameDisplay.textContent = data.callerName;
      callTypeLabel.textContent = `Incoming ${data.callType.toUpperCase()} Call...`;
      incomingCallModal.classList.remove('hidden');
      startRingtone();
    });

    socket.on('call_accepted', async ({ answer }) => {
      stopRingtone();
      if (peerConnection) {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
      }
    });

    socket.on('ice_candidate', async ({ candidate }) => {
      if (peerConnection && candidate) {
        await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
      }
    });

    socket.on('call_ended', () => {
      cleanupCall();
      showToast('Call ended');
    });
  }

  // --------------------------------------------------------------------------
  // WEBRTC CALLING LOGIC
  // --------------------------------------------------------------------------
  startAudioCallBtn.addEventListener('click', () => initiateCall('audio'));
  startVideoCallBtn.addEventListener('click', () => initiateCall('video'));
  startScreenShareBtn.addEventListener('click', () => initiateCall('screen'));

  acceptCallBtn.addEventListener('click', answerCall);
  declineCallBtn.addEventListener('click', () => {
    stopRingtone();
    incomingCallModal.classList.add('hidden');
    if (incomingCallData) {
      socket.emit('end_call', { targetSocketId: incomingCallData.callerId });
      incomingCallData = null;
    }
  });

  async function initiateCall(callType) {
    if (!activeDm) {
      showToast('Select a Direct Message user to call!');
      return;
    }

    try {
      if (callType === 'screen') {
        localStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
        localVideo.srcObject = localStream;
        localVideo.classList.remove('hidden');
        localAvatarFallback.classList.add('hidden');
        localLiveBadge.classList.remove('hidden');
      } else {
        localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: callType === 'video' });
      }

      createPeerConnection();
      localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));

      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);

      socket.emit('call_user', { targetSocketId: activeDm.partner_id, offer, callType });
      callStage.classList.remove('hidden');
    } catch (err) {
      showToast('Could not access camera/mic');
    }
  }

  async function answerCall() {
    stopRingtone();
    incomingCallModal.classList.add('hidden');
    if (!incomingCallData) return;

    try {
      // Default camera OFF on call answer
      localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      localVideo.classList.add('hidden');
      localAvatarFallback.classList.remove('hidden');

      createPeerConnection();
      localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));

      await peerConnection.setRemoteDescription(new RTCSessionDescription(incomingCallData.offer));
      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);

      socket.emit('answer_call', { targetSocketId: incomingCallData.callerId, answer });
      callStage.classList.remove('hidden');
    } catch (err) {
      showToast('Could not access microphone');
    }
  }

  function createPeerConnection() {
    peerConnection = new RTCPeerConnection(rtcConfig);
    peerConnection.onicecandidate = (e) => {
      if (e.candidate && activeCallPeer) {
        socket.emit('ice_candidate', { targetSocketId: activeCallPeer, candidate: e.candidate });
      }
    };
    peerConnection.ontrack = (e) => {
      remoteStream = e.streams[0];
      remoteVideo.srcObject = remoteStream;
      if (e.track.kind === 'video') {
        remoteVideo.classList.remove('hidden');
        remoteAvatarFallback.classList.add('hidden');
      }
    };
  }

  function cleanupCall() {
    stopRingtone();
    if (peerConnection) {
      peerConnection.close();
      peerConnection = null;
    }
    if (localStream) {
      localStream.getTracks().forEach(t => t.stop());
      localStream = null;
    }
    callStage.classList.add('hidden');
    incomingCallModal.classList.add('hidden');
  }

  function startRingtone() {
    playChime(750);
    ringtoneTimer = setInterval(() => playChime(750), 1200);
  }

  function stopRingtone() {
    if (ringtoneTimer) {
      clearInterval(ringtoneTimer);
      ringtoneTimer = null;
    }
  }

  // UTILITIES
  function showWelcome(icon, title, desc) {
    welcomeBanner.classList.remove('hidden');
    welcomeTitle.textContent = title;
    welcomeDesc.textContent = desc;
  }

  function scrollToBottom() {
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }

  function formatTime(isoString) {
    if (!isoString) return '';
    const date = new Date(isoString);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function showToast(msg) {
    toastMsg.textContent = msg;
    toast.classList.remove('hidden');
    setTimeout(() => toast.classList.add('hidden'), 3000);
  }

  function playChime(freq = 600) {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, ctx.currentTime);
      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.12);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.12);
    } catch (e) {}
  }
});

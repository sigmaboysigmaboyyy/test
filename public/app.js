/* ==========================================================================
   Whisper Messenger - Client Application Logic (with Discord-Style Call Stage)
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

  // WebRTC & Call State
  let peerConnection = null;
  let localStream = null;
  let remoteStream = null;
  let activeCallPeer = null; // target socket ID
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

  // DOM Elements - Call Action Buttons
  const startAudioCallBtn = document.getElementById('startAudioCallBtn');
  const startVideoCallBtn = document.getElementById('startVideoCallBtn');
  const startScreenShareBtn = document.getElementById('startScreenShareBtn');

  // DOM Elements - Incoming Call Modal
  const incomingCallModal = document.getElementById('incomingCallModal');
  const callerAvatarDisplay = document.getElementById('callerAvatarDisplay');
  const callerNameDisplay = document.getElementById('callerNameDisplay');
  const callTypeLabel = document.getElementById('callTypeLabel');
  const acceptCallBtn = document.getElementById('acceptCallBtn');
  const declineCallBtn = document.getElementById('declineCallBtn');

  // DOM Elements - Discord Call Stage
  const callStage = document.getElementById('callStage');
  const callStageStatus = document.getElementById('callStageStatus');
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
  const remoteMuteBadge = document.getElementById('remoteMuteBadge');
  const localMuteBadge = document.getElementById('localMuteBadge');
  const toggleMicBtn = document.getElementById('toggleMicBtn');
  const toggleCamBtn = document.getElementById('toggleCamBtn');
  const toggleScreenShareBtn = document.getElementById('toggleScreenShareBtn');
  const endCallBtn = document.getElementById('endCallBtn');

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

    socket.emit('join_room', {
      room: currentRoom,
      username: currentUser.username,
      avatar: currentUser.avatar
    });

    myAvatarDisplay.textContent = currentUser.avatar;
    myNameDisplay.textContent = currentUser.username;
    displayRoomName.textContent = currentRoom;
    headerRoomTitle.textContent = `# ${currentRoom}`;
    welcomeRoomName.textContent = currentRoom;

    localCallAvatar.textContent = currentUser.avatar;
    localCallName.textContent = currentUser.username;

    joinModal.classList.add('hidden');
    chatView.classList.remove('hidden');
    messageInput.focus();

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
  // WEBRTC SIGNALING SOCKET LISTENERS
  // --------------------------------------------------------------------------
  socket.on('incoming_call', async (data) => {
    incomingCallData = data;
    callerAvatarDisplay.textContent = data.callerAvatar;
    callerNameDisplay.textContent = data.callerName;
    callTypeLabel.textContent = data.callType === 'screen' ? 'Incoming Screen Share...' : `Incoming ${data.callType.toUpperCase()} Call...`;
    
    incomingCallModal.classList.remove('hidden');
    startRingtone();
  });

  socket.on('call_accepted', async ({ responderId, answer }) => {
    stopRingtone();
    if (peerConnection) {
      await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
      callStageStatus.textContent = 'Voice Connected';
    }
  });

  socket.on('ice_candidate', async ({ senderId, candidate }) => {
    if (peerConnection && candidate) {
      try {
        await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (err) {
        console.error('Error adding ICE candidate:', err);
      }
    }
  });

  socket.on('call_ended', () => {
    cleanupCall();
    showToast('Call ended');
  });

  socket.on('remote_media_toggled', ({ mediaType, enabled }) => {
    if (mediaType === 'video' || mediaType === 'screen') {
      if (enabled) {
        remoteVideo.classList.remove('hidden');
        remoteAvatarFallback.classList.add('hidden');
        if (mediaType === 'screen') remoteLiveBadge.classList.remove('hidden');
      } else {
        remoteVideo.classList.add('hidden');
        remoteAvatarFallback.classList.remove('hidden');
        remoteLiveBadge.classList.add('hidden');
      }
    } else if (mediaType === 'audio') {
      remoteMuteBadge.classList.toggle('hidden', enabled);
    }
  });

  // --------------------------------------------------------------------------
  // CALL BUTTON HANDLERS
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

  toggleMicBtn.addEventListener('click', () => {
    if (!localStream) return;
    const audioTrack = localStream.getAudioTracks()[0];
    if (audioTrack) {
      isAudioMuted = !isAudioMuted;
      audioTrack.enabled = !isAudioMuted;
      toggleMicBtn.classList.toggle('muted', isAudioMuted);
      toggleMicBtn.querySelector('i').className = isAudioMuted ? 'fa-solid fa-microphone-slash' : 'fa-solid fa-microphone';
      localMuteBadge.classList.toggle('hidden', !isAudioMuted);

      if (activeCallPeer) {
        socket.emit('toggle_media', { targetSocketId: activeCallPeer, mediaType: 'audio', enabled: !isAudioMuted });
      }
    }
  });

  toggleCamBtn.addEventListener('click', async () => {
    if (!localStream) {
      try {
        const camStream = await navigator.mediaDevices.getUserMedia({ video: true });
        const track = camStream.getVideoTracks()[0];
        if (localStream) localStream.addTrack(track);
        else localStream = camStream;
      } catch (e) {
        showToast('Camera access denied');
        return;
      }
    }

    const videoTrack = localStream.getVideoTracks()[0];
    if (videoTrack) {
      isVideoMuted = !isVideoMuted;
      videoTrack.enabled = !isVideoMuted;
      toggleCamBtn.classList.toggle('active', !isVideoMuted);
      toggleCamBtn.querySelector('i').className = isVideoMuted ? 'fa-solid fa-video' : 'fa-solid fa-video-slash';

      if (!isVideoMuted) {
        localVideo.srcObject = localStream;
        localVideo.classList.remove('hidden');
        localAvatarFallback.classList.add('hidden');
      } else {
        localVideo.classList.add('hidden');
        localAvatarFallback.classList.remove('hidden');
      }

      if (activeCallPeer) {
        socket.emit('toggle_media', { targetSocketId: activeCallPeer, mediaType: 'video', enabled: !isVideoMuted });
      }
    }
  });

  toggleScreenShareBtn.addEventListener('click', toggleScreenShare);
  endCallBtn.addEventListener('click', () => {
    if (activeCallPeer) {
      socket.emit('end_call', { targetSocketId: activeCallPeer });
    }
    cleanupCall();
  });

  // --------------------------------------------------------------------------
  // WEBRTC CORE FUNCTIONS
  // --------------------------------------------------------------------------
  async function initiateCall(callType) {
    const friend = activeUsers.find(u => u.id !== socket.id);
    if (!friend) {
      showToast('No friend online in room to call!');
      return;
    }

    activeCallPeer = friend.id;
    remoteCallAvatar.textContent = friend.avatar;
    remoteCallName.textContent = friend.username;
    callStageStatus.textContent = 'Calling...';

    try {
      if (callType === 'screen') {
        localStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
        isScreenSharing = true;
        isVideoMuted = false;
        toggleScreenShareBtn.classList.add('active');
        localLiveBadge.classList.remove('hidden');
        localVideo.srcObject = localStream;
        localVideo.classList.remove('hidden');
        localAvatarFallback.classList.add('hidden');
      } else if (callType === 'video') {
        localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
        isVideoMuted = false;
        toggleCamBtn.classList.add('active');
        localVideo.srcObject = localStream;
        localVideo.classList.remove('hidden');
        localAvatarFallback.classList.add('hidden');
      } else { // Audio only
        localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        isVideoMuted = true;
        localVideo.classList.add('hidden');
        localAvatarFallback.classList.remove('hidden');
      }

      createPeerConnection();

      localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));

      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);

      socket.emit('call_user', {
        targetSocketId: activeCallPeer,
        offer,
        callType
      });

      // Show inline Discord Call Stage above chat
      callStage.classList.remove('hidden');

    } catch (err) {
      console.error('Error starting call:', err);
      showToast('Could not access media devices');
      cleanupCall();
    }
  }

  async function answerCall() {
    stopRingtone();
    incomingCallModal.classList.add('hidden');
    if (!incomingCallData) return;

    activeCallPeer = incomingCallData.callerId;
    remoteCallAvatar.textContent = incomingCallData.callerAvatar;
    remoteCallName.textContent = incomingCallData.callerName;
    callStageStatus.textContent = 'Connecting...';

    try {
      // CRITICAL FIX: Default to AUDIO ONLY when answering call (camera stays OFF!)
      localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      isVideoMuted = true;

      localVideo.classList.add('hidden');
      localAvatarFallback.classList.remove('hidden');

      createPeerConnection();

      localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));

      await peerConnection.setRemoteDescription(new RTCSessionDescription(incomingCallData.offer));
      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);

      socket.emit('answer_call', {
        targetSocketId: activeCallPeer,
        answer
      });

      callStage.classList.remove('hidden');

      if (incomingCallData.callType === 'screen' || incomingCallData.callType === 'video') {
        remoteVideo.classList.remove('hidden');
        remoteAvatarFallback.classList.add('hidden');
        if (incomingCallData.callType === 'screen') remoteLiveBadge.classList.remove('hidden');
      } else {
        remoteVideo.classList.add('hidden');
        remoteAvatarFallback.classList.remove('hidden');
      }

      incomingCallData = null;

    } catch (err) {
      console.error('Error answering call:', err);
      showToast('Could not access microphone');
      cleanupCall();
    }
  }

  function createPeerConnection() {
    peerConnection = new RTCPeerConnection(rtcConfig);

    peerConnection.onicecandidate = (event) => {
      if (event.candidate && activeCallPeer) {
        socket.emit('ice_candidate', {
          targetSocketId: activeCallPeer,
          candidate: event.candidate
        });
      }
    };

    peerConnection.ontrack = (event) => {
      remoteStream = event.streams[0];
      remoteVideo.srcObject = remoteStream;
      callStageStatus.textContent = 'Voice Connected';

      if (event.track.kind === 'video') {
        remoteVideo.classList.remove('hidden');
        remoteAvatarFallback.classList.add('hidden');
      }
    };

    peerConnection.onconnectionstatechange = () => {
      if (peerConnection.connectionState === 'disconnected' || peerConnection.connectionState === 'failed') {
        cleanupCall();
      }
    };
  }

  async function toggleScreenShare() {
    if (!peerConnection || !activeCallPeer) return;

    if (!isScreenSharing) {
      try {
        const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
        const screenTrack = screenStream.getVideoTracks()[0];

        const sender = peerConnection.getSenders().find(s => s.track && s.track.kind === 'video');
        if (sender) {
          sender.replaceTrack(screenTrack);
        } else {
          peerConnection.addTrack(screenTrack, screenStream);
        }

        localVideo.srcObject = screenStream;
        localVideo.classList.remove('hidden');
        localAvatarFallback.classList.add('hidden');
        localLiveBadge.classList.remove('hidden');
        isScreenSharing = true;
        toggleScreenShareBtn.classList.add('active');

        socket.emit('toggle_media', { targetSocketId: activeCallPeer, mediaType: 'screen', enabled: true });

        screenTrack.onended = () => stopScreenShare();
      } catch (err) {
        console.error('Error sharing screen:', err);
      }
    } else {
      stopScreenShare();
    }
  }

  async function stopScreenShare() {
    if (!isScreenSharing) return;
    localLiveBadge.classList.add('hidden');
    isScreenSharing = false;
    toggleScreenShareBtn.classList.remove('active');
    localVideo.classList.add('hidden');
    localAvatarFallback.classList.remove('hidden');

    if (activeCallPeer) {
      socket.emit('toggle_media', { targetSocketId: activeCallPeer, mediaType: 'screen', enabled: false });
    }
  }

  function cleanupCall() {
    stopRingtone();
    if (peerConnection) {
      peerConnection.close();
      peerConnection = null;
    }
    if (localStream) {
      localStream.getTracks().forEach(track => track.stop());
      localStream = null;
    }
    remoteStream = null;
    remoteVideo.srcObject = null;
    localVideo.srcObject = null;
    activeCallPeer = null;
    incomingCallData = null;
    isAudioMuted = false;
    isVideoMuted = true;
    isScreenSharing = false;

    toggleMicBtn.classList.remove('muted');
    toggleCamBtn.classList.remove('active');
    toggleScreenShareBtn.classList.remove('active');
    localLiveBadge.classList.add('hidden');
    remoteLiveBadge.classList.add('hidden');

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

    const reactionsDiv = document.createElement('div');
    reactionsDiv.className = 'reaction-pills';

    contentWrapper.appendChild(sender);
    contentWrapper.appendChild(bubble);
    contentWrapper.appendChild(reactionsDiv);

    group.appendChild(avatar);
    group.appendChild(contentWrapper);

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
      // AudioContext
    }
  }
});

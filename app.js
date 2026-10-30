// RemoteDroid - Samsung M52 WebRTC Controller Engine
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getDatabase, ref, set, onValue, push, remove, get } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js';

// Default Firebase Configuration (Can be customized via Settings Modal)
// Default points to public high-availability demo RTDB or user's project
const DEFAULT_FIREBASE_CONFIG = {
  databaseURL: "https://flex-29864-default-rtdb.firebaseio.com"
};

// WebRTC Dual-ICE Configuration (Auto-Switching Architecture)
const RTC_CONFIG = {
  iceServers: [
    // 1. Google Public STUN (Unlimited Direct P2P)
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    // 2. OpenRelay / Metered TURNS on Port 443 (Firewall Bypass)
    {
      urls: [
        'turn:openrelay.metered.ca:443?transport=tcp',
        'turns:openrelay.metered.ca:443?transport=tcp'
      ],
      username: 'openrelayproject',
      credential: 'openrelayproject'
    }
  ],
  iceCandidatePoolSize: 10
};

// State Variables
let app, db;
let peerConnection = null;
let dataChannel = null;
let roomId = localStorage.getItem('rd_room_id') || 'm52-mihir-secure';
let secretPin = localStorage.getItem('rd_pin') || '1234';
let customDbUrl = localStorage.getItem('rd_db_url') || DEFAULT_FIREBASE_CONFIG.databaseURL;

let isMouseDown = false;
let statsInterval = null;
let lastBytesReceived = 0;
let lastStatsTime = 0;

// DOM Elements
const connectionDot = document.getElementById('connectionDot');
const connectionStatus = document.getElementById('connectionStatus');
const latencyStat = document.getElementById('latencyStat');
const fpsStat = document.getElementById('fpsStat');
const bitrateStat = document.getElementById('bitrateStat');
const iceMode = document.getElementById('iceMode');
const routeBadge = document.getElementById('routeBadge');
const routeDesc = document.getElementById('routeDesc');

const remoteVideo = document.getElementById('remoteVideo');
const placeholderOverlay = document.getElementById('placeholderOverlay');
const placeholderMsg = document.getElementById('placeholderMsg');
const touchPointer = document.getElementById('touchPointer');
const videoContainer = document.getElementById('videoContainer');

// Buttons
const btnConnectNow = document.getElementById('btnConnectNow');
const btnWakeUp = document.getElementById('btnWakeUp');
const btnSettings = document.getElementById('btnSettings');
const btnBack = document.getElementById('btnBack');
const btnHome = document.getElementById('btnHome');
const btnRecents = document.getElementById('btnRecents');
const btnNotifications = document.getElementById('btnNotifications');
const btnVolUp = document.getElementById('btnVolUp');
const btnVolDown = document.getElementById('btnVolDown');
const btnLockScreen = document.getElementById('btnLockScreen');
const btnFullscreen = document.getElementById('btnFullscreen');
const btnSendText = document.getElementById('btnSendText');
const directTextInput = document.getElementById('directTextInput');

// Modal Elements
const configModal = document.getElementById('configModal');
const btnCloseModal = document.getElementById('btnCloseModal');
const btnCancelConfig = document.getElementById('btnCancelConfig');
const btnSaveConfig = document.getElementById('btnSaveConfig');
const inputRoomId = document.getElementById('inputRoomId');
const inputPin = document.getElementById('inputPin');
const inputFirebaseUrl = document.getElementById('inputFirebaseUrl');

// 1. Initialize Firebase
function initFirebase() {
  try {
    const config = { databaseURL: customDbUrl };
    app = initializeApp(config);
    db = getDatabase(app);
    console.log('[RemoteDroid] Firebase initialized with URL:', customDbUrl);
  } catch (err) {
    console.error('[RemoteDroid] Firebase Init Error:', err);
  }
}

// 2. Start WebRTC Connection
async function startConnection() {
  updateStatus('connecting', 'Negotiating Handshake...');
  placeholderMsg.innerText = 'Sending wake-up signal & connecting to phone...';

  // Cleanup old connection if any
  if (peerConnection) {
    peerConnection.close();
    peerConnection = null;
  }

  // A. Create RTCPeerConnection with Dual ICE
  peerConnection = new RTCPeerConnection(RTC_CONFIG);

  // B. Setup DataChannel for Touch & Keyboard
  dataChannel = peerConnection.createDataChannel('control', {
    ordered: true
  });
  setupDataChannel(dataChannel);

  // C. Video Stream Receiver
  peerConnection.ontrack = (event) => {
    console.log('[RemoteDroid] Video stream received from Samsung M52!');
    if (event.streams && event.streams[0]) {
      remoteVideo.srcObject = event.streams[0];
      placeholderOverlay.style.display = 'none';
      updateStatus('connected', 'Live - Samsung M52 5G');
      startMetricsMonitor();
    }
  };

  // D. ICE Candidate Handling
  peerConnection.onicecandidate = (event) => {
    if (event.candidate) {
      console.log('[RemoteDroid] Local ICE Candidate generated:', event.candidate.type);
      const candidatesRef = ref(db, `rooms/${roomId}/candidates/browser`);
      push(candidatesRef, JSON.stringify(event.candidate));
    }
  };

  // E. ICE Connection State Monitoring (Detects STUN vs TURNS auto-switch)
  peerConnection.oniceconnectionstatechange = () => {
    console.log('[RemoteDroid] ICE Connection State:', peerConnection.iceConnectionState);
    if (peerConnection.iceConnectionState === 'connected' || peerConnection.iceConnectionState === 'completed') {
      inspectActiveConnection();
    } else if (peerConnection.iceConnectionState === 'failed' || peerConnection.iceConnectionState === 'disconnected') {
      updateStatus('offline', 'Disconnected');
      placeholderOverlay.style.display = 'flex';
      placeholderMsg.innerText = 'Connection lost. Reconnecting...';
    }
  };

  // F. Create SDP Offer
  try {
    const offer = await peerConnection.createOffer({
      offerToReceiveVideo: true,
      offerToReceiveAudio: false
    });
    await peerConnection.setLocalDescription(offer);

    // Clean old session data before starting fresh handshake
    await remove(ref(db, `rooms/${roomId}/candidates`));
    await remove(ref(db, `rooms/${roomId}/answer`));

    // G. Push Offer to Firebase Realtime Database
    const roomRef = ref(db, `rooms/${roomId}`);
    await set(roomRef, {
      offer: {
        type: offer.type,
        sdp: offer.sdp,
        pin: secretPin,
        timestamp: Date.now()
      },
      wakeup: Date.now() // Signals phone to wake up screen!
    });

    console.log('[RemoteDroid] Offer published to Firebase. Waiting for Phone answer...');

    // H. Listen for Phone's Answer in Firebase
    const answerRef = ref(db, `rooms/${roomId}/answer`);
    onValue(answerRef, async (snapshot) => {
      const data = snapshot.val();
      if (data && !peerConnection.currentRemoteDescription) {
        console.log('[RemoteDroid] Answer received from phone!');
        const remoteDesc = new RTCSessionDescription(data);
        await peerConnection.setRemoteDescription(remoteDesc);
      }
    });

    // I. Listen for Phone's ICE Candidates in Firebase
    const phoneCandidatesRef = ref(db, `rooms/${roomId}/candidates/phone`);
    onValue(phoneCandidatesRef, (snapshot) => {
      snapshot.forEach((child) => {
        const candidateData = child.val();
        try {
          const candidateObj = typeof candidateData === 'string' ? JSON.parse(candidateData) : candidateData;
          if (candidateObj && candidateObj.candidate) {
            const candidate = new RTCIceCandidate(candidateObj);
            peerConnection.addIceCandidate(candidate);
          }
        } catch (e) {
          console.warn('ICE add candidate error:', e);
        }
      });
    });

  } catch (err) {
    console.error('[RemoteDroid] Connection handshake failed:', err);
    updateStatus('offline', 'Handshake Error');
    placeholderMsg.innerText = 'Handshake failed: ' + err.message;
  }
}

// 3. Setup DataChannel
function setupDataChannel(channel) {
  channel.onopen = () => {
    console.log('[RemoteDroid] DataChannel Open! Ready for touch/keyboard inputs.');
    // Start Ping-Pong for real-time latency calculation
    setInterval(() => {
      if (channel.readyState === 'open') {
        channel.send(JSON.stringify({ type: 'ping', t: Date.now() }));
      }
    }, 2000);
  };

  channel.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.type === 'pong') {
        const rtt = Date.now() - msg.t;
        latencyStat.innerText = `${rtt} ms`;
      }
    } catch (e) {
      // Non-json message
    }
  };

  channel.onclose = () => {
    console.log('[RemoteDroid] DataChannel closed.');
  };
}

// 4. Send Control Packets
function sendControlPacket(payload) {
  if (dataChannel && dataChannel.readyState === 'open') {
    dataChannel.send(JSON.stringify(payload));
  } else {
    console.warn('[RemoteDroid] DataChannel not ready, packet dropped:', payload.type);
  }
}

// 5. Wake Phone Screen Remotely (via Firebase trigger)
async function triggerRemoteWakeUp() {
  console.log('[RemoteDroid] Sending physical wake-up trigger to Phone...');
  btnWakeUp.innerText = '⚡ Waking...';
  try {
    const wakeupRef = ref(db, `rooms/${roomId}/wakeup`);
    await set(wakeupRef, Date.now());
    setTimeout(() => { btnWakeUp.innerText = '💡 Wake Phone'; }, 1500);
  } catch (e) {
    console.error('Failed to trigger wakeup:', e);
    btnWakeUp.innerText = '💡 Wake Phone';
  }
}

// 6. Inspect Active Connection Type (STUN P2P vs TURNS Port 443)
async function inspectActiveConnection() {
  if (!peerConnection) return;
  const stats = await peerConnection.getStats();
  stats.forEach(report => {
    if (report.type === 'candidate-pair' && report.state === 'succeeded') {
      stats.forEach(r => {
        if (r.id === report.remoteCandidateId) {
          if (r.candidateType === 'relay') {
            iceMode.innerText = 'TURNS (443)';
            routeBadge.innerText = 'TURNS (TLS 443)';
            routeBadge.style.color = '#ffb300';
            routeDesc.innerText = 'Corporate Firewall Bypass Active (Port 443 Encrypted Tunnel)';
          } else {
            iceMode.innerText = 'STUN (P2P)';
            routeBadge.innerText = 'STUN (Direct P2P)';
            routeBadge.style.color = '#00e676';
            routeDesc.innerText = 'Direct High-Speed P2P (Lowest possible latency, zero relay)';
          }
        }
      });
    }
  });
}

// 7. Live Performance Metrics (FPS & Bitrate Monitor)
function startMetricsMonitor() {
  if (statsInterval) clearInterval(statsInterval);
  statsInterval = setInterval(async () => {
    if (!peerConnection) return;
    const stats = await peerConnection.getStats();
    stats.forEach(report => {
      if (report.type === 'inbound-rtp' && report.kind === 'video') {
        const now = report.timestamp;
        const bytes = report.bytesReceived;
        if (lastStatsTime > 0) {
          const bitrate = Math.round((8 * (bytes - lastBytesReceived)) / (now - lastStatsTime));
          bitrateStat.innerText = `${bitrate} Kbps`;
        }
        lastBytesReceived = bytes;
        lastStatsTime = now;

        if (report.framesPerSecond !== undefined) {
          fpsStat.innerText = `${report.framesPerSecond} FPS`;
        }
      }
    });
  }, 1000);
}

// 8. Virtual Touch & Mouse Coordinate Mapper (Zero-Lag Gestures)
function getNormalizedCoordinates(e) {
  const rect = remoteVideo.getBoundingClientRect();
  const clientX = e.clientX || (e.touches && e.touches[0].clientX);
  const clientY = e.clientY || (e.touches && e.touches[0].clientY);

  const x = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  const y = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));

  return { x: parseFloat(x.toFixed(4)), y: parseFloat(y.toFixed(4)), rawX: clientX - rect.left, rawY: clientY - rect.top };
}

// Mouse Event Listeners on Phone Screen
videoContainer.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return; // Only left click
  isMouseDown = true;
  const coords = getNormalizedCoordinates(e);

  // Show visual pointer
  touchPointer.style.left = `${coords.rawX}px`;
  touchPointer.style.top = `${coords.rawY}px`;
  touchPointer.classList.add('active');

  sendControlPacket({
    type: 'touch_down',
    x: coords.x,
    y: coords.y
  });
});

window.addEventListener('mousemove', (e) => {
  if (!isMouseDown) return;
  const coords = getNormalizedCoordinates(e);

  touchPointer.style.left = `${coords.rawX}px`;
  touchPointer.style.top = `${coords.rawY}px`;

  sendControlPacket({
    type: 'touch_move',
    x: coords.x,
    y: coords.y
  });
});

window.addEventListener('mouseup', (e) => {
  if (!isMouseDown) return;
  isMouseDown = false;
  const coords = getNormalizedCoordinates(e);
  touchPointer.classList.remove('active');

  sendControlPacket({
    type: 'touch_up',
    x: coords.x,
    y: coords.y
  });
});

// Right click = Android Back button
videoContainer.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  sendControlPacket({ type: 'key_action', action: 'BACK' });
});

// Mouse wheel = Scroll up/down gesture
videoContainer.addEventListener('wheel', (e) => {
  e.preventDefault();
  const coords = getNormalizedCoordinates(e);
  const direction = e.deltaY > 0 ? 'SCROLL_DOWN' : 'SCROLL_UP';
  sendControlPacket({
    type: 'scroll',
    direction: direction,
    x: coords.x,
    y: coords.y
  });
}, { passive: false });

// 9. Keyboard Typing Listener (Types into phone)
window.addEventListener('keydown', (e) => {
  // If typing inside an input field in the web UI, don't capture
  if (e.target.tagName === 'INPUT') return;

  if (e.key === 'Backspace') {
    e.preventDefault();
    sendControlPacket({ type: 'key_action', action: 'BACKSPACE' });
  } else if (e.key === 'Enter') {
    e.preventDefault();
    sendControlPacket({ type: 'key_action', action: 'ENTER' });
  } else if (e.key.length === 1) {
    // Normal single letter/digit typing
    sendControlPacket({ type: 'text_input', text: e.key });
  }
});

// 10. Navigation Buttons
btnBack.addEventListener('click', () => sendControlPacket({ type: 'key_action', action: 'BACK' }));
btnHome.addEventListener('click', () => sendControlPacket({ type: 'key_action', action: 'HOME' }));
btnRecents.addEventListener('click', () => sendControlPacket({ type: 'key_action', action: 'RECENTS' }));
btnNotifications.addEventListener('click', () => sendControlPacket({ type: 'key_action', action: 'NOTIFICATIONS' }));
btnVolUp.addEventListener('click', () => sendControlPacket({ type: 'key_action', action: 'VOLUME_UP' }));
btnVolDown.addEventListener('click', () => sendControlPacket({ type: 'key_action', action: 'VOLUME_DOWN' }));
btnLockScreen.addEventListener('click', () => sendControlPacket({ type: 'key_action', action: 'LOCK' }));

// Fullscreen
btnFullscreen.addEventListener('click', () => {
  if (!document.fullscreenElement) {
    videoContainer.requestFullscreen().catch(err => alert(err.message));
  } else {
    document.exitFullscreen();
  }
});

// Direct Text Injection (Clipboard/Long text)
btnSendText.addEventListener('click', () => {
  const text = directTextInput.value.trim();
  if (text) {
    sendControlPacket({ type: 'text_input', text: text });
    directTextInput.value = '';
  }
});

// Wake Phone
btnWakeUp.addEventListener('click', triggerRemoteWakeUp);
btnConnectNow.addEventListener('click', startConnection);

// Helper Status Updater
function updateStatus(state, text) {
  connectionStatus.innerText = text;
  if (state === 'connected') {
    connectionDot.className = 'status-dot online';
  } else if (state === 'connecting') {
    connectionDot.className = 'status-dot';
    connectionDot.style.background = '#ffb300';
    connectionDot.style.boxShadow = '0 0 8px rgba(255, 179, 0, 0.6)';
  } else {
    connectionDot.className = 'status-dot offline';
    latencyStat.innerText = '0 ms';
    fpsStat.innerText = '0 FPS';
    bitrateStat.innerText = '0 Kbps';
    iceMode.innerText = '--';
  }
}

// Config Modal Handlers
btnSettings.addEventListener('click', () => {
  inputRoomId.value = roomId;
  inputPin.value = secretPin;
  inputFirebaseUrl.value = customDbUrl;
  configModal.classList.add('open');
});

btnCloseModal.addEventListener('click', () => configModal.classList.remove('open'));
btnCancelConfig.addEventListener('click', () => configModal.classList.remove('open'));

btnSaveConfig.addEventListener('click', () => {
  roomId = inputRoomId.value.trim() || 'm52-mihir-secure';
  secretPin = inputPin.value.trim() || '1234';
  if (inputFirebaseUrl.value.trim()) {
    customDbUrl = inputFirebaseUrl.value.trim();
  }

  localStorage.setItem('rd_room_id', roomId);
  localStorage.setItem('rd_pin', secretPin);
  localStorage.setItem('rd_db_url', customDbUrl);

  configModal.classList.remove('open');
  initFirebase();
  startConnection();
});

// Init on Page Load
initFirebase();
console.log('[RemoteDroid] Web Client loaded successfully.');

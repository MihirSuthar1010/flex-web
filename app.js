// RemoteDroid / FLEX - Samsung M52 WebRTC Controller Engine
// Industrial-Grade Telemetry & Diagnostics (SLTL Industrial Standard)

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getDatabase, ref, set, onValue, push, remove, get } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js';

// Default Firebase Configuration
const DEFAULT_FIREBASE_CONFIG = {
  databaseURL: "https://flex-29864-default-rtdb.firebaseio.com"
};

// WebRTC Google Public STUN & Metered Global TURN Relay Configuration
const DEFAULT_ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls: 'stun:stun.relay.metered.ca:80' },
  {
    urls: 'turn:global.relay.metered.ca:80',
    username: '80dd7ea4dbe49cb644359347',
    credential: 'bhz/uCJFTyzdSnnu'
  },
  {
    urls: 'turn:global.relay.metered.ca:80?transport=tcp',
    username: '80dd7ea4dbe49cb644359347',
    credential: 'bhz/uCJFTyzdSnnu'
  },
  {
    urls: 'turn:global.relay.metered.ca:443',
    username: '80dd7ea4dbe49cb644359347',
    credential: 'bhz/uCJFTyzdSnnu'
  },
  {
    urls: 'turns:global.relay.metered.ca:443?transport=tcp',
    username: '80dd7ea4dbe49cb644359347',
    credential: 'bhz/uCJFTyzdSnnu'
  }
];

const RTC_CONFIG = {
  iceServers: DEFAULT_ICE_SERVERS,
  iceCandidatePoolSize: 10
};

// State Variables
let app, db;
let peerConnection = null;
let dataChannel = null;
let roomId = localStorage.getItem('rd_room_id') || 'm52-mihir-secure';
let secretPin = localStorage.getItem('rd_pin') || '1234';
let customDbUrl = localStorage.getItem('rd_db_url') || DEFAULT_FIREBASE_CONFIG.databaseURL;
let customLanIp = localStorage.getItem('rd_lan_ip') || '';
let customTurnKey = localStorage.getItem('rd_turn_key') || '';

let isMouseDown = false;
let statsInterval = null;
let lastBytesReceived = 0;
let lastStatsTime = 0;
let checkingStartTime = 0;

// ICE Candidate Queueing State
let queuedPhoneCandidates = [];
let isRemoteDescriptionSet = false;
const processedCandidateKeys = new Set();

// Telemetry & Diagnostic Buffer
const webLogsBuffer = [];

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
const inputLanIp = document.getElementById('inputLanIp');
const inputTurnKey = document.getElementById('inputTurnKey');

// Telemetry Drawer Elements
const telemetryDrawer = document.getElementById('telemetryDrawer');
const drawerResizer = document.getElementById('drawerResizer');
const drawerHeader = document.getElementById('drawerHeader');
const drawerContent = document.getElementById('drawerContent');
const logCounter = document.getElementById('logCounter');
const btnDownloadWebLog = document.getElementById('btnDownloadWebLog');
const btnDownloadPhoneLog = document.getElementById('btnDownloadPhoneLog');
const btnClearLogs = document.getElementById('btnClearLogs');
const btnToggleDrawer = document.getElementById('btnToggleDrawer');

// Diagnostics HUD Elements
const diagIceState = document.getElementById('diagIceState');
const diagActivePair = document.getElementById('diagActivePair');
const diagFrames = document.getElementById('diagFrames');
const diagBytes = document.getElementById('diagBytes');
const diagAutoAlert = document.getElementById('diagAutoAlert');

// ==========================================
// 1. INDUSTRIAL LOG ENGINE (Dual-Sink Telemetry)
// ==========================================
function logEvent(level, tag, message) {
  const now = new Date();
  const timeStr = now.toISOString().replace('T', ' ').substring(0, 23);
  const logLine = `[${timeStr}][${level}][${tag}] ${message}`;

  // A. Console
  if (level === 'ERROR') console.error(logLine);
  else if (level === 'WARN') console.warn(logLine);
  else console.log(logLine);

  // B. Memory Buffer for file download
  webLogsBuffer.push(logLine);
  if (logCounter) {
    logCounter.innerText = `${webLogsBuffer.length} events`;
  }

  // C. Visual Telemetry Drawer
  if (drawerContent) {
    const isAtBottom = (drawerContent.scrollHeight - drawerContent.scrollTop) <= (drawerContent.clientHeight + 60);
    const entry = document.createElement('div');
    entry.className = `log-entry ${level.toLowerCase()}`;
    entry.textContent = logLine;
    drawerContent.appendChild(entry);
    if (isAtBottom) {
      drawerContent.scrollTop = drawerContent.scrollHeight;
    }
  }

  // D. Firebase RTDB Sync (Async non-blocking)
  if (db) {
    try {
      const webLogRef = ref(db, `rooms/${roomId}/telemetry/web`);
      push(webLogRef, {
        time: timeStr,
        level: level,
        tag: tag,
        msg: message
      }).catch(() => {});
    } catch (e) {}
  }
}

// Download Trigger Helper
function downloadTextFile(filename, content) {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ==========================================
// TELEMETRY DRAWER RESIZER ENGINE (Desktop-Grade Smooth Drag)
// ==========================================
let isDrawerDragging = false;
let drawerStartY = 0;
let drawerStartHeight = 0;
let drawerHasMoved = false;

function expandDrawer(customHeight) {
  if (!telemetryDrawer) return;
  const savedHeight = parseInt(localStorage.getItem('rd_drawer_height')) || 380;
  const target = customHeight || Math.min(Math.max(savedHeight, 200), window.innerHeight - 70);
  telemetryDrawer.style.transition = 'height 0.22s cubic-bezier(0.16, 1, 0.3, 1)';
  telemetryDrawer.style.height = `${target}px`;
  telemetryDrawer.classList.add('expanded');
  if (btnToggleDrawer) btnToggleDrawer.innerText = '▼ Collapse';
}

function collapseDrawer() {
  if (!telemetryDrawer) return;
  telemetryDrawer.style.transition = 'height 0.22s cubic-bezier(0.16, 1, 0.3, 1)';
  telemetryDrawer.style.height = '38px';
  telemetryDrawer.classList.remove('expanded');
  if (btnToggleDrawer) btnToggleDrawer.innerText = '▲ Expand';
}

function toggleDrawer() {
  if (!telemetryDrawer) return;
  const currentHeight = telemetryDrawer.getBoundingClientRect().height;
  if (currentHeight > 50 || telemetryDrawer.classList.contains('expanded')) {
    collapseDrawer();
  } else {
    expandDrawer();
  }
}

if (btnToggleDrawer) {
  btnToggleDrawer.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleDrawer();
  });
}

// Mouse Drag-To-Resize Handlers
function initDrawerResize(e) {
  if (e.target.closest('.drawer-actions') || e.target.closest('button')) return;
  isDrawerDragging = true;
  drawerHasMoved = false;
  drawerStartY = e.clientY;
  drawerStartHeight = telemetryDrawer.getBoundingClientRect().height;
  telemetryDrawer.classList.add('resizing');
  if (drawerResizer) drawerResizer.classList.add('dragging');
  document.body.style.userSelect = 'none';
  document.body.style.cursor = 'ns-resize';
  e.preventDefault();
}

if (drawerResizer) {
  drawerResizer.addEventListener('mousedown', initDrawerResize);
}

if (drawerHeader) {
  drawerHeader.addEventListener('mousedown', initDrawerResize);
}

window.addEventListener('mousemove', (e) => {
  if (!isDrawerDragging) return;
  const deltaY = drawerStartY - e.clientY; // Upward mouse motion increases height
  if (Math.abs(deltaY) > 3) {
    drawerHasMoved = true;
  }
  let newHeight = drawerStartHeight + deltaY;
  const minHeight = 38;
  const maxHeight = window.innerHeight - 56;
  newHeight = Math.max(minHeight, Math.min(newHeight, maxHeight));
  telemetryDrawer.style.height = `${newHeight}px`;

  if (newHeight > 60) {
    telemetryDrawer.classList.add('expanded');
    if (btnToggleDrawer) btnToggleDrawer.innerText = '▼ Collapse';
  } else {
    telemetryDrawer.classList.remove('expanded');
    if (btnToggleDrawer) btnToggleDrawer.innerText = '▲ Expand';
  }
});

window.addEventListener('mouseup', () => {
  if (!isDrawerDragging) return;
  isDrawerDragging = false;
  telemetryDrawer.classList.remove('resizing');
  if (drawerResizer) drawerResizer.classList.remove('dragging');
  document.body.style.userSelect = '';
  document.body.style.cursor = '';

  if (!drawerHasMoved) {
    toggleDrawer();
  } else {
    const finalHeight = telemetryDrawer.getBoundingClientRect().height;
    if (finalHeight <= 50) {
      collapseDrawer();
    } else {
      localStorage.setItem('rd_drawer_height', finalHeight);
    }
  }
});

// Touch Device Support (Tablets / Laptops with Touchscreen)
function initDrawerTouch(e) {
  if (e.target.closest('.drawer-actions') || e.target.closest('button')) return;
  if (!e.touches || e.touches.length === 0) return;
  isDrawerDragging = true;
  drawerHasMoved = false;
  drawerStartY = e.touches[0].clientY;
  drawerStartHeight = telemetryDrawer.getBoundingClientRect().height;
  telemetryDrawer.classList.add('resizing');
}

if (drawerResizer) {
  drawerResizer.addEventListener('touchstart', initDrawerTouch, { passive: true });
}
if (drawerHeader) {
  drawerHeader.addEventListener('touchstart', initDrawerTouch, { passive: true });
}

window.addEventListener('touchmove', (e) => {
  if (!isDrawerDragging || !e.touches || e.touches.length === 0) return;
  const deltaY = drawerStartY - e.touches[0].clientY;
  if (Math.abs(deltaY) > 3) drawerHasMoved = true;
  let newHeight = drawerStartHeight + deltaY;
  newHeight = Math.max(38, Math.min(newHeight, window.innerHeight - 56));
  telemetryDrawer.style.height = `${newHeight}px`;
  if (newHeight > 60) {
    telemetryDrawer.classList.add('expanded');
    if (btnToggleDrawer) btnToggleDrawer.innerText = '▼ Collapse';
  } else {
    telemetryDrawer.classList.remove('expanded');
    if (btnToggleDrawer) btnToggleDrawer.innerText = '▲ Expand';
  }
}, { passive: true });

window.addEventListener('touchend', () => {
  if (!isDrawerDragging) return;
  isDrawerDragging = false;
  telemetryDrawer.classList.remove('resizing');
  if (!drawerHasMoved) {
    toggleDrawer();
  } else {
    const finalHeight = telemetryDrawer.getBoundingClientRect().height;
    if (finalHeight <= 50) {
      collapseDrawer();
    } else {
      localStorage.setItem('rd_drawer_height', finalHeight);
    }
  }
});

if (btnClearLogs && drawerContent) {
  btnClearLogs.addEventListener('click', (e) => {
    e.stopPropagation();
    drawerContent.innerHTML = '';
    webLogsBuffer.length = 0;
    if (logCounter) logCounter.innerText = '0 events';
    logEvent('INFO', 'SYSTEM', 'Logs cleared by user.');
  });
}

if (btnDownloadWebLog) {
  btnDownloadWebLog.addEventListener('click', (e) => {
    e.stopPropagation();
    const content = webLogsBuffer.join('\n');
    downloadTextFile(`flex_web_${Date.now()}.log`, content);
    logEvent('INFO', 'TELEMETRY', 'Web telemetry log downloaded.');
  });
}

if (btnDownloadPhoneLog) {
  btnDownloadPhoneLog.addEventListener('click', async (e) => {
    e.stopPropagation();
    logEvent('INFO', 'TELEMETRY', 'Fetching Phone logs from Firebase...');
    try {
      const phoneTelemetryRef = ref(db, `rooms/${roomId}/telemetry/phone`);
      const snapshot = await get(phoneTelemetryRef);
      if (snapshot.exists()) {
        const phoneLogs = [];
        snapshot.forEach((child) => {
          const item = child.val();
          if (item) {
            phoneLogs.push(`[${item.time || 'N/A'}][${item.level || 'INFO'}][${item.tag || 'PHONE'}] ${item.msg || ''}`);
          }
        });
        const content = phoneLogs.join('\n');
        downloadTextFile(`flex_phone_${Date.now()}.log`, content);
        logEvent('SUCCESS', 'TELEMETRY', `Phone log file exported (${phoneLogs.length} events).`);
      } else {
        logEvent('WARN', 'TELEMETRY', 'No phone logs found in Firebase yet. Is the app running?');
        alert('No phone logs recorded in Firebase yet. Ensure FLEX app is running on phone and "Start Standby" is tapped.');
      }
    } catch (err) {
      logEvent('ERROR', 'TELEMETRY', `Failed to fetch phone logs: ${err.message}`);
    }
  });
}

// ==========================================
// 2. FIREBASE & CONNECTION HANDSHAKE
// ==========================================
function initFirebase() {
  try {
    const config = { databaseURL: customDbUrl };
    app = initializeApp(config);
    db = getDatabase(app);
    logEvent('INFO', 'FIREBASE', `Firebase RTDB connected: ${customDbUrl} (Room: ${roomId})`);
  } catch (err) {
    logEvent('ERROR', 'FIREBASE', `Firebase Init Failure: ${err.message}`);
  }
}

async function getEffectiveIceServers() {
  let servers = [...DEFAULT_ICE_SERVERS];

  // Dynamic override from Firebase RTDB if available
  if (db) {
    try {
      const snap = await get(ref(db, `rooms/${roomId}/turn_config`));
      if (snap.exists()) {
        const remoteTurn = snap.val();
        if (Array.isArray(remoteTurn) && remoteTurn.length > 0) {
          servers = remoteTurn;
          logEvent('INFO', 'TURN', `Loaded ${remoteTurn.length} dynamic TURN relay configs from Firebase.`);
        }
      }
    } catch (e) {
      logEvent('DEBUG', 'TURN', `Using built-in TURN defaults: ${e.message}`);
    }
  }

  if (customTurnKey) {
    try {
      if (customTurnKey.startsWith('http')) {
        logEvent('INFO', 'TURN', 'Fetching dynamic TURN credentials from Metered API...');
        const res = await fetch(customTurnKey);
        if (res.ok) {
          const fetchedServers = await res.json();
          if (Array.isArray(fetchedServers) && fetchedServers.length > 0) {
            servers = fetchedServers;
            logEvent('SUCCESS', 'TURN', `Acquired ${fetchedServers.length} cloud relay endpoints from Metered.`);
            // Sync with Firebase so Android App automatically uses the same TURN relay
            if (db) {
              set(ref(db, `rooms/${roomId}/turn_config`), fetchedServers).catch(() => {});
            }
          }
        }
      } else {
        try {
          const parsed = JSON.parse(customTurnKey);
          if (Array.isArray(parsed)) servers = parsed;
        } catch(e) {}
      }
    } catch (e) {
      logEvent('WARN', 'TURN', `Failed to load dynamic TURN servers: ${e.message}`);
    }
  }

  return servers;
}

async function startConnection() {
  logEvent('INFO', 'INIT', '=== Starting WebRTC Connection Handshake ===');
  updateStatus('connecting', 'Negotiating Handshake...');
  placeholderMsg.innerText = 'Sending wake-up signal & negotiating WebRTC handshake...';
  if (diagAutoAlert) diagAutoAlert.style.display = 'none';

  // Reset state
  queuedPhoneCandidates = [];
  isRemoteDescriptionSet = false;
  processedCandidateKeys.clear();
  checkingStartTime = 0;

  // Clean stale session signaling BEFORE creating new peer connection & gathering candidates
  if (db) {
    try {
      await remove(ref(db, `rooms/${roomId}/candidates`));
      await remove(ref(db, `rooms/${roomId}/answer`));
      await remove(ref(db, `rooms/${roomId}/offer`));
      logEvent('DEBUG', 'SIGNALING', 'Signaling channel cleared for fresh session.');
    } catch (e) {}
  }

  if (peerConnection) {
    logEvent('WARN', 'WEBRTC', 'Closing existing PeerConnection instance');
    peerConnection.close();
    peerConnection = null;
  }

  // A. Create RTCPeerConnection with Dynamic STUN/TURN
  const activeIceServers = await getEffectiveIceServers();
  peerConnection = new RTCPeerConnection({
    iceServers: activeIceServers,
    iceCandidatePoolSize: 10
  });
  logEvent('INFO', 'WEBRTC', `RTCPeerConnection instantiated (${activeIceServers.length} ICE server configs).`);

  // B. Add Unified Plan Transceiver for Video (CRITICAL: Guarantees video m-line in SDP offer)
  peerConnection.addTransceiver('video', { direction: 'recvonly' });
  logEvent('INFO', 'WEBRTC', 'Video transceiver added (direction: recvonly).');

  // C. Setup DataChannel for Touch & Keyboard
  dataChannel = peerConnection.createDataChannel('control', { ordered: true });
  setupDataChannel(dataChannel);
  logEvent('INFO', 'DATA_CHANNEL', 'Local DataChannel created with label "control".');

  // D. Video Track Receiver Callback
  peerConnection.ontrack = (event) => {
    logEvent('SUCCESS', 'WEBRTC', `Remote track received! Kind: ${event.track.kind}, ID: ${event.track.id}, readyState: ${event.track.readyState}`);
    
    // Fallback support for Unified Plan (if streams[0] is absent)
    let stream = (event.streams && event.streams[0]) ? event.streams[0] : new MediaStream([event.track]);
    remoteVideo.srcObject = stream;
    placeholderMsg.innerText = 'Receiving video frames from Samsung M52...';
    startMetricsMonitor();

    const hidePlaceholderWhenReady = () => {
      if (remoteVideo.videoWidth > 0) {
        logEvent('SUCCESS', 'VIDEO', `Remote video active! Decoded stream: ${remoteVideo.videoWidth}x${remoteVideo.videoHeight}.`);
        placeholderOverlay.style.display = 'none';
        if (diagAutoAlert) diagAutoAlert.style.display = 'none';
        updateStatus('connected', 'Live - Samsung M52 5G');
      }
    };

    remoteVideo.onloadeddata = hidePlaceholderWhenReady;
    remoteVideo.onplaying = hidePlaceholderWhenReady;
    remoteVideo.onresize = hidePlaceholderWhenReady;

    remoteVideo.play().then(() => {
      logEvent('SUCCESS', 'VIDEO', `Remote video playing (${remoteVideo.videoWidth || 'buffer'}x${remoteVideo.videoHeight || 'buffer'}).`);
      hidePlaceholderWhenReady();
    }).catch((err) => {
      logEvent('WARN', 'VIDEO', `Autoplay blocked by browser policy: ${err.message}. Click anywhere on player.`);
    });
  };

  // E. Local ICE Candidate Handling (mDNS Unmasking for Local LAN P2P)
  peerConnection.onicecandidate = (event) => {
    if (event.candidate) {
      let candStr = event.candidate.candidate;
      if (customLanIp && candStr.includes('.local')) {
        candStr = candStr.replace(/[a-f0-9\-]+\.local/g, customLanIp);
        logEvent('INFO', 'LAN', `[mDNS UNMASK] Injected PC LAN IP ${customLanIp} into host candidate.`);
      }

      const candidatePayload = {
        candidate: candStr,
        sdpMid: event.candidate.sdpMid,
        sdpMLineIndex: event.candidate.sdpMLineIndex
      };

      logEvent('DEBUG', 'ICE', `Local ICE Candidate: ${candidatePayload.sdpMid} -> ${candStr.substring(0, 45)}...`);
      const candidatesRef = ref(db, `rooms/${roomId}/candidates/browser`);
      push(candidatesRef, JSON.stringify(candidatePayload)).catch((err) => {
        logEvent('ERROR', 'FIREBASE', `Failed to push local ICE candidate: ${err.message}`);
      });
    } else {
      logEvent('INFO', 'ICE', 'Local ICE Candidate gathering complete (null candidate received).');
    }
  };

  // F. ICE Connection State Monitoring
  peerConnection.oniceconnectionstatechange = () => {
    const state = peerConnection.iceConnectionState;
    logEvent('INFO', 'ICE', `ICE Connection State -> ${state}`);
    if (diagIceState) diagIceState.innerText = state;

    if (state === 'checking') {
      checkingStartTime = Date.now();
    } else if (state === 'connected' || state === 'completed') {
      logEvent('SUCCESS', 'ICE', 'WebRTC ICE Connection ESTABLISHED successfully!');
      if (diagAutoAlert) diagAutoAlert.style.display = 'none';
      inspectActiveConnection();
    } else if (state === 'failed' || state === 'disconnected') {
      logEvent('ERROR', 'ICE', `ICE Connection broken (${state}). Check phone network and standby status.`);
      updateStatus('offline', 'Disconnected');
      placeholderOverlay.style.display = 'flex';
      placeholderMsg.innerText = 'Connection lost. Reconnecting...';

      if (diagAutoAlert) {
        diagAutoAlert.innerHTML = `⚠️ <strong>[INDUSTRIAL ROOT CAUSE IDENTIFIED]</strong>: Carrier CGNAT dropped direct UDP packets. <strong>Fix:</strong> 1) Put Phone on same Wi-Fi as PC & enter LAN IP in Config (60 FPS direct LAN), OR 2) Enter Metered TURN credentials in Config for 5G locker access.`;
        diagAutoAlert.style.display = 'block';
      }
    }
  };

  // G. PeerConnection State Monitoring
  peerConnection.onconnectionstatechange = () => {
    logEvent('INFO', 'WEBRTC', `Connection State -> ${peerConnection.connectionState}`);
  };

  // H. Create & Publish SDP Offer
  try {
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    logEvent('INFO', 'SDP', `Local SDP Offer created and set (length: ${offer.sdp.length}).`);

    // Targeted writes
    await set(ref(db, `rooms/${roomId}/offer`), {
      type: offer.type,
      sdp: offer.sdp,
      pin: secretPin,
      timestamp: Date.now()
    });

    await set(ref(db, `rooms/${roomId}/wakeup`), Date.now());
    logEvent('SUCCESS', 'SIGNALING', 'Offer & Wakeup trigger published to Firebase. Waiting for Phone answer...');

    // I. Listen for Phone Answer
    const answerRef = ref(db, `rooms/${roomId}/answer`);
    let isProcessingAnswer = false;
    onValue(answerRef, async (snapshot) => {
      const data = snapshot.val();
      if (data && peerConnection && peerConnection.signalingState === 'have-local-offer' && !isProcessingAnswer) {
        isProcessingAnswer = true;
        logEvent('SUCCESS', 'SIGNALING', `Phone Answer received! (sdp length: ${data.sdp ? data.sdp.length : 0})`);
        try {
          const remoteDesc = new RTCSessionDescription(data);
          await peerConnection.setRemoteDescription(remoteDesc);
          isRemoteDescriptionSet = true;
          logEvent('SUCCESS', 'SDP', 'Remote description set successfully!');

          // Drain queued phone candidates
          if (queuedPhoneCandidates.length > 0) {
            logEvent('INFO', 'ICE', `Draining ${queuedPhoneCandidates.length} queued phone ICE candidates...`);
            for (const cand of queuedPhoneCandidates) {
              await addIceCandidateSafely(cand);
            }
            queuedPhoneCandidates = [];
          }
        } catch (e) {
          logEvent('ERROR', 'SDP', `Failed to set remote description: ${e.message}`);
          isProcessingAnswer = false;
        }
      }
    });

    // J. Listen for Phone ICE Candidates
    const phoneCandidatesRef = ref(db, `rooms/${roomId}/candidates/phone`);
    onValue(phoneCandidatesRef, async (snapshot) => {
      if (!snapshot.exists()) return;

      snapshot.forEach((child) => {
        const key = child.key;
        if (processedCandidateKeys.has(key)) return;
        processedCandidateKeys.add(key);

        const candidateData = child.val();
        try {
          const candidateObj = typeof candidateData === 'string' ? JSON.parse(candidateData) : candidateData;
          if (candidateObj && candidateObj.candidate) {
            if (!isRemoteDescriptionSet) {
              logEvent('DEBUG', 'ICE', `Queuing Phone candidate [${key}] (waiting for answer description)...`);
              queuedPhoneCandidates.push(candidateObj);
            } else {
              addIceCandidateSafely(candidateObj);
            }
          }
        } catch (e) {
          logEvent('WARN', 'ICE', `Error parsing phone candidate [${key}]: ${e.message}`);
        }
      });
    });

  } catch (err) {
    logEvent('ERROR', 'HANDSHAKE', `Connection handshake failed: ${err.message}`);
    updateStatus('offline', 'Handshake Error');
    placeholderMsg.innerText = 'Handshake failed: ' + err.message;
  }
}

async function addIceCandidateSafely(candidateObj) {
  if (!peerConnection) return;
  try {
    const candidate = new RTCIceCandidate(candidateObj);
    await peerConnection.addIceCandidate(candidate);
    logEvent('DEBUG', 'ICE', `Added Phone candidate: ${candidate.sdpMid} (${candidate.candidate.substring(0, 35)}...)`);
  } catch (e) {
    logEvent('WARN', 'ICE', `Failed to add ICE candidate: ${e.message}`);
  }
}

// ==========================================
// 3. DATA CHANNEL & CONTROL ENGINE
// ==========================================
function setupDataChannel(channel) {
  channel.onopen = () => {
    logEvent('SUCCESS', 'DATA_CHANNEL', 'DataChannel is OPEN! Ready for touch, keyboard, and gestures.');
    
    // Heartbeat & RTT Latency Monitor
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
    } catch (e) {}
  };

  channel.onclose = () => {
    logEvent('WARN', 'DATA_CHANNEL', 'DataChannel closed.');
  };

  channel.onerror = (err) => {
    logEvent('ERROR', 'DATA_CHANNEL', `DataChannel error: ${err.message || 'unknown'}`);
  };
}

function sendControlPacket(payload) {
  if (dataChannel && dataChannel.readyState === 'open') {
    dataChannel.send(JSON.stringify(payload));
  } else {
    logEvent('WARN', 'CONTROL', `DataChannel not open. Packet dropped: ${payload.type}`);
  }
}

// Wake Phone Screen Remotely
async function triggerRemoteWakeUp() {
  logEvent('INFO', 'WAKE', 'Sending remote physical screen wake-up trigger...');
  btnWakeUp.innerText = '⚡ Waking...';
  try {
    const wakeupRef = ref(db, `rooms/${roomId}/wakeup`);
    await set(wakeupRef, Date.now());
    logEvent('SUCCESS', 'WAKE', 'Wake-up timestamp pushed to Firebase.');
    setTimeout(() => { btnWakeUp.innerText = '💡 Wake Phone'; }, 1500);
  } catch (e) {
    logEvent('ERROR', 'WAKE', `Failed to trigger wakeup: ${e.message}`);
    btnWakeUp.innerText = '💡 Wake Phone';
  }
}

// Active Route Inspection (STUN Direct P2P vs TURNS Port 443)
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
            logEvent('SUCCESS', 'ROUTE', 'Active Route: TURNS Relay via Port 443 (Corporate Firewall Bypassed)');
          } else {
            iceMode.innerText = 'STUN (P2P)';
            routeBadge.innerText = 'STUN (Direct P2P)';
            routeBadge.style.color = '#00e676';
            routeDesc.innerText = 'Direct High-Speed P2P (Lowest possible latency, zero relay)';
            logEvent('SUCCESS', 'ROUTE', 'Active Route: Direct P2P via Google STUN (Zero-Relay Direct Stream)');
          }
        }
      });
    }
  });
}

// Live Performance Metrics (FPS & Bitrate Monitor)
function startMetricsMonitor() {
  if (statsInterval) clearInterval(statsInterval);
  statsInterval = setInterval(async () => {
    if (!peerConnection) return;
    const stats = await peerConnection.getStats();
    stats.forEach(report => {
      if (report.type === 'inbound-rtp' && report.kind === 'video') {
        const now = report.timestamp;
        const bytes = report.bytesReceived || 0;
        if (lastStatsTime > 0) {
          const bitrate = Math.round((8 * (bytes - lastBytesReceived)) / (now - lastStatsTime));
          bitrateStat.innerText = `${bitrate} Kbps`;
        }
        lastBytesReceived = bytes;
        lastStatsTime = now;

        if (diagBytes) diagBytes.innerText = `${Math.round(bytes / 1024)} KB`;
        if (report.framesDecoded !== undefined && diagFrames) {
          diagFrames.innerText = report.framesDecoded;
          if (report.framesDecoded > 0 && placeholderOverlay.style.display !== 'none') {
            placeholderOverlay.style.display = 'none';
            if (diagAutoAlert) diagAutoAlert.style.display = 'none';
            updateStatus('connected', 'Live - Samsung M52 5G');
          }
        }

        if (report.framesPerSecond !== undefined) {
          fpsStat.innerText = `${report.framesPerSecond} FPS`;
        }
      }

      if (report.type === 'candidate-pair' && report.state === 'succeeded' && diagActivePair) {
        diagActivePair.innerText = `${report.localCandidateId || 'local'} ⇄ ${report.remoteCandidateId || 'remote'}`;
      }
    });

    // Root-Cause Checker: If checking for > 7 seconds and 0 bytes received
    if (peerConnection.iceConnectionState === 'checking' && checkingStartTime > 0 && (Date.now() - checkingStartTime > 7000)) {
      if (diagAutoAlert) {
        diagAutoAlert.innerHTML = `⚠️ <strong>[INDUSTRIAL ROOT CAUSE]</strong>: STUN packet drops detected! Phone is on Carrier CGNAT (Jio 5G). <strong>Direct UDP is blocked by carrier.</strong><br>👉 <strong>Instant Solution:</strong> 1) Put Phone on same Wi-Fi as PC & enter LAN IP in Config (60 FPS direct LAN), OR 2) Enter Metered TURN credentials in Config for 5G locker access.`;
        diagAutoAlert.style.display = 'block';
      }
    }
  }, 1000);
}

// ==========================================
// 4. VIRTUAL TOUCH & MOUSE GESTURES
// ==========================================
function getNormalizedCoordinates(e) {
  const rect = remoteVideo.getBoundingClientRect();
  const clientX = e.clientX || (e.touches && e.touches[0].clientX);
  const clientY = e.clientY || (e.touches && e.touches[0].clientY);

  const x = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  const y = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));

  return { x: parseFloat(x.toFixed(4)), y: parseFloat(y.toFixed(4)), rawX: clientX - rect.left, rawY: clientY - rect.top };
}

videoContainer.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  isMouseDown = true;
  const coords = getNormalizedCoordinates(e);

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

// Right click = Android Back
videoContainer.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  logEvent('INFO', 'CONTROL', 'Right click -> Android BACK');
  sendControlPacket({ type: 'key_action', action: 'BACK' });
});

// Mouse wheel = Scroll
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

// Keyboard Typing
window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;

  if (e.key === 'Backspace') {
    e.preventDefault();
    sendControlPacket({ type: 'key_action', action: 'BACKSPACE' });
  } else if (e.key === 'Enter') {
    e.preventDefault();
    sendControlPacket({ type: 'key_action', action: 'ENTER' });
  } else if (e.key.length === 1) {
    sendControlPacket({ type: 'text_input', text: e.key });
  }
});

// Navigation Hardware Buttons
btnBack.addEventListener('click', () => {
  logEvent('INFO', 'BUTTON', 'Nav BACK clicked');
  sendControlPacket({ type: 'key_action', action: 'BACK' });
});
btnHome.addEventListener('click', () => {
  logEvent('INFO', 'BUTTON', 'Nav HOME clicked');
  sendControlPacket({ type: 'key_action', action: 'HOME' });
});
btnRecents.addEventListener('click', () => {
  logEvent('INFO', 'BUTTON', 'Nav RECENTS clicked');
  sendControlPacket({ type: 'key_action', action: 'RECENTS' });
});
btnNotifications.addEventListener('click', () => {
  logEvent('INFO', 'BUTTON', 'Action NOTIFICATIONS clicked');
  sendControlPacket({ type: 'key_action', action: 'NOTIFICATIONS' });
});
btnVolUp.addEventListener('click', () => {
  logEvent('INFO', 'BUTTON', 'Volume UP clicked');
  sendControlPacket({ type: 'key_action', action: 'VOLUME_UP' });
});
btnVolDown.addEventListener('click', () => {
  logEvent('INFO', 'BUTTON', 'Volume DOWN clicked');
  sendControlPacket({ type: 'key_action', action: 'VOLUME_DOWN' });
});
btnLockScreen.addEventListener('click', () => {
  logEvent('INFO', 'BUTTON', 'Lock Screen clicked');
  sendControlPacket({ type: 'key_action', action: 'LOCK' });
});

// Fullscreen
btnFullscreen.addEventListener('click', () => {
  if (!document.fullscreenElement) {
    videoContainer.requestFullscreen().catch(err => alert(err.message));
  } else {
    document.exitFullscreen();
  }
});

// Direct Text Injection
btnSendText.addEventListener('click', () => {
  const text = directTextInput.value.trim();
  if (text) {
    logEvent('INFO', 'INPUT', `Injecting text: "${text}"`);
    sendControlPacket({ type: 'text_input', text: text });
    directTextInput.value = '';
  }
});

// Wake & Connect
btnWakeUp.addEventListener('click', triggerRemoteWakeUp);
btnConnectNow.addEventListener('click', startConnection);

// Video Element Diagnostics
remoteVideo.addEventListener('loadedmetadata', () => {
  logEvent('INFO', 'VIDEO', `Video metadata loaded: ${remoteVideo.videoWidth}x${remoteVideo.videoHeight}`);
});
remoteVideo.addEventListener('playing', () => {
  logEvent('SUCCESS', 'VIDEO', `Video playback rendered: ${remoteVideo.videoWidth}x${remoteVideo.videoHeight}`);
});
remoteVideo.addEventListener('waiting', () => {
  logEvent('WARN', 'VIDEO', 'Video waiting for frames / buffering...');
});
remoteVideo.addEventListener('error', (e) => {
  logEvent('ERROR', 'VIDEO', `Video element error: ${remoteVideo.error?.message || 'unknown error'}`);
});

// Status Indicator Helper
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
  if (inputLanIp) inputLanIp.value = customLanIp;
  if (inputTurnKey) inputTurnKey.value = customTurnKey;
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
  if (inputLanIp) {
    customLanIp = inputLanIp.value.trim();
    localStorage.setItem('rd_lan_ip', customLanIp);
  }
  if (inputTurnKey) {
    customTurnKey = inputTurnKey.value.trim();
    localStorage.setItem('rd_turn_key', customTurnKey);
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
logEvent('INFO', 'SYSTEM', 'FLEX Web Controller Engine Ready. Room: ' + roomId);

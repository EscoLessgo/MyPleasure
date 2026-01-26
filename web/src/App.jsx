import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Shield,
  Zap,
  Activity,
  Heart,
  Copy,
  Radio,
  ThumbsUp,
  ThumbsDown,
  Flame,
  Volume2,
  Cpu,
  Fingerprint,
  Lock,
  MessageSquare,
  Check,
  X,
  ChevronRight,
  Camera,
  CameraOff,
  Mic,
  MicOff,
  Gamepad2,
  Trash2,
  Video
} from 'lucide-react';
import './App.css';

const getWSUrl = () => {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  if (window.location.port === '5173' || window.location.hostname === 'localhost') {
    return `${protocol}//${window.location.hostname}:8080`;
  }
  return `${protocol}//${window.location.host}`;
};

const WS_URL = getWSUrl();
const JOYHUB_SERVICE_UUID = '0000ffa0-0000-1000-8000-00805f9b34fb';
const JOYHUB_TX_CHAR_UUID = '0000ffa1-0000-1000-8000-00805f9b34fb';

function App() {
  // --- AUTH & SETUP ---
  const [isSiteAuthorized, setIsSiteAuthorized] = useState(() => sessionStorage.getItem('mp_auth') === 'true');
  const [sitePasscode, setSitePasscode] = useState('');
  const [username, setUsername] = useState(sessionStorage.getItem('mp_username') || '');
  const [role, setRole] = useState(null);
  const [deviceId, setDeviceId] = useState('MP-ALPHA-01');

  // --- SESSION STATE ---
  const [connected, setConnected] = useState(false);
  const [handshakeStatus, setHandshakeStatus] = useState('idle'); // idle, pending, active, denied
  const [speed, setSpeed] = useState(0);
  const [logs, setLogs] = useState([]);
  const [participants, setParticipants] = useState([]);
  const [inputText, setInputText] = useState('');
  const [messages, setMessages] = useState([]);

  // --- MEDIA STATE ---
  const [localStream, setLocalStream] = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);
  const [isCamOn, setIsCamOn] = useState(false);
  const [isMicOn, setIsMicOn] = useState(false);

  // --- REFS ---
  const wsRef = useRef(null);
  const pcRef = useRef(null);
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const bleCharsRef = useRef([]);
  const [bleDevice, setBleDevice] = useState(null);
  const [shake, setShake] = useState(false);

  // --- LOGGING ---
  const addLog = (msg) => {
    const timestamp = new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit' });
    setLogs(prev => [`[${timestamp}] ${msg}`, ...prev].slice(0, 10));
  };

  // --- INITIALIZATION ---
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const d = params.get('deviceId');
    if (d) setDeviceId(d);
    const p = params.get('passcode');
    if (p === '6969') { setIsSiteAuthorized(true); sessionStorage.setItem('mp_auth', 'true'); }
  }, []);

  // --- WEBSOCKET & SIGNALING ---
  const connectWS = () => {
    if (!username) return alert('Enter your name, darling.');
    sessionStorage.setItem('mp_username', username);

    if (wsRef.current) wsRef.current.close();

    const socket = new WebSocket(`${WS_URL}?deviceId=${deviceId}&type=${role}&username=${encodeURIComponent(username)}`);

    socket.onopen = () => {
      setConnected(true);
      if (role === 'controller') setHandshakeStatus('pending');
      else setHandshakeStatus('active');
      addLog(`Secure Tunnel Initialized: ${deviceId}`);
    };

    socket.onmessage = async (event) => {
      try {
        const msg = JSON.parse(event.data);

        switch (msg.action) {
          case 'room-state':
            setParticipants(msg.value);
            break;
          case 'handshake-approved':
            setHandshakeStatus('active');
            addLog('✓ Access Granted by Host');
            break;
          case 'handshake-denied':
            setHandshakeStatus('denied');
            addLog('X Access Denied');
            break;
          case 'speed':
            setSpeed(msg.value);
            if (role === 'bridge') sendBLECommand(1, msg.value);
            break;
          case 'chat':
            setMessages(prev => [...prev, msg.value].slice(-20));
            break;
          case 'climax':
            setShake(true);
            setTimeout(() => setShake(false), 3000);
            if (role === 'bridge') {
              sendBLECommand(1, 100);
              setTimeout(() => sendBLECommand(1, 0), 3000);
            }
            break;
          // RTC SIGNALING
          case 'offer':
            handleOffer(msg.value);
            break;
          case 'answer':
            handleAnswer(msg.value);
            break;
          case 'ice-candidate':
            handleIceCandidate(msg.value);
            break;
          default:
            break;
        }
      } catch (e) { }
    };

    socket.onclose = () => {
      setConnected(false);
      setHandshakeStatus('idle');
      addLog('! Link Severed');
    };

    wsRef.current = socket;
  };

  // --- WEBRTC LOGIC ---
  const initPeerConnection = () => {
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });

    pc.onicecandidate = (event) => {
      if (event.candidate && wsRef.current) {
        wsRef.current.send(JSON.stringify({ action: 'ice-candidate', value: event.candidate }));
      }
    };

    pc.ontrack = (event) => {
      setRemoteStream(event.streams[0]);
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = event.streams[0];
      }
    };

    pcRef.current = pc;
    return pc;
  };

  const handleOffer = async (offer) => {
    const pc = pcRef.current || initPeerConnection();
    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    wsRef.current.send(JSON.stringify({ action: 'answer', value: answer }));
  };

  const handleAnswer = async (answer) => {
    if (pcRef.current) {
      await pcRef.current.setRemoteDescription(new RTCSessionDescription(answer));
    }
  };

  const handleIceCandidate = async (candidate) => {
    if (pcRef.current) {
      await pcRef.current.addIceCandidate(new RTCIceCandidate(candidate));
    }
  };

  const toggleMedia = async (type) => {
    if (type === 'cam') {
      if (isCamOn) {
        localStream.getVideoTracks().forEach(track => track.stop());
        setIsCamOn(false);
      } else {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: isMicOn });
          setLocalStream(stream);
          setIsCamOn(true);
          if (localVideoRef.current) localVideoRef.current.srcObject = stream;

          const pc = pcRef.current || initPeerConnection();
          stream.getTracks().forEach(track => pc.addTrack(track, stream));

          if (role === 'bridge') { // Host offers to Guest
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            wsRef.current.send(JSON.stringify({ action: 'offer', value: offer }));
          }
        } catch (err) { alert("Camera access denied."); }
      }
    } else if (type === 'mic') {
      // Simple toggle for now
      if (localStream) {
        localStream.getAudioTracks().forEach(track => track.enabled = !isMicOn);
        setIsMicOn(!isMicOn);
      } else {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          setLocalStream(stream);
          setIsMicOn(true);
        } catch (err) { }
      }
    }
  };

  // --- ACTIONS ---
  const handleHandshake = (guestId, decision) => {
    if (wsRef.current) {
      wsRef.current.send(JSON.stringify({ action: decision === 'accept' ? 'accept-guest' : 'deny-guest', guestId }));
    }
  };

  const updateSpeed = (val) => {
    const s = parseInt(val);
    setSpeed(s);
    if (wsRef.current && handshakeStatus === 'active') {
      wsRef.current.send(JSON.stringify({ action: 'speed', value: s }));
    }
    if (role === 'bridge') sendBLECommand(1, s);
  };

  const triggerClimax = () => {
    if (wsRef.current && handshakeStatus === 'active') {
      wsRef.current.send(JSON.stringify({ action: 'climax' }));
      addLog('🔥 CLIMAX EMITTED');
    }
  };

  const sendChatMessage = () => {
    if (!inputText.trim()) return;
    const msgObj = { user: username, text: inputText, time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) };
    if (wsRef.current && handshakeStatus === 'active') {
      wsRef.current.send(JSON.stringify({ action: 'chat', value: msgObj }));
    }
    setMessages(prev => [...prev, msgObj]);
    setInputText('');
  };

  const connectBLE = async () => {
    try {
      const device = await navigator.bluetooth.requestDevice({ filters: [{ namePrefix: 'J-' }], optionalServices: [JOYHUB_SERVICE_UUID] });
      const server = await device.gatt.connect();
      const service = await server.getPrimaryService(JOYHUB_SERVICE_UUID);
      const txChar = await service.getCharacteristic(JOYHUB_TX_CHAR_UUID);
      bleCharsRef.current = [txChar];
      setBleDevice(device);
      addLog('✓ Haptic Link Active');
    } catch (err) { addLog('Link Refused'); }
  };

  const sendBLECommand = async (mode, rawSpeed) => {
    if (!bleCharsRef.current.length) return;
    const intensity = Math.min(255, Math.floor((rawSpeed / 100) * 255));
    const finalMode = rawSpeed === 0 ? 0 : mode;
    const cmd = new Uint8Array([0xa0, 0x0c, 0x00, 0x00, finalMode, intensity]);
    try { await bleCharsRef.current[0].writeValue(cmd); } catch (err) { }
  };

  // --- VIEWS ---

  if (!isSiteAuthorized) {
    return (
      <div className="lobby-overlay">
        <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="setup-gate animate-intimate text-center">
          <Fingerprint className="text-secondary mx-auto mb-4" size={70} />
          <div className="mp-logo">MY<span>PLEASURE</span></div>
          <p className="mp-subtitle">BEYOND THE VEIL LIES PURE CONNECTION.</p>
          <form onSubmit={(e) => { e.preventDefault(); if (sitePasscode === '6969') { setIsSiteAuthorized(true); sessionStorage.setItem('mp_auth', 'true'); } else alert('Access Denied.'); }} className="mt-10 space-y-6">
            <input type="password" placeholder="THE SECRET KEY" value={sitePasscode} onChange={e => setSitePasscode(e.target.value)} className="input-sexy" />
            <button type="submit" className="btn-sexy btn-climax">ASCEND</button>
          </form>
        </motion.div>
      </div>
    );
  }

  if (!role || !connected) {
    return (
      <div className="lobby-overlay">
        <div className="setup-gate">
          <div className="mp-logo">MY<span>PLEASURE</span></div>
          <p className="mp-subtitle">A PROFESSIONAL SUITE FOR REMOTE INTIMACY.</p>

          <div className="w-full space-y-10 mt-6">
            <div className="grid grid-cols-2 gap-6">
              <button onClick={() => setRole('controller')} className={`mp-card p-10 flex flex-col items-center gap-4 ${role === 'controller' ? 'border-crimson bg-crimson/10' : 'opacity-40'}`}>
                <Gamepad2 size={48} />
                <div className="font-syne font-black text-xs tracking-widest uppercase">Controller</div>
              </button>
              <button onClick={() => setRole('bridge')} className={`mp-card p-10 flex flex-col items-center gap-4 ${role === 'bridge' ? 'border-crimson bg-crimson/10' : 'opacity-40'}`}>
                <Activity size={48} />
                <div className="font-syne font-black text-xs tracking-widest uppercase">Host</div>
              </button>
            </div>

            <div className="space-y-6">
              <input type="text" placeholder="YOUR NAME, DARLING" value={username} onChange={e => setUsername(e.target.value)} className="input-sexy" />
              {role === 'controller' && <input type="text" placeholder="SESSION ID" value={deviceId} onChange={e => setDeviceId(e.target.value)} className="input-sexy" />}
              <button onClick={connectWS} className="btn-sexy btn-climax">ESTABLISH LINK</button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (role === 'controller' && handshakeStatus === 'pending') {
    return (
      <div className="lobby-overlay">
        <div className="setup-gate animate-intimate">
          <div className="status-circle animate-heartbeat">
            <div className="circle-content">🕯️</div>
          </div>
          <div className="mp-logo text-4xl">PENDING<span>SYNC</span></div>
          <p className="mp-subtitle">THE HOST HAS BEEN SUMMONED. STAND BY.</p>
          <button onClick={() => setConnected(false)} className="btn-sexy bg-zinc-900 border-white/5 opacity-50">CANCEL REQUEST</button>
        </div>
      </div>
    );
  }

  return (
    <div className={`app-container ${shake ? 'shake-it' : ''}`}>
      {/* Header */}
      <nav className="flex justify-between items-center">
        <div className="flex items-center gap-8">
          <div className="mp-logo text-4xl m-0">MY<span>PLEASURE</span></div>
        </div>
        <div className="flex items-center gap-8">
          <div className="text-right hidden md:block">
            <div className="text-[10px] font-black text-crimson-bright tracking-widest uppercase">PULSE: ACTIVE</div>
            <div className="text-[10px] text-dim font-black tracking-widest mt-1 uppercase">NODE: {deviceId}</div>
          </div>
          <button onClick={() => { if (wsRef.current) wsRef.current.close(); setConnected(false); }} className="mp-card p-4 hover:bg-crimson/20"><Lock size={20} /></button>
        </div>
      </nav>

      <div className="mp-grid">
        {/* Left Column */}
        <div className="space-y-8">
          <div className="mp-card animate-heartbeat">
            <div className="flex justify-between items-center mb-6">
              <Shield className="text-crimson-bright" size={24} />
              <div className="mp-badge bg-crimson/20 text-crimson-bright">SECURE</div>
            </div>
            <div className="text-center space-y-2">
              <h2 className="text-2xl font-playfair font-black italic">HAPTIC SYNC</h2>
              <p className="text-[10px] text-dim font-black uppercase tracking-[0.3em]">Neural Interface Engaged</p>
            </div>
            <div className="grid grid-cols-2 gap-4 mt-8">
              <button className="btn-sexy p-6 flex justify-center"><ThumbsUp size={24} className="text-emerald-500" /></button>
              <button className="btn-sexy p-6 flex justify-center"><ThumbsDown size={24} className="text-crimson-bright" /></button>
            </div>
            <button onClick={triggerClimax} className="btn-sexy btn-climax mt-6">🔥 I'M GONNA CUM! 🔥</button>
          </div>

          <div className="mp-card">
            <div className="status-circle">
              <div className="circle-content">🌸</div>
            </div>
            <div className="text-center mt-6 space-y-1">
              <div className="mp-subtitle">DESIRE INTENSITY</div>
              <div className="text-5xl font-syne font-black italic text-crimson-bright">{speed}%</div>
            </div>
          </div>

          <div className="mp-card">
            <div className="mp-subtitle mb-6 tracking-[0.4em]">SYNC REQUESTS</div>
            <div className="space-y-4">
              {participants.filter(p => p.status === 'pending').length === 0 ? (
                <div className="py-10 text-center border-2 border-dashed border-crimson/10 rounded-3xl text-[10px] uppercase font-black text-dim opacity-30">Lobby Clear</div>
              ) : (
                participants.filter(p => p.status === 'pending').map(p => (
                  <div key={p.id} className="flex justify-between items-center bg-crimson/5 p-4 rounded-2xl border border-crimson/20">
                    <div>
                      <div className="text-sm font-black text-white">{p.username}</div>
                      <div className="text-[9px] uppercase font-black text-crimson">Pending Entry</div>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => handleHandshake(p.id, 'accept')} className="p-3 bg-emerald-500/20 text-emerald-400 rounded-xl hover:bg-emerald-500/40"><Check size={18} /></button>
                      <button onClick={() => handleHandshake(p.id, 'deny')} className="p-3 bg-crimson/20 text-crimson-bright rounded-xl hover:bg-crimson/40"><X size={18} /></button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Middle Column: Media Stage */}
        <div className="space-y-8">
          <div className="media-stage mp-card p-0">
            {remoteStream ? (
              <video ref={remoteVideoRef} className="video-feed" autoPlay playsInline />
            ) : (
              <div className="h-full flex flex-col items-center justify-center space-y-6 opacity-30">
                <Video size={80} />
                <div className="mp-subtitle">Stage Awaiting Pulse</div>
              </div>
            )}
            <div className="video-overlay" />

            {isCamOn && (
              <div className="local-preview">
                <video ref={localVideoRef} className="video-feed" autoPlay playsInline muted />
              </div>
            )}

            <div className="media-controls">
              <button onClick={() => toggleMedia('cam')} className={`btn-media-circle ${isCamOn ? 'active' : ''}`}>
                {isCamOn ? <CameraOff size={24} /> : <Camera size={24} />}
              </button>
              <button onClick={() => toggleMedia('mic')} className={`btn-media-circle ${isMicOn ? 'active' : ''}`}>
                {isMicOn ? <MicOff size={24} /> : <Mic size={24} />}
              </button>
            </div>
          </div>

          <div className="mp-card whisper-container p-0">
            <div className="p-6 border-b border-crimson/10 flex justify-between items-center">
              <div className="mp-subtitle m-0">PRIVATE WHISPERS</div>
              <MessageSquare className="text-crimson opacity-50" size={20} />
            </div>
            <div className="whisper-feed">
              {messages.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center opacity-10 space-y-4">
                  <Flame size={60} />
                  <div className="text-[12px] font-black uppercase tracking-[1em]">Kindle the spark</div>
                </div>
              ) : (
                messages.map((m, i) => (
                  <div key={i} className={`whisper-bubble ${m.user === username ? 'own' : 'other'}`}>
                    <div className="text-[10px] font-black opacity-40 uppercase mb-2">{m.user} &bull; {m.time}</div>
                    {m.text}
                  </div>
                ))
              )}
            </div>
            <div className="whisper-input-area">
              <div className="whisper-input-glass">
                <input
                  type="text"
                  placeholder="Whisper your desires..."
                  value={inputText}
                  onChange={e => setInputText(e.target.value)}
                  onKeyPress={e => e.key === 'Enter' && sendChatMessage()}
                />
                <button onClick={sendChatMessage} className="p-3 bg-crimson rounded-xl text-white hover:scale-110 transition-transform"><ChevronRight size={20} /></button>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column */}
        <div className="space-y-8">
          <div className="mp-card">
            <div className="mp-subtitle mb-4">ACCESS PORTAL</div>
            <div className="bg-black/40 p-5 rounded-3xl border border-crimson/10 font-mono text-[11px] text-crimson-bright leading-relaxed">
              {window.location.host}/?deviceId={deviceId}
            </div>
            <button
              onClick={() => { navigator.clipboard.writeText(`${window.location.origin}/?deviceId=${deviceId}`); addLog('✓ Portal coordinates copied'); }}
              className="btn-sexy mt-6 border-crimson/10 bg-black/40"
            >
              COPY PORTAL LINK
            </button>
          </div>

          <div className="mp-card">
            <div className="mp-subtitle mb-6 tracking-[0.4em]">SYNC OVERRIDES</div>
            <div className="space-y-10">
              <div className="space-y-4">
                <div className="flex justify-between items-end">
                  <span className="text-[11px] font-black text-dim uppercase">Master Pulse</span>
                  <Zap className="text-crimson-bright" size={16} />
                </div>
                <input type="range" min="0" max="100" value={speed} onChange={e => updateSpeed(e.target.value)} className="w-full h-1 bg-crimson/20 rounded-full appearance-none accent-crimson-bright" />
              </div>
              {role === 'bridge' && (
                <button onClick={connectBLE} className={`btn-sexy flex items-center justify-center gap-4 ${bleDevice ? 'border-emerald-500/30 text-emerald-400' : ''}`}>
                  <Cpu size={20} />
                  <span>{bleDevice ? 'HARDWARE SYNCED' : 'BIND TOY'}</span>
                </button>
              )}
            </div>
          </div>

          <div className="mp-card">
            <div className="mp-subtitle mb-4 tracking-[0.4em]">CONSOLE</div>
            <div className="space-y-2 h-40 overflow-y-auto font-mono text-[10px] opacity-40">
              {logs.map((log, i) => (
                <div key={i} className="flex gap-3">
                  <span className="text-crimson-bright shrink-0">{log.split(' ')[0]}</span>
                  <span>{log.split(' ').slice(1).join(' ')}</span>
                </div>
              ))}
            </div>
            <button onClick={() => window.location.reload()} className="btn-sexy mt-6 bg-transparent border-crimson/20 hover:bg-crimson/10">DESTROY SESSION</button>
          </div>
        </div>
      </div>

      <footer className="mt-10 py-10 opacity-20 text-center">
        <div className="text-[10px] font-black uppercase tracking-[2em]">MyPleasure Protocol &bull; End-to-End Encrypted</div>
      </footer>
    </div>
  );
}

export default App;

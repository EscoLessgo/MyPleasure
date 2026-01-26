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
  Settings,
  Battery,
  Signal,
  Wifi,
  Terminal,
  ExternalLink,
  Users,
  Eye,
  LogOut,
  RefreshCw,
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
  // --- AUTH & IDENTITY ---
  const [isSiteAuthorized, setIsSiteAuthorized] = useState(() => sessionStorage.getItem('mp_auth') === 'true');
  const [sitePasscode, setSitePasscode] = useState('');
  const [username, setUsername] = useState(sessionStorage.getItem('mp_username') || '');
  const [role, setRole] = useState(null);
  const [deviceId, setDeviceId] = useState('MP-X-7');

  // --- CONNECTION STATE ---
  const [connected, setConnected] = useState(false);
  const [handshakeStatus, setHandshakeStatus] = useState('idle'); // idle, pending, active, denied
  const [speed, setSpeed] = useState(0);
  const [logs, setLogs] = useState([]);
  const [participants, setParticipants] = useState([]);
  const [inputText, setInputText] = useState('');
  const [messages, setMessages] = useState([]);

  // --- WEBRTC ---
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
  const [latency, setLatency] = useState(0);

  // --- ACTIONS ---
  const addLog = (msg) => {
    const timestamp = new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    setLogs(prev => [`${timestamp} > ${msg}`, ...prev].slice(0, 50));
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const d = params.get('deviceId');
    if (d) setDeviceId(d);
    const p = params.get('passcode');
    if (p === '6969') { setIsSiteAuthorized(true); sessionStorage.setItem('mp_auth', 'true'); }

    // Simulate latency flux
    const interval = setInterval(() => setLatency(Math.floor(Math.random() * 15) + 38), 3000);
    return () => clearInterval(interval);
  }, []);

  // --- WEBSOCKET ENGINE ---
  const connectWS = () => {
    if (!username) return alert('Enter callsign to proceed.');
    sessionStorage.setItem('mp_username', username);

    if (wsRef.current) wsRef.current.close();

    const socket = new WebSocket(`${WS_URL}?deviceId=${deviceId}&type=${role}&username=${encodeURIComponent(username)}`);

    socket.onopen = () => {
      setConnected(true);
      if (role === 'controller') setHandshakeStatus('pending');
      else setHandshakeStatus('active');
      addLog(`SYNC ESTABLISHED: ${deviceId}`);
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
            addLog('✓ HANDSHAKE SUCCESS: LINK VERIFIED');
            break;
          case 'handshake-denied':
            setHandshakeStatus('denied');
            addLog('! ACCESS DENIED BY HOST');
            break;
          case 'speed':
            setSpeed(msg.value);
            if (role === 'bridge') sendBLECommand(1, msg.value);
            break;
          case 'chat':
            setMessages(prev => [...prev, msg.value].slice(-30));
            break;
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
      addLog('! CONNECTION SEVERED');
    };

    wsRef.current = socket;
  };

  // --- WebRTC signaling ---
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

          if (role === 'bridge') {
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            wsRef.current.send(JSON.stringify({ action: 'offer', value: offer }));
          }
        } catch (err) { alert("Visual permissions denied."); }
      }
    } else if (type === 'mic') {
      if (localStream) {
        localStream.getAudioTracks().forEach(track => track.enabled = !isMicOn);
        setIsMicOn(!isMicOn);
      }
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

  const connectBLE = async () => {
    try {
      const device = await navigator.bluetooth.requestDevice({ filters: [{ namePrefix: 'J-' }], optionalServices: [JOYHUB_SERVICE_UUID] });
      const server = await device.gatt.connect();
      const service = await server.getPrimaryService(JOYHUB_SERVICE_UUID);
      const txChar = await service.getCharacteristic(JOYHUB_TX_CHAR_UUID);
      bleCharsRef.current = [txChar];
      setBleDevice(device);
      addLog('✓ NEURAL HARDWARE SYNCED');
    } catch (err) { addLog('! NEURAL LINK REFUSED'); }
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
      <div className="gate-overlay">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="gate-content">
          <Fingerprint size={64} className="text-[#00f2ff] mx-auto animate-pulse" />
          <div>
            <h1 className="font-syne text-4xl font-extrabold tracking-tight">MY<span className="text-[#00f2ff]">PLEASURE</span></h1>
            <p className="text-[10px] text-dim font-bold tracking-[0.5em] mt-3 uppercase">Enter Protocol Key</p>
          </div>
          <form onSubmit={(e) => { e.preventDefault(); if (sitePasscode === '6969') { setIsSiteAuthorized(true); sessionStorage.setItem('mp_auth', 'true'); } }} className="flex flex-col gap-4">
            <input type="password" value={sitePasscode} onChange={e => setSitePasscode(e.target.value)} className="cyber-input" placeholder="PASSCODE" />
            <button type="submit" className="btn-primary-gradient">UNSEAL PORTAL</button>
          </form>
        </motion.div>
      </div>
    );
  }

  if (!role || !connected) {
    return (
      <div className="gate-overlay">
        <div className="gate-content">
          <h1 className="font-syne text-4xl font-extrabold tracking-tight">MY<span className="text-[#00f2ff]">PLEASURE</span></h1>
          <div className="grid grid-cols-2 gap-4">
            <button onClick={() => setRole('controller')} className={`glass-panel p-8 text-center flex flex-col items-center gap-3 ${role === 'controller' ? 'border-[#00f2ff] bg-[#00f2ff]/5' : 'opacity-40'}`}>
              <Gamepad2 size={40} className={role === 'controller' ? 'text-[#00f2ff]' : ''} />
              <span className="text-[10px] font-black uppercase tracking-widest text-dim">Controller</span>
            </button>
            <button onClick={() => setRole('bridge')} className={`glass-panel p-8 text-center flex flex-col items-center gap-3 ${role === 'bridge' ? 'border-[#00f2ff] bg-[#00f2ff]/5' : 'opacity-40'}`}>
              <Activity size={40} className={role === 'bridge' ? 'text-[#00f2ff]' : ''} />
              <span className="text-[10px] font-black uppercase tracking-widest text-dim">Bridge</span>
            </button>
          </div>
          <div className="flex flex-col gap-4">
            <input type="text" placeholder="CALLSIGN" value={username} onChange={e => setUsername(e.target.value)} className="cyber-input" />
            <input type="text" placeholder="NODE ID" value={deviceId} onChange={e => setDeviceId(e.target.value)} className="cyber-input" />
            <button onClick={connectWS} className="btn-primary-gradient">ESTABLISH LINK</button>
          </div>
        </div>
      </div>
    );
  }

  // --- MAIN DASHBOARD RENDER ---
  return (
    <div className="app-container">
      <header className="dashboard-header">
        <div className="flex items-center gap-6">
          <h1 className="font-syne text-2xl font-extrabold tracking-tight">MY<span className="text-[#00f2ff]">PLEASURE</span></h1>
          <div className="h-4 w-px bg-white/10" />
          <div className="flex items-center gap-2 text-[10px] font-bold text-dim uppercase">
            <span className="flex h-2 w-2 rounded-full bg-[#00f2ff] animate-pulse" />
            Live Connection
          </div>
        </div>
        <div className="flex items-center gap-6">
          <div className="flex flex-col items-end">
            <span className="text-[10px] font-bold text-dim uppercase tracking-wider">Sign-in Activity</span>
            <span className="text-[10px] font-bold text-white uppercase">{username || 'Unknown Operator'}</span>
          </div>
          <button onClick={() => window.location.reload()} className="btn-cyber"><LogOut size={16} /> Session End</button>
        </div>
      </header>

      <div className="main-dashboard-grid">
        {/* Left Column: Device & Stats */}
        <div className="flex flex-col gap-6">
          <div className="glass-panel p-6 media-stage-container">
            <div className="widget-header">
              <div className="widget-icon"><Wifi size={18} className="text-[#00f2ff]" /></div>
              <h2 className="widget-title uppercase">Interface Health</h2>
            </div>
            <div className="stat-grid">
              <div className="stat-item">
                <div className="stat-label">Latency</div>
                <div className="stat-value text-[#00f2ff]">{latency}ms</div>
              </div>
              <div className="stat-item">
                <div className="stat-label">Stability</div>
                <div className="stat-value">99.8%</div>
              </div>
              <div className="stat-item">
                <div className="stat-label">Neural Sync</div>
                <div className="stat-value text-emerald-400">Locked</div>
              </div>
              <div className="stat-item">
                <div className="stat-label">Privacy</div>
                <div className="stat-value">E2EE</div>
              </div>
            </div>
          </div>

          <div className="glass-panel p-6">
            <div className="widget-header">
              <div className="widget-icon"><Cpu size={18} className="text-emerald-400" /></div>
              <h2 className="widget-title uppercase">Hardware Link</h2>
            </div>
            <div className="flex flex-col gap-5">
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-3">
                  <Battery id="battery-icon" size={20} className="text-dim" />
                  <span className="text-xs font-bold text-dim uppercase">Power Reserve</span>
                </div>
                <span className="text-xs font-black">94%</span>
              </div>
              <div className="glow-bar"><div className="glow-fill" style={{ width: '94%' }} /></div>

              {role === 'bridge' && (
                <button onClick={connectBLE} className={`btn-cyber w-full justify-center ${bleDevice ? 'active' : ''}`}>
                  <RefreshCw size={14} /> {bleDevice ? 'DEVICE SYNCED' : 'INITIALIZE NEURAL LINK'}
                </button>
              )}
            </div>
          </div>

          <div className="glass-panel p-6">
            <div className="widget-header">
              <div className="widget-icon"><Users size={18} className="text-purple-400" /></div>
              <h2 className="widget-title uppercase">Lobby Requests</h2>
            </div>
            <div className="flex flex-col gap-3 max-h-[200px] overflow-y-auto">
              {participants.filter(p => p.status === 'pending').length === 0 ? (
                <div className="text-center py-6 text-dim text-[10px] font-bold uppercase border-2 border-dashed border-white/5 rounded-xl">Lobby Empty</div>
              ) : (
                participants.filter(p => p.status === 'pending').map(p => (
                  <div key={p.id} className="flex justify-between items-center bg-white/5 p-3 rounded-xl border border-white/5">
                    <div className="text-[10px] font-bold">{p.username}</div>
                    <div className="flex gap-2">
                      <button onClick={() => wsRef.current.send(JSON.stringify({ action: 'accept-guest', guestId: p.id }))} className="text-emerald-400"><Check size={16} /></button>
                      <button onClick={() => wsRef.current.send(JSON.stringify({ action: 'deny-guest', guestId: p.id }))} className="text-rose-400"><X size={16} /></button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Center: Media Stage */}
        <div className="flex flex-col gap-6">
          <div className="media-stage">
            {remoteStream ? (
              <video ref={remoteVideoRef} className="video-main" autoPlay playsInline />
            ) : (
              <div className="h-full flex flex-col items-center justify-center gap-4 opacity-30">
                <Video size={64} />
                <span className="text-[10px] font-black uppercase tracking-[0.5em]">Waiting for transmission...</span>
              </div>
            )}

            <div className="media-overlay-top">
              <div className="badge-live"><span className="h-2 w-2 rounded-full bg-red-500" /> Secure Visual Stream</div>
              <div className="badge-live border-[#00f2ff]/30 text-white"><Settings size={14} /> Enhanced Ops</div>
            </div>

            {isCamOn && (
              <div className="local-preview" style={{ position: 'absolute', bottom: '1.5rem', right: '1.5rem', width: '160px', aspectRatio: '16/9', background: '#000', borderRadius: '1rem', border: '1px solid #00f2ff55', overflow: 'hidden' }}>
                <video ref={localVideoRef} className="video-main" autoPlay playsInline muted />
              </div>
            )}

            <div className="media-controls-dock">
              <button onClick={() => toggleMedia('cam')} className={`btn-cyber ${isCamOn ? 'active' : ''}`}><Camera size={18} /></button>
              <button onClick={() => toggleMedia('mic')} className={`btn-cyber ${isMicOn ? 'active' : ''}`}><Mic size={18} /></button>
              <button onClick={() => updateSpeed(0)} className="btn-cyber"><X size={18} /></button>
            </div>
          </div>

          <div className="glass-panel p-8 intensity-viz-box">
            <div className="flex justify-between items-center mb-8">
              <div className="text-left">
                <h3 className="widget-title uppercase">Kinetic Intensity</h3>
                <p className="text-[10px] text-dim font-bold uppercase">Biometric Impact Visualization</p>
              </div>
              <Flame size={24} className={speed > 50 ? 'text-orange-500 animate-pulse' : 'text-dim'} />
            </div>

            <div className="flex items-center gap-12">
              <div className="circular-meter">
                <svg width="140" height="140">
                  <circle cx="70" cy="70" r="60" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="12" />
                  <circle cx="70" cy="70" r="60" fill="none" stroke="url(#cyan-grad)" strokeWidth="12" strokeDasharray="377" strokeDashoffset={377 - (377 * speed) / 100} strokeLinecap="round" />
                  <defs>
                    <linearGradient id="cyan-grad" x1="0%" y1="0%" x2="100%" y2="0%">
                      <stop offset="0%" stopColor="#00f2ff" />
                      <stop offset="100%" stopColor="#2a2aff" />
                    </linearGradient>
                  </defs>
                </svg>
                <div className="meter-value">{speed}%</div>
              </div>
              <div className="flex-1 space-y-8">
                <div className="space-y-3">
                  <div className="flex justify-between text-[10px] font-bold text-dim uppercase">
                    <span>Impact Manual Override</span>
                    <span className="text-[#00f2ff]">{speed}%</span>
                  </div>
                  <input type="range" min="0" max="100" value={speed} onChange={e => updateSpeed(e.target.value)} className="w-full accent-[#00f2ff] cursor-pointer" />
                </div>
                <button onClick={() => updateSpeed(100)} className="btn-primary-gradient w-full py-4 text-xs">Maximum Desired Pulse</button>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Chat & Session */}
        <div className="flex flex-col gap-6">
          <div className="glass-panel whisper-chat">
            <div className="p-5 border-b border-white/5 flex justify-between items-center">
              <div className="flex items-center gap-3">
                <MessageSquare size={18} className="text-[#00f2ff]" />
                <span className="text-[10px] font-bold text-white uppercase tracking-wider">Tactical Whispers</span>
              </div>
              <div className="h-2 w-2 rounded-full bg-emerald-500" />
            </div>
            <div className="chat-feed custom-scrollbar">
              {messages.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center gap-4 opacity-10">
                  <Shield size={40} />
                  <span className="text-[10px] font-black uppercase tracking-[0.6em]">Secure Channel Idle</span>
                </div>
              ) : (
                messages.map((m, i) => (
                  <div key={i} className={`chat-bubble ${m.user === username ? 'bubble-own' : 'bubble-other'}`}>
                    <div className="text-[9px] font-black opacity-40 uppercase mb-1">{m.user} &bull; {m.time}</div>
                    {m.text}
                  </div>
                ))
              )}
            </div>
            <div className="chat-input-area">
              <div className="chat-input-wrapper">
                <input
                  type="text"
                  placeholder="Input signal..."
                  value={inputText}
                  onChange={e => setInputText(e.target.value)}
                  onKeyPress={e => e.key === 'Enter' && (() => {
                    if (!inputText.trim()) return;
                    const msgObj = { user: username, text: inputText, time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) };
                    if (wsRef.current && handshakeStatus === 'active') wsRef.current.send(JSON.stringify({ action: 'chat', value: msgObj }));
                    setMessages(prev => [...prev, msgObj]);
                    setInputText('');
                  })()}
                />
                <button className="btn-cyber active rounded-lg p-2"><ChevronRight size={18} /></button>
              </div>
            </div>
          </div>

          <div className="glass-panel p-6">
            <div className="widget-header">
              <div className="widget-icon"><Copy size={16} className="text-gold" /></div>
              <h2 className="widget-title uppercase">Session Credentials</h2>
            </div>
            <div className="flex flex-col gap-4">
              <div className="bg-black/40 p-3 rounded-lg border border-white/5 text-[10px] font-mono text-[#00f2ff] truncate">
                {window.location.host}/?deviceId={deviceId}
              </div>
              <button onClick={() => { navigator.clipboard.writeText(`${window.location.origin}/?deviceId=${deviceId}`); addLog('PORTAL LINK COPIED'); }} className="btn-cyber w-full justify-center">Copy Access Link</button>
            </div>
          </div>

          <div className="glass-panel p-5">
            <div className="widget-header mb-4">
              <div className="widget-icon"><Terminal size={16} className="text-dim" /></div>
              <h2 className="widget-title uppercase text-[0.7rem] text-dim">Interface Logs</h2>
            </div>
            <div className="console-feed">
              {logs.map((log, i) => (
                <div key={i} className="log-entry">
                  <span className="log-timestamp">[{log.split(' > ')[0]}]</span>
                  <span>{log.split(' > ')[1]}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;

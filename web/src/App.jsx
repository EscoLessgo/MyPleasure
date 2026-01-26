import React, { useState, useEffect, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Shield,
  Settings,
  Gamepad2,
  MessageSquare,
  Image as ImageIcon,
  Zap,
  Wifi,
  WifiOff,
  Bluetooth,
  Mic,
  MicOff,
  ArrowRight,
  Lock,
  Plus,
  Heart,
  Activity,
  Maximize2,
  Trash2,
  Send,
  Eye,
  EyeOff,
  Video
} from 'lucide-react';
import './App.css';
import { PATTERNS } from './patterns';

const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const host = window.location.host.includes('5173') ? 'localhost:8080' : window.location.host;
const WS_URL = `${protocol}//${host}`;

const JOYHUB_SERVICE_UUID = '0000ffa0-0000-1000-8000-00805f9b34fb';
const JOYHUB_TX_CHAR_UUID = '0000ffa1-0000-1000-8000-00805f9b34fb';

// Mock NSFW Media for demonstration (Antigravity can generate real placeholders later)
const INITIAL_MEDIA = [
  { id: 1, type: 'image', url: 'https://images.unsplash.com/photo-1515825838458-f2a94b20105a?w=800&q=80', label: 'Shadow Bloom', nsfw: true },
  { id: 2, type: 'video', url: 'https://assets.mixkit.co/videos/preview/mixkit-pink-and-purple-ink-clouds-spreading-in-water-31414-large.mp4', label: 'Silk Flow', nsfw: true },
  { id: 3, type: 'image', url: 'https://images.unsplash.com/photo-1550684848-fac1c5b4e853?w=800&q=80', label: 'Ember Gloom', nsfw: true },
];

function App() {
  const [activeTab, setActiveTab] = useState('controls');
  const [isAuthorized, setIsAuthorized] = useState(() => sessionStorage.getItem('tf_auth') === 'true');
  const [passcode, setPasscode] = useState('');
  const [role, setRole] = useState(null);
  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState('Disconnected');
  const [deviceId, setDeviceId] = useState('TrueForm-Alpha');
  const [inviteLink, setInviteLink] = useState('');

  // Power & Control State
  const [powerLevel, setPowerLevel] = useState(0);
  const [activePattern, setActivePattern] = useState(1);
  const [notifications, setNotifications] = useState([]);
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [remoteIsTyping, setRemoteIsTyping] = useState(false);

  // Media State
  const [mediaVault, setMediaVault] = useState(INITIAL_MEDIA);
  const [showNsfw, setShowNsfw] = useState(false);
  const [isPanic, setIsPanic] = useState(false);

  // BLE & WS Refs
  const ws = useRef(null);
  const bleDevice = useRef(null);
  const bleCharsRef = useRef([]);
  const isWritingRef = useRef(false);
  const lastPulseRef = useRef(0);
  const typingTimeoutRef = useRef(null);

  // WebRTC Refs
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const peerConnection = useRef(null);
  const [remoteStream, setRemoteStream] = useState(null);

  // --- Core Utility Functions ---
  const addNotification = (type, title, msg) => {
    const id = Date.now();
    setNotifications(prev => [{ id, type, title, msg }, ...prev].slice(0, 3));
    setTimeout(() => setNotifications(prev => prev.filter(n => n.id !== id)), 5000);
  };

  const getIntensityValue = (level) => {
    if (level === 0) return 0;
    if (level === 1) return 60;
    if (level === 2) return 145;
    return 255;
  };

  const sendCommand = async (mode, intensity) => {
    if (!bleCharsRef.current.length || isWritingRef.current) return;
    isWritingRef.current = true;
    const finalMode = intensity === 0 ? 0 : mode;
    const cmd = new Uint8Array([0xa0, 0x0c, 0x00, 0x00, finalMode, intensity]);
    try {
      await bleCharsRef.current[0].writeValue(cmd);
    } catch (err) {
      console.error('BLE fail:', err);
    } finally {
      setTimeout(() => { isWritingRef.current = false; }, 50);
    }
  };

  const updateRemote = (action, value) => {
    if (ws.current && connected) {
      ws.current.send(JSON.stringify({ action, value }));
    }
  };

  // --- WebSocket Logic ---
  const connectWS = () => {
    if (ws.current) ws.current.close();
    const socket = new WebSocket(`${WS_URL}?deviceId=${deviceId}&type=${role}`);
    socket.onopen = () => {
      setStatus('Online');
      setConnected(true);
      addNotification('success', 'System Connected', `Link established with ${deviceId}`);
      startMedia();
    };
    socket.onclose = () => {
      setStatus('Offline');
      setConnected(false);
      addNotification('error', 'Connection Lost', 'WebSocket link severed.');
    };
    socket.onmessage = async (event) => {
      const msg = JSON.parse(event.data);
      handleIncomingMessage(msg);
    };
    ws.current = socket;
  };

  const handleIncomingMessage = async (msg) => {
    switch (msg.action) {
      case 'power':
        const level = parseInt(msg.value);
        setPowerLevel(level);
        if (role === 'bridge') sendCommand(activePattern, getIntensityValue(level));
        break;
      case 'pattern':
        const pattern = parseInt(msg.value);
        setActivePattern(pattern);
        if (role === 'bridge') sendCommand(pattern, getIntensityValue(powerLevel || 1));
        break;
      case 'chat':
        setMessages(prev => [...prev, msg.value].slice(-50));
        break;
      case 'typing':
        setRemoteIsTyping(msg.value);
        break;
      case 'offer':
        await peerConnection.current.setRemoteDescription(new RTCSessionDescription(msg.offer));
        const answer = await peerConnection.current.createAnswer();
        await peerConnection.current.setLocalDescription(answer);
        updateRemote('answer', answer);
        break;
      case 'answer':
        await peerConnection.current.setRemoteDescription(new RTCSessionDescription(msg.answer));
        break;
      case 'ice-candidate':
        try { await peerConnection.current.addIceCandidate(new RTCIceCandidate(msg.candidate)); } catch (e) { }
        break;
      case 'media-sync':
        // Handle remote media playing
        addNotification('info', 'Remote Sync', `Partner is viewing: ${msg.value}`);
        break;
      default:
        break;
    }
  };

  // --- BLE Logic ---
  const connectBLE = async () => {
    try {
      const device = await navigator.bluetooth.requestDevice({
        filters: [{ namePrefix: 'J-' }],
        optionalServices: [JOYHUB_SERVICE_UUID]
      });
      const server = await device.gatt.connect();
      const service = await server.getPrimaryService(JOYHUB_SERVICE_UUID);
      const txChar = await service.getCharacteristic(JOYHUB_TX_CHAR_UUID);
      bleCharsRef.current = [txChar];
      bleDevice.current = device;
      addNotification('success', 'Hardware Linked', 'JoyHub device is now active.');
      updateRemote('status', 'Hardware Connected');
    } catch (err) {
      addNotification('error', 'Link Failed', err.message);
    }
  };

  // --- Media Logic ---
  const startMedia = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      if (localVideoRef.current) localVideoRef.current.srcObject = stream;

      peerConnection.current = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
      });

      stream.getTracks().forEach(track => peerConnection.current.addTrack(track, stream));

      peerConnection.current.ontrack = (event) => {
        setRemoteStream(event.streams[0]);
        if (remoteVideoRef.current) remoteVideoRef.current.srcObject = event.streams[0];
      };

      peerConnection.current.onicecandidate = (event) => {
        if (event.candidate) updateRemote('ice-candidate', event.candidate);
      };
    } catch (err) {
      console.error('Media fail:', err);
    }
  };

  const createOffer = async () => {
    const offer = await peerConnection.current.createOffer();
    await peerConnection.current.setLocalDescription(offer);
    updateRemote('offer', offer);
  };

  // --- Handlers ---
  const handleTyping = (text) => {
    setInputText(text);
    if (!isTyping) {
      setIsTyping(true);
      updateRemote('typing', true);
    }
    clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      setIsTyping(false);
      updateRemote('typing', false);
    }, 2000);
  };

  const sendMessage = () => {
    if (!inputText.trim()) return;
    const msg = { user: role, text: inputText, timestamp: new Date().toLocaleTimeString() };
    updateRemote('chat', msg);
    setMessages(prev => [...prev, msg].slice(-50));
    setInputText('');
  };

  const toggleNsfw = () => {
    if (!showNsfw) {
      // Small vibration feedback if bridge
      if (role === 'bridge') sendCommand(1, 40);
      setTimeout(() => role === 'bridge' && sendCommand(0, 0), 100);
    }
    setShowNsfw(!showNsfw);
  };

  // --- Views ---
  const AuthView = () => (
    <div className="min-h-screen flex items-center justify-center p-6">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass-premium p-12 max-w-md w-full text-center space-y-8"
      >
        <div className="flex justify-center">
          <div className="p-4 bg-purple-500/10 rounded-3xl border border-purple-500/20">
            <Lock className="text-purple-400" size={48} />
          </div>
        </div>
        <div>
          <h1 className="text-4xl font-black text-gradient italic tracking-tighter">SECURE ACCESS</h1>
          <p className="text-xs text-muted uppercase tracking-[0.3em] mt-2">TRUEFORM • PROTOCOL</p>
        </div>
        <div className="space-y-4">
          <input
            type="password"
            placeholder="ENTER PASSCODE"
            className="input-premium text-center text-xl tracking-[0.5em] font-black"
            value={passcode}
            onChange={(e) => setPasscode(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && handleAuth()}
          />
          <button onClick={handleAuth} className="btn-premium w-full">
            ESTABLISH LINK <ArrowRight size={18} />
          </button>
        </div>
      </motion.div>
    </div>
  );

  const handleAuth = () => {
    if (passcode === '6969') {
      setIsAuthorized(true);
      sessionStorage.setItem('tf_auth', 'true');
      addNotification('success', 'Access Granted', 'Security protocol bypassed.');
    } else {
      addNotification('error', 'Access Denied', 'Invalid security token.');
    }
  };

  if (isPanic) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center cursor-pointer" onClick={() => setIsPanic(false)}>
        <div className="text-[10px] text-white/5 uppercase tracking-[1em]">System Offline</div>
      </div>
    );
  }

  const SetupView = () => (
    <div className="min-h-screen flex items-center justify-center p-6">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="grid md:grid-cols-2 gap-8 max-w-4xl w-full"
      >
        <div className="glass p-10 space-y-8 flex flex-col justify-center text-center">
          <div className="flex justify-center">
            <div className="p-5 bg-indigo-500/10 rounded-[2.5rem] border border-indigo-500/20">
              <Gamepad2 className="text-indigo-400" size={64} />
            </div>
          </div>
          <div>
            <h2 className="text-3xl font-black italic tracking-tighter text-gradient-cyan">CONTROLLER</h2>
            <p className="text-[10px] text-muted uppercase tracking-[0.3em] mt-2">Distant Dominance</p>
          </div>
          <button onClick={() => setRole('controller')} className="btn-premium">SELECT MODE</button>
        </div>

        <div className="glass p-10 space-y-8 flex flex-col justify-center text-center border-purple-500/20">
          <div className="flex justify-center">
            <div className="p-5 bg-purple-500/10 rounded-[2.5rem] border border-purple-500/20">
              <Zap className="text-purple-400" size={64} />
            </div>
          </div>
          <div>
            <h2 className="text-3xl font-black italic tracking-tighter text-gradient">BRIDGE</h2>
            <p className="text-[10px] text-muted uppercase tracking-[0.3em] mt-2">Hardware Interface</p>
          </div>
          <button onClick={() => setRole('bridge')} className="btn-premium">SELECT MODE</button>
        </div>
      </motion.div>
    </div>
  );

  const DashboardView = () => (
    <div className="app-container">
      <nav className="glass p-6 mb-8 flex justify-between items-center rounded-3xl border-purple-500/10">
        <div className="flex items-center gap-4">
          <div className="p-3 bg-purple-500/10 rounded-2xl border border-purple-500/20">
            <Zap className="text-purple-400" size={20} />
          </div>
          <div>
            <h1 className="text-xl font-black italic tracking-tighter">TRUEFORM.<span className="text-gradient">BRIDGE</span></h1>
            <div className={`text-[9px] uppercase tracking-widest flex items-center gap-1 ${connected ? 'text-emerald-400' : 'text-rose-400'}`}>
              <div className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-emerald-400' : 'bg-rose-400'}`} />
              {status}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-6">
          <span className={`nav-link ${activeTab === 'controls' ? 'active' : ''}`} onClick={() => setActiveTab('controls')}>Controls</span>
          <span className={`nav-link ${activeTab === 'gallery' ? 'active' : ''}`} onClick={() => setActiveTab('gallery')}>Vault</span>
          <span className={`nav-link ${activeTab === 'chat' ? 'active' : ''}`} onClick={() => setActiveTab('chat')}>Sync</span>
          <div className="w-10 h-10 rounded-full bg-purple-500/20 border border-purple-500/20 flex items-center justify-center cursor-pointer hover:bg-purple-500/30 transition-all" onClick={() => setIsPanic(true)}>
            <Shield size={18} className="text-purple-300" />
          </div>
        </div>
      </nav>

      <main className="flex-1">
        <AnimatePresence mode="wait">
          {activeTab === 'controls' && <ControlsTab key="controls" />}
          {activeTab === 'gallery' && <GalleryTab key="gallery" />}
          {activeTab === 'chat' && <ChatTab key="chat" />}
        </AnimatePresence>
      </main>

      {/* Notifications */}
      <div className="fixed top-8 right-8 z-[100] flex flex-col gap-3 pointer-events-none">
        <AnimatePresence>
          {notifications.map(n => (
            <motion.div
              key={n.id}
              initial={{ opacity: 0, x: 50, scale: 0.9 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 20, scale: 0.9 }}
              className={`p-4 glass border-l-4 rounded-2xl flex items-center gap-4 min-w-[300px] shadow-2xl ${n.type === 'success' ? 'border-emerald-500' : n.type === 'error' ? 'border-rose-500' : 'border-indigo-500'
                }`}
            >
              <div className="p-2 bg-white/5 rounded-xl">
                {n.type === 'success' ? <Wifi className="text-emerald-400" size={18} /> : <Shield className="text-indigo-400" size={18} />}
              </div>
              <div>
                <h4 className="text-[10px] uppercase font-bold text-muted tracking-widest">{n.title}</h4>
                <p className="text-xs font-bold text-white">{n.msg}</p>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );

  const ControlsTab = () => (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="space-y-8"
    >
      <div className="grid md:grid-cols-3 gap-8">
        <div className="md:col-span-2 glass p-8 space-y-8">
          <div className="flex justify-between items-center">
            <h3 className="text-2xl font-black italic tracking-tighter">HAPTIC PULSE</h3>
            <div className="flex gap-2">
              <button className="btn-secondary text-[10px] px-4 py-2 uppercase tracking-widest font-black flex items-center gap-2">
                <Mic size={14} /> Voice Sync Off
              </button>
            </div>
          </div>

          <div className="visualizer-container glass-premium rounded-[3rem] overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-t from-purple-500/10 to-transparent pointer-events-none" />

            {/* Silk Visualizer Component - simplified for now */}
            <motion.div
              animate={{
                scale: [1, 1.2 + (powerLevel * 0.2), 1],
                opacity: [0.3, 0.6 + (powerLevel * 0.1), 0.3]
              }}
              transition={{ duration: 2 - (powerLevel * 0.5), repeat: Infinity, ease: "easeInOut" }}
              className="w-64 h-64 rounded-full bg-gradient-to-br from-purple-500 to-indigo-600 blur-3xl"
            />

            <div className="absolute bottom-8 flex flex-col items-center">
              <span className="text-[10px] font-black text-muted uppercase tracking-[0.4em] mb-4">Intensity Spectrum</span>
              <div className="flex gap-1 h-8 items-end">
                {[...Array(20)].map((_, i) => (
                  <motion.div
                    key={i}
                    animate={{ height: Math.random() * (20 + (powerLevel * 40)) }}
                    className="w-1 bg-purple-500/40 rounded-full"
                  />
                ))}
              </div>
            </div>
          </div>

          <div className="flex gap-4">
            <button className="btn-premium flex-1 bg-gradient-to-r from-rose-500 to-red-600 shadow-rose-500/20" onClick={() => setPowerLevel(0)}>
              EMERGENCY STOP
            </button>
          </div>
        </div>

        <div className="space-y-8">
          <div className="glass p-8 space-y-6">
            <h3 className="text-xl font-black italic tracking-tighter">SESSION STATUS</h3>
            {!connected ? (
              <div className="space-y-4">
                <input
                  type="text"
                  value={deviceId}
                  onChange={(e) => setDeviceId(e.target.value)}
                  className="input-premium"
                  placeholder="DEVICE ID"
                />
                <button onClick={connectWS} className="btn-premium w-full text-xs">INITIALIZE SESSION</button>
              </div>
            ) : (
              <div className="space-y-4">
                {role === 'bridge' && !bleDevice.current && (
                  <button onClick={connectBLE} className="btn-premium w-full bg-indigo-600 shadow-indigo-500/20">
                    <Bluetooth size={18} /> LINK HARDWARE
                  </button>
                )}
                {role === 'bridge' && (
                  <button className="btn-secondary w-full text-[10px] font-black tracking-widest">
                    COPY INVITE LINK
                  </button>
                )}
                <div className="p-4 bg-white/5 rounded-2xl border border-white/5 space-y-2">
                  <div className="flex justify-between text-[10px] font-bold text-muted uppercase tracking-widest">
                    <span>Protocol</span>
                    <span className="text-emerald-400">Secure</span>
                  </div>
                  <div className="flex justify-between text-[10px] font-bold text-muted uppercase tracking-widest">
                    <span>Latency</span>
                    <span className="text-indigo-400">22ms</span>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="glass p-8 space-y-6">
            <h3 className="text-xl font-black italic tracking-tighter">QUICK PATTERNS</h3>
            <div className="grid grid-cols-2 gap-3">
              {PATTERNS.slice(0, 6).map(p => (
                <button
                  key={p.id}
                  onClick={() => { setActivePattern(p.id); role === 'bridge' && sendCommand(p.id, getIntensityValue(powerLevel || 1)); }}
                  className={`p-4 rounded-2xl text-[10px] font-black uppercase tracking-widest border transition-all ${activePattern === p.id
                    ? 'bg-purple-500 border-purple-400 text-white shadow-lg shadow-purple-500/20'
                    : 'bg-white/5 border-white/5 text-muted hover:border-purple-500/40'
                    }`}
                >
                  {p.name}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );

  const GalleryTab = () => (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="space-y-8"
    >
      <div className="flex justify-between items-end mb-8">
        <div>
          <h2 className="text-4xl font-black italic tracking-tighter text-gradient">MEDIA VAULT</h2>
          <p className="text-xs text-muted font-bold uppercase tracking-[0.4em] mt-2">Personal NSFW Collection</p>
        </div>
        <div className="flex gap-4">
          <button
            onClick={toggleNsfw}
            className={`btn-secondary flex items-center gap-2 text-[10px] font-black tracking-widest ${showNsfw ? 'text-rose-400 border-rose-500/20' : ''}`}
          >
            {showNsfw ? <EyeOff size={14} /> : <Eye size={14} />} {showNsfw ? 'PROTECT' : 'REVEAL'}
          </button>
          <button className="btn-premium text-[10px] px-6 py-3">
            <Plus size={14} /> ADD MEDIA
          </button>
        </div>
      </div>

      <div className="media-grid">
        {mediaVault.map(item => (
          <motion.div
            key={item.id}
            whileHover={{ y: -5 }}
            className="media-card group cursor-pointer"
          >
            {item.type === 'video' ? (
              <video src={item.url} muted loop playsInline onMouseEnter={e => e.target.play()} onMouseLeave={e => e.target.pause()} className={!showNsfw ? 'blur-3xl' : ''} />
            ) : (
              <img src={item.url} alt={item.label} className={!showNsfw ? 'blur-3xl' : ''} />
            )}

            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity p-6 flex flex-col justify-end">
              <h4 className="text-sm font-black italic tracking-tighter text-white">{item.label}</h4>
              <div className="flex justify-between items-center mt-2">
                <div className="flex gap-2">
                  <button className="p-2 bg-white/10 rounded-lg hover:bg-white/20 transition-all text-white"><Maximize2 size={14} /></button>
                  <button className="p-2 bg-white/10 rounded-lg hover:bg-white/20 transition-all text-white"><Heart size={14} /></button>
                </div>
                {item.type === 'video' ? <Video size={14} className="text-white/40" /> : <ImageIcon size={14} className="text-white/40" />}
              </div>
            </div>
            {item.nsfw && <div className="media-badge">NSFW</div>}
          </motion.div>
        ))}
      </div>
    </motion.div>
  );

  const ChatTab = () => (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="grid md:grid-cols-12 gap-8 h-[600px]"
    >
      <div className="md:col-span-8 glass flex flex-col overflow-hidden">
        <div className="p-6 border-b border-white/5 flex justify-between items-center bg-white/2">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-indigo-500/20 flex items-center justify-center">
              <MessageSquare className="text-indigo-400" size={18} />
            </div>
            <div>
              <h3 className="text-sm font-black italic tracking-tighter uppercase">SECURE CHAT</h3>
              <p className="text-[9px] text-muted tracking-widest">{remoteIsTyping ? 'Partner is typing...' : 'Connected'}</p>
            </div>
          </div>
          <div className="flex gap-2">
            <button className="btn-secondary py-2 px-3"><Trash2 size={14} /></button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4 custom-scrollbar">
          {messages.map((m, i) => (
            <div key={i} className={`flex ${m.user === role ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[80%] p-4 rounded-2xl text-sm ${m.user === role
                ? 'bg-purple-500 text-white rounded-tr-none'
                : 'bg-white/5 border border-white/5 text-slate-200 rounded-tl-none'
                }`}>
                <div className="flex justify-between gap-4 mb-1">
                  <span className="text-[8px] font-black uppercase opacity-60 tracking-widest">{m.user}</span>
                  <span className="text-[8px] font-bold opacity-40">{m.timestamp}</span>
                </div>
                {m.text}
              </div>
            </div>
          ))}
          {remoteIsTyping && (
            <div className="flex justify-start">
              <div className="bg-white/5 p-4 rounded-2xl rounded-tl-none animate-pulse">
                <div className="flex gap-1">
                  <div className="w-1.5 h-1.5 bg-muted rounded-full animate-bounce" />
                  <div className="w-1.5 h-1.5 bg-muted rounded-full animate-bounce [animation-delay:0.2s]" />
                  <div className="w-1.5 h-1.5 bg-muted rounded-full animate-bounce [animation-delay:0.4s]" />
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="p-6 bg-white/2 border-t border-white/5">
          <div className="flex gap-4">
            <input
              value={inputText}
              onChange={(e) => handleTyping(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && sendMessage()}
              placeholder="MESSAGE PARTNER..."
              className="input-premium"
            />
            <button onClick={sendMessage} className="btn-premium px-6 py-4">
              <Send size={18} />
            </button>
          </div>
        </div>
      </div>

      <div className="md:col-span-4 space-y-8">
        <div className="glass p-8 space-y-6">
          <h3 className="text-xl font-black italic tracking-tighter">REMOTE FEED</h3>
          <div className="aspect-video bg-black rounded-3xl border border-white/5 overflow-hidden relative">
            <video ref={remoteVideoRef} autoPlay playsInline className="w-full h-full object-cover" />
            {!remoteStream && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/80 text-center p-6">
                <div className="space-y-4">
                  <p className="text-[10px] font-black text-muted uppercase tracking-widest">Feed Encrypted</p>
                  <button onClick={createOffer} className="btn-premium text-[10px] px-6 py-3">START CALL</button>
                </div>
              </div>
            )}
          </div>
          <div className="aspect-video bg-black rounded-3xl border border-white/5 overflow-hidden relative opacity-60">
            <video ref={localVideoRef} autoPlay muted playsInline className="w-full h-full object-cover" />
            <div className="absolute bottom-4 left-4 text-[8px] font-black uppercase tracking-widest bg-black/60 px-2 py-1 rounded-md">Preview Feed</div>
          </div>
        </div>
      </div>
    </motion.div>
  );

  // --- Main Render Logic ---
  if (!isAuthorized) return <AuthView />;
  if (!role) return <SetupView />;
  return <DashboardView />;
}

export default App;

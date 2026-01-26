import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Shield,
  Gamepad2,
  Zap,
  Bluetooth,
  Activity,
  Heart,
  Trash2,
  Copy,
  LayoutGrid,
  Terminal,
  LogOut,
  Users,
  Radio,
  ThumbsUp,
  ThumbsDown,
  Sparkles,
  Trophy,
  Target,
  Flame,
  Volume2,
  Signal,
  Cpu,
  Fingerprint,
  RefreshCw,
  Eye,
  Lock,
  MessageSquare
} from 'lucide-react';
import './App.css';
import { PATTERNS } from './patterns';

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

const REACTION_ASSETS = {
  idle: 'https://images.unsplash.com/photo-1550684848-fac1c5b4e853?q=80&w=1000&auto=format&fit=crop', // Abstract silk
  low: 'https://images.unsplash.com/photo-1549490349-8643362247b5?q=80&w=1000&auto=format&fit=crop',
  medium: 'https://images.unsplash.com/photo-1534120247760-c44c5e4a62f1?q=80&w=1000&auto=format&fit=crop',
  high: 'https://images.unsplash.com/photo-1492107376256-4026437926cd?q=80&w=1000&auto=format&fit=crop',
  climax: 'https://images.unsplash.com/photo-1520006403909-838d6b92c22e?q=80&w=1000&auto=format&fit=crop'
};

function App() {
  const [activeTab, setActiveTab] = useState('controls');
  const [role, setRole] = useState(null);
  const [deviceId, setDeviceId] = useState('Silk-Bridge-Alpha');
  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState('Offline');
  const [speed, setSpeed] = useState(0);
  const [activePattern, setActivePattern] = useState(1);
  const [logs, setLogs] = useState([]);
  const [participants, setParticipants] = useState([]);
  const [isAuthorized, setIsAuthorized] = useState(() => sessionStorage.getItem('tf_auth') === 'true');
  const [passcode, setPasscode] = useState('');
  const [isPanic, setIsPanic] = useState(false);
  const [reactions, setReactions] = useState([]);

  const wsRef = useRef(null);
  const [bleDevice, setBleDevice] = useState(null);
  const bleCharsRef = useRef([]);

  const [inputText, setInputText] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [remoteIsTyping, setRemoteIsTyping] = useState(false);
  const typingTimeoutRef = useRef(null);
  const lastPulseRef = useRef(0);

  const addLog = (msg) => {
    const timestamp = new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    setLogs(prev => [`[${timestamp}] ${msg}`, ...prev].slice(0, 30));
  };

  const spawnReaction = (emoji) => {
    const id = Date.now();
    setReactions(prev => [...prev, { id, emoji, x: Math.random() * 80 + 10, y: Math.random() * 50 + 20 }]);
    setTimeout(() => setReactions(prev => prev.filter(r => r.id !== id)), 1500);
  };

  // --- Core Lifecycle ---
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const r = params.get('role');
    if (r) setRole(r);
    const id = params.get('deviceId');
    if (id) setDeviceId(id);
    const p = params.get('passcode');
    if (p === '6969') {
      setIsAuthorized(true);
      sessionStorage.setItem('tf_auth', 'true');
    }
  }, []);

  const connectWS = () => {
    if (wsRef.current) wsRef.current.close();
    addLog(`Initiating Handshake: ${deviceId}...`);

    // Safety: don't let it hang on empty role
    const finalRole = role || 'controller';
    const socket = new WebSocket(`${WS_URL}?deviceId=${deviceId}&type=${finalRole}`);

    socket.onopen = () => {
      setStatus('Encrypted');
      setConnected(true);
      addLog('✓ Secure Tunnel Established');
    };

    socket.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        handleRemoteMessage(msg);
      } catch (e) {
        addLog('! Signal Noise Detected');
      }
    };

    socket.onclose = () => {
      setStatus('Offline');
      setConnected(false);
      setParticipants([]);
      addLog('! Link Severed');
    };

    socket.onerror = (err) => {
      addLog('X Protocol Violation: Timeout');
    };

    wsRef.current = socket;
  };

  const handleRemoteMessage = (msg) => {
    if (msg.action === 'room-state') { setParticipants(msg.value || []); return; }
    if (msg.action === 'reaction') { spawnReaction(msg.value); return; }

    if (role === 'bridge') {
      if (msg.action === 'speed') {
        const val = parseInt(msg.value);
        setSpeed(val);
        sendBLECommand(activePattern, val);
      } else if (msg.action === 'pattern') {
        const val = parseInt(msg.value);
        setActivePattern(val);
        sendBLECommand(val, speed || 40);
      } else if (msg.action === 'pulse') {
        sendBLECommand(1, parseInt(msg.value));
        // Quick release for tactile feel
        setTimeout(() => sendBLECommand(activePattern, speed), 100);
      } else if (msg.action === 'typing') {
        setRemoteIsTyping(msg.value);
      }
    }
  };

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
      setBleDevice(device);
      addLog('✓ Neuro-Interface Active');
      if (wsRef.current) wsRef.current.send(JSON.stringify({ action: 'status', value: 'Bridge Online' }));
    } catch (err) {
      addLog(`X Interface Error: ${err.message}`);
    }
  };

  const sendBLECommand = async (mode, rawSpeed) => {
    if (!bleCharsRef.current.length) return;
    const intensity = Math.min(255, Math.max(0, Math.floor((rawSpeed / 100) * 255)));
    const finalMode = rawSpeed === 0 ? 0 : mode;
    const cmd = new Uint8Array([0xa0, 0x0c, 0x00, 0x00, finalMode, intensity]);
    try {
      await bleCharsRef.current[0].writeValue(cmd);
    } catch (err) { }
  };

  const updateSpeed = (val) => {
    const intVal = parseInt(val);
    setSpeed(intVal);
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN && role === 'controller') {
      wsRef.current.send(JSON.stringify({ action: 'speed', value: intVal }));
    }
    if (role === 'bridge') sendBLECommand(activePattern, intVal);
  };

  const emergencyStop = () => {
    updateSpeed(0);
    addLog('🛑 EMERGENCY PROTOCOL ENGAGED');
  };

  const handleTyping = (text) => {
    setInputText(text);
    if (role === 'controller' && wsRef.current?.readyState === WebSocket.OPEN) {
      const now = Date.now();
      if (now - lastPulseRef.current > 120) {
        wsRef.current.send(JSON.stringify({ action: 'pulse', value: 90 }));
        if (!isTyping) {
          setIsTyping(true);
          wsRef.current.send(JSON.stringify({ action: 'typing', value: true }));
        }
        clearTimeout(typingTimeoutRef.current);
        typingTimeoutRef.current = setTimeout(() => {
          setIsTyping(false);
          wsRef.current.send(JSON.stringify({ action: 'typing', value: false }));
        }, 2000);
        lastPulseRef.current = now;
      }
    }
  };

  const getReactionImage = () => {
    if (speed === 0) return REACTION_ASSETS.idle;
    if (speed < 30) return REACTION_ASSETS.low;
    if (speed < 70) return REACTION_ASSETS.medium;
    if (speed < 95) return REACTION_ASSETS.high;
    return REACTION_ASSETS.climax;
  };

  // --- Views ---

  if (!isAuthorized) {
    return (
      <div className="flex items-center justify-center min-h-screen p-6 relative">
        <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="glass-premium p-12 max-w-sm w-full text-center space-y-8">
          <Fingerprint className="text-red-800 mx-auto animate-pulse" size={64} />
          <div className="space-y-2">
            <h2 className="premium-title text-gradient">UNSEEN</h2>
            <p className="text-[10px] tracking-[0.6em] text-white/20 uppercase font-black">Authorized Personnel Only</p>
          </div>
          <form onSubmit={(e) => {
            e.preventDefault();
            if (passcode === '6969') {
              setIsAuthorized(true);
              sessionStorage.setItem('tf_auth', 'true');
            } else {
              addLog('Auth Failed');
            }
          }} className="space-y-4">
            <input
              type="password"
              placeholder="PASSWORD"
              className="input-premium w-full text-xl"
              value={passcode}
              onChange={e => setPasscode(e.target.value)}
            />
            <button type="submit" className="btn-premium w-full">ASCEND</button>
          </form>
        </motion.div>
      </div>
    );
  }

  if (isPanic) {
    return (
      <div className="min-h-screen bg-black flex flex-col items-center justify-center cursor-pointer" onClick={() => setIsPanic(false)}>
        <Lock size={80} className="text-white/5 animate-pulse" />
      </div>
    );
  }

  if (!role) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen p-8 space-y-12">
        <h1 className="premium-title text-white">CHOOSE YOUR PATH</h1>
        <div className="grid md:grid-cols-2 gap-8 max-w-4xl w-full">
          {[
            { id: 'controller', title: 'Dominate', desc: 'Remote Neural Override', icon: Gamepad2 },
            { id: 'bridge', title: 'Submit', desc: 'Physical Hardware Interface', icon: Activity }
          ].map(r => (
            <motion.div
              key={r.id}
              whileHover={{ scale: 1.02, y: -5 }}
              onClick={() => setRole(r.id)}
              className="glass p-12 text-center cursor-pointer group border-white/5 hover:border-red-900/30 transition-all"
            >
              <r.icon className="mx-auto text-white/20 group-hover:text-red-700 transition-colors mb-6" size={64} />
              <h2 className="text-3xl font-black italic uppercase font-syne mb-2">{r.title}</h2>
              <p className="text-[11px] uppercase tracking-widest text-white/30">{r.desc}</p>
            </motion.div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="app-container">
      {/* Reaction Particles Layer */}
      <AnimatePresence>
        {reactions.map(r => (
          <motion.div
            key={r.id}
            initial={{ y: 0, opacity: 1, scale: 0.5 }}
            animate={{ y: -400, opacity: 0, scale: 3 }}
            className="reaction-particle"
            style={{ left: `${r.x}%`, top: `${r.y}%` }}
          >
            {r.emoji}
          </motion.div>
        ))}
      </AnimatePresence>

      <nav className="glass px-12 py-6 flex justify-between items-center">
        <div className="flex items-center gap-6">
          <div className="bg-red-900/20 p-3 rounded-2xl border border-red-900/40">
            <Radio className="text-red-600 animate-pulse" size={24} />
          </div>
          <div>
            <h1 className="text-2xl font-black italic tracking-tighter uppercase font-syne">SILK.<span className="text-gradient">SHADOW</span></h1>
            <div className={`text-[9px] font-black uppercase tracking-[0.4em] flex items-center gap-2 ${connected ? 'text-red-500' : 'text-white/20'}`}>
              <div className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-red-600 shadow-[0_0_10px_red]' : 'bg-white/10'}`} />
              {status} PROTOCOL
            </div>
          </div>
        </div>

        <div className="flex items-center gap-8">
          <div className="nav-cluster">
            {['controls', 'media', 'secure'].map(tab => (
              <span key={tab} className={`nav-link ${activeTab === tab ? 'active' : ''}`} onClick={() => setActiveTab(tab)}>{tab}</span>
            ))}
          </div>
          <div className="flex gap-4">
            <button onClick={() => setIsPanic(true)} className="glass w-12 h-12 flex items-center justify-center text-white/20 hover:text-red-600 transition-all"><Lock size={20} /></button>
            <button onClick={() => { setRole(null); setConnected(false); if (wsRef.current) wsRef.current.close(); }} className="glass w-12 h-12 flex items-center justify-center text-white/20 hover:text-white transition-all"><LogOut size={20} /></button>
          </div>
        </div>
      </nav>

      <div className="main-content-grid">
        <div className="space-y-8">
          <div className={`reaction-stage glass ${speed > 50 ? 'beat-active' : ''}`}>
            <AnimatePresence mode="wait">
              <motion.img
                key={getReactionImage()}
                src={getReactionImage()}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 1 }}
                className="w-full h-full object-cover grayscale-[0.5] contrast-125"
              />
            </AnimatePresence>
            <div className="stage-overlay" />
            <div className="absolute top-8 left-8 flex items-center gap-3 bg-black/80 px-4 py-2 rounded-xl border border-white/5">
              <Activity size={14} className="text-red-600" />
              <span className="text-[10px] font-black uppercase tracking-widest text-white/50">Neural Feedback</span>
            </div>

            {connected && (
              <div className="absolute top-8 right-8 flex gap-3">
                <button onClick={() => { if (wsRef.current) wsRef.current.send(JSON.stringify({ action: 'reaction', value: '🔥' })); spawnReaction('🔥') }} className="p-4 glass hover:bg-red-900/20"><Flame size={20} className="text-red-500" /></button>
                <button onClick={() => { if (wsRef.current) wsRef.current.send(JSON.stringify({ action: 'reaction', value: '❤️' })); spawnReaction('❤️') }} className="p-4 glass hover:bg-red-900/20"><Heart size={20} className="text-red-500" /></button>
              </div>
            )}

            <div className="absolute bottom-8 inset-x-8 space-y-4">
              <div className="flex justify-between items-end">
                <div className="text-4xl font-black italic font-syne text-white">{speed}%</div>
                <div className="text-[10px] font-black uppercase tracking-[0.3em] text-white/20">Kinetic Output</div>
              </div>
              <div className="intensity-meter">
                <div className="intensity-bar" style={{ width: `${speed}%` }} />
              </div>
            </div>
          </div>

          <div className="glass p-12 space-y-10 relative overflow-hidden">
            {/* Large unmissable stop button if in high speed */}
            {role === 'controller' ? (
              <div className="space-y-8">
                <div className="flex justify-between">
                  <h2 className="text-2xl font-black italic uppercase font-syne">Neural Command</h2>
                  {speed > 0 && <button onClick={emergencyStop} className="px-6 py-2 bg-red-900 border border-red-600 text-white rounded-xl text-[10px] font-black tracking-widest uppercase hover:bg-black transition-all">Emergency Stop</button>}
                </div>
                <input type="range" min="0" max="100" value={speed} onChange={e => updateSpeed(e.target.value)} className="w-full h-2 rounded-lg bg-white/5 accent-red-600 cursor-pointer" />
                <div className="grid grid-cols-4 gap-4">
                  {[
                    { emoji: '🔞', label: 'Surge' },
                    { emoji: '🌊', label: 'Tide' },
                    { emoji: '⚡', label: 'Static' },
                    { emoji: '🫦', label: 'Bite' }
                  ].map(r => (
                    <button key={r.label} onClick={() => { if (wsRef.current) wsRef.current.send(JSON.stringify({ action: 'reaction', value: r.emoji })); spawnReaction(r.emoji) }} className="glass p-6 hover:bg-white/5 transition-all text-2xl">{r.emoji}</button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="py-16 text-center space-y-6">
                <Signal className="mx-auto text-white/5 animate-pulse" size={48} />
                <p className="text-[10px] tracking-[0.8em] font-black text-white/10 uppercase">Waiting for Neural Sync</p>
              </div>
            )}
          </div>
        </div>

        <div className="space-y-8">
          <div className="glass p-10 space-y-8">
            <div className="flex items-center gap-3">
              <Cpu className="text-red-800" size={20} />
              <h3 className="text-xs font-black uppercase tracking-widest text-white/40">Sync Protocol</h3>
            </div>
            <div className="space-y-4">
              <div className="relative">
                <input type="text" value={deviceId} onChange={e => setDeviceId(e.target.value)} disabled={connected} className="input-premium w-full pl-6 text-left" />
                <div className="absolute right-6 top-1/2 -translate-y-1/2 opacity-20"><Terminal size={16} /></div>
              </div>
              <button onClick={connectWS} className="btn-premium w-full flex items-center justify-center gap-3">
                {connected ? <RefreshCw className="animate-spin-slow" size={16} /> : <Zap size={16} />}
                {connected ? 'RE-SYNC CORE' : 'ESTABLISH TUNNEL'}
              </button>

              {(role === 'bridge' || connected) && (
                <div className="grid grid-cols-1 gap-3 pt-4 border-t border-white/5">
                  <button onClick={connectBLE} className={`w-full py-4 glass text-[10px] font-black tracking-widest uppercase flex items-center justify-center gap-3 ${bleDevice ? 'text-red-500 border-red-900/40' : 'text-white/20'}`}>
                    <Bluetooth size={16} /> {bleDevice ? 'Link Integrated' : 'Connect Hardware'}
                  </button>
                  <button onClick={() => {
                    const url = `${window.location.origin}/?deviceId=${deviceId}&passcode=6969&role=controller`;
                    navigator.clipboard.writeText(url);
                    addLog('Coordinates Copied');
                  }} className="w-full py-4 glass-premium text-red-500 text-[10px] font-black tracking-widest uppercase flex items-center justify-center gap-3">
                    <Copy size={16} /> Share Neural Portal
                  </button>
                </div>
              )}
            </div>
          </div>

          <div className="glass p-8 flex flex-col h-[400px]">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-xs font-black uppercase tracking-widest text-white/40">Console Output</h3>
              <Trash2 className="text-white/10 hover:text-red-900 cursor-pointer" size={14} onClick={() => setLogs([])} />
            </div>
            <div className="flex-1 overflow-y-auto custom-scrollbar space-y-2 font-mono text-[10px]">
              {logs.map((log, i) => (
                <div key={i} className="flex gap-4 opacity-40 hover:opacity-100 transition-opacity">
                  <span className="text-red-800 shrink-0">{log.split(' ')[0]}</span>
                  <span className="text-white/80">{log.split(' ').slice(1).join(' ')}</span>
                </div>
              ))}
              {logs.length === 0 && <div className="text-center py-20 text-white/5 uppercase tracking-[1em] font-black">Null Data</div>}
            </div>
          </div>
        </div>
      </div>

      <footer className="mt-12 text-center">
        <p className="text-[10px] text-white/5 uppercase tracking-[2em] font-black">Silk & Shadow Protocol 2026</p>
      </footer>
    </div>
  );
}

export default App;

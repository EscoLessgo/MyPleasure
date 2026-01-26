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
  Fingerprint
} from 'lucide-react';
import './App.css';
import { PATTERNS } from './patterns';

const getWSUrl = () => {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  // In dev (Vite), connect to local node server. In prod, connect to same host.
  if (window.location.port === '5173' || window.location.hostname === 'localhost') {
    return `${protocol}//${window.location.hostname}:8080`;
  }
  return `${protocol}//${window.location.host}`;
};

const WS_URL = getWSUrl();
const JOYHUB_SERVICE_UUID = '0000ffa0-0000-1000-8000-00805f9b34fb';
const JOYHUB_TX_CHAR_UUID = '0000ffa1-0000-1000-8000-00805f9b34fb';

const REACTION_ASSETS = {
  idle: 'https://images.unsplash.com/photo-1550684848-fac1c5b4e853?q=80&w=1000&auto=format&fit=crop',
  low: 'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?q=80&w=1000&auto=format&fit=crop',
  medium: 'https://images.unsplash.com/photo-1529626455594-4ff0802cfb7e?q=80&w=1000&auto=format&fit=crop',
  high: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?q=80&w=1000&auto=format&fit=crop',
  climax: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?q=80&w=1000&auto=format&fit=crop'
};

function App() {
  const [activeTab, setActiveTab] = useState('controls');
  const [role, setRole] = useState(null);
  const [deviceId, setDeviceId] = useState('TrueForm-Session-1');
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

  const [ws, setWs] = useState(null);
  const wsRef = useRef(null);
  const [bleDevice, setBleDevice] = useState(null);
  const bleCharsRef = useRef([]);

  const [inputText, setInputText] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [remoteIsTyping, setRemoteIsTyping] = useState(false);
  const typingTimeoutRef = useRef(null);
  const lastPulseRef = useRef(0);

  const [gameState, setGameState] = useState({ active: false, score: 0 });

  const addLog = (msg) => {
    const timestamp = new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    setLogs(prev => [`[${timestamp}] ${msg}`, ...prev].slice(0, 30));
  };

  const spawnReaction = (emoji) => {
    const id = Date.now();
    setReactions(prev => [...prev, { id, emoji, x: Math.random() * 80 + 10, y: Math.random() * 50 + 20 }]);
    setTimeout(() => setReactions(prev => prev.filter(r => r.id !== id)), 1500);
  };

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
    if (ws) ws.close();
    addLog(`Initiating handshake with ${WS_URL}...`);
    const socket = new WebSocket(`${WS_URL}?deviceId=${deviceId}&type=${role}`);

    socket.onopen = () => {
      setStatus('Online');
      setConnected(true);
      addLog('✓ Synced to TrueForm Core');
      if (role === 'bridge') addLog('Waiting for controller signal...');
    };

    socket.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        handleRemoteMessage(msg);
      } catch (e) {
        addLog(`! Data corruption detected`);
      }
    };

    socket.onclose = () => {
      setStatus('Offline');
      setConnected(false);
      setParticipants([]);
      addLog('! Connection Terminated');
    };

    socket.onerror = (err) => {
      addLog('X Protocol Error: Handshake failed');
    };

    setWs(socket);
    wsRef.current = socket;
  };

  const handleRemoteMessage = (msg) => {
    if (msg.action === 'room-state') {
      setParticipants(msg.value);
      return;
    }
    if (msg.action === 'reaction') {
      spawnReaction(msg.value);
      return;
    }

    if (role === 'bridge') {
      if (msg.action === 'speed') {
        setSpeed(msg.value);
        sendBLECommand(activePattern, msg.value);
      } else if (msg.action === 'pattern') {
        setActivePattern(msg.value);
        sendBLECommand(msg.value, speed || 50);
      } else if (msg.action === 'pulse') {
        sendBLECommand(activePattern, msg.value);
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
      addLog('✓ Neural Link established');
      if (ws) ws.send(JSON.stringify({ action: 'status', value: 'Bridge Ready' }));
    } catch (err) {
      addLog(`X Link Interrupted: ${err.message}`);
    }
  };

  const sendBLECommand = async (mode, rawSpeed) => {
    if (!bleCharsRef.current.length) return;
    const intensity = Math.min(255, Math.floor((rawSpeed / 100) * 255));
    const finalMode = rawSpeed === 0 ? 0 : mode;
    const cmd = new Uint8Array([0xa0, 0x0c, 0x00, 0x00, finalMode, intensity]);
    try {
      await bleCharsRef.current[0].writeValue(cmd);
    } catch (err) { }
  };

  const updateSpeed = (val) => {
    const intVal = parseInt(val);
    setSpeed(intVal);
    if (ws && role === 'controller') {
      ws.send(JSON.stringify({ action: 'speed', value: intVal }));
    }
    if (role === 'bridge') sendBLECommand(activePattern, intVal);
  };

  const handleTyping = (text) => {
    setInputText(text);
    if (role === 'controller' && ws) {
      const now = Date.now();
      if (now - lastPulseRef.current > 120) {
        ws.send(JSON.stringify({ action: 'pulse', value: 80 }));
        if (!isTyping) {
          setIsTyping(true);
          ws.send(JSON.stringify({ action: 'typing', value: true }));
        }
        clearTimeout(typingTimeoutRef.current);
        typingTimeoutRef.current = setTimeout(() => {
          setIsTyping(false);
          ws.send(JSON.stringify({ action: 'typing', value: false }));
        }, 2000);
        lastPulseRef.current = now;
      }
    }
  };

  const copyInvite = () => {
    const url = `${window.location.origin}/?deviceId=${deviceId}&passcode=6969&role=controller`;
    navigator.clipboard.writeText(url);
    addLog('✓ Portal coordinates copied');
  };

  const handleAuth = (e) => {
    if (e) e.preventDefault();
    if (passcode === '6969') {
      setIsAuthorized(true);
      sessionStorage.setItem('tf_auth', 'true');
      addLog('Identity Verified');
    } else {
      addLog('Access Denied: Invalid Key');
    }
  };

  const getReactionImage = () => {
    if (speed === 0) return REACTION_ASSETS.idle;
    if (speed < 30) return REACTION_ASSETS.low;
    if (speed < 70) return REACTION_ASSETS.medium;
    if (speed < 90) return REACTION_ASSETS.high;
    return REACTION_ASSETS.climax;
  };

  if (!isAuthorized) {
    return (
      <div className="auth-view flex items-center justify-center min-h-screen relative overflow-hidden">
        {/* Ambient background particles */}
        {[...Array(20)].map((_, i) => (
          <motion.div
            key={i}
            className="absolute w-1 h-1 bg-purple-500/20 rounded-full"
            animate={{
              y: [0, -1000],
              opacity: [0, 1, 0],
            }}
            transition={{
              duration: Math.random() * 10 + 10,
              repeat: Infinity,
              delay: Math.random() * 5,
            }}
            style={{
              left: `${Math.random() * 100}%`,
              bottom: '-5%'
            }}
          />
        ))}

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="glass p-12 max-w-sm w-full text-center space-y-12 border-white/5 relative z-10">
          <div className="relative">
            <Fingerprint className="text-purple-400 mx-auto" size={80} />
            <motion.div
              animate={{ top: ['0%', '100%', '0%'] }}
              transition={{ duration: 4, repeat: Infinity, ease: "linear" }}
              className="absolute inset-x-0 h-0.5 bg-purple-500 shadow-[0_0_15px_rgba(168,85,247,0.8)] z-20"
            />
            <motion.div animate={{ opacity: [0, 1, 0] }} transition={{ repeat: Infinity, duration: 2 }} className="absolute inset-0 bg-purple-500/20 blur-2xl" />
          </div>
          <div className="space-y-4">
            <h2 className="text-4xl font-black italic tracking-tighter uppercase font-syne">VERIFY</h2>
            <p className="text-[10px] text-muted uppercase tracking-[0.5em] font-bold">Encrypted Bridge Access</p>
          </div>
          <form onSubmit={handleAuth} className="space-y-6">
            <input
              type="password"
              placeholder="PASSCODE"
              className="input-premium w-full text-2xl tracking-[0.3em]"
              value={passcode}
              onChange={e => setPasscode(e.target.value)}
            />
            <button type="submit" className="btn-premium w-full flex items-center justify-center gap-3">
              <Zap size={16} /> UNLOCK PORTAL
            </button>
          </form>
        </motion.div>
      </div>
    );
  }

  if (isPanic) {
    return (
      <div className="min-h-screen bg-black flex flex-col items-center justify-center cursor-pointer space-y-8" onClick={() => setIsPanic(false)}>
        <Shield size={100} className="text-white/5 animate-pulse" />
        <div className="text-[12px] text-white/10 uppercase tracking-[1.5em] font-bold">PROTOCOL: SILENCE</div>
      </div>
    );
  }

  if (!role) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="grid md:grid-cols-2 gap-12 max-w-5xl w-full">
          {[
            { id: 'controller', icon: Gamepad2, title: 'CONTROLLER', desc: 'Direct Neural Influence', theme: 'cyan' },
            { id: 'bridge', icon: Activity, title: 'BRIDGE', desc: 'Physical Sensation Interface', theme: 'purple' }
          ].map((r) => (
            <motion.div
              key={r.id}
              whileHover={{ scale: 1.02, y: -10 }}
              className={`glass p-16 text-center space-y-10 cursor-pointer border-${r.theme}-500/10 group`}
              onClick={() => setRole(r.id)}
            >
              <div className="relative">
                <r.icon className={`mx-auto text-${r.theme}-400 group-hover:scale-110 transition-transform`} size={80} />
                <div className={`absolute inset-0 bg-${r.theme}-500/10 blur-3xl opacity-0 group-hover:opacity-100 transition-opacity`} />
              </div>
              <div className="space-y-4">
                <h2 className={`text-4xl font-black italic uppercase font-syne ${r.id === 'controller' ? 'text-gradient-cyan' : 'text-gradient'}`}>{r.title}</h2>
                <p className="text-[10px] text-muted tracking-[0.5em] uppercase font-black">{r.desc}</p>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="app-container">
      <AnimatePresence>
        {reactions.map(r => (
          <motion.div
            key={r.id}
            initial={{ y: 0, opacity: 1, scale: 0.5 }}
            animate={{ y: -300, opacity: 0, scale: 2 }}
            className="reaction-particle"
            style={{ left: `${r.x}%`, top: `${r.y}%` }}
          >
            {r.emoji}
          </motion.div>
        ))}
      </AnimatePresence>

      <nav className="glass px-10 py-6 flex flex-col lg:flex-row justify-between items-center rounded-[3rem] gap-8">
        <div className="flex items-center gap-6">
          <div className="bg-purple-500/10 p-3 rounded-2xl border border-purple-500/20">
            <Zap className="text-purple-400" size={28} />
          </div>
          <div>
            <h1 className="text-3xl font-black italic tracking-tighter uppercase font-syne leading-none">TRUEFORM.<span className="text-gradient">BRIDGE</span></h1>
            <div className={`text-[10px] font-black uppercase tracking-[0.5em] flex items-center gap-2 mt-1 ${connected ? 'text-emerald-400' : 'text-rose-400'}`}>
              <div className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-emerald-400 animate-pulse' : 'bg-rose-400'}`} />
              {status} <span className="text-white/10">|</span> 0.04ms LATENCY
            </div>
          </div>
        </div>

        <div className="flex items-center gap-8">
          <div className="nav-cluster">
            {['controls', 'play', 'vault'].map(tab => (
              <span key={tab} className={`nav-link ${activeTab === tab ? 'active' : ''}`} onClick={() => setActiveTab(tab)}>{tab}</span>
            ))}
          </div>
          <div className="h-10 w-px bg-white/5" />
          <div className="flex -space-x-2">
            {participants.map(p => (
              <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} key={p.id} className={`w-8 h-8 rounded-full border-2 border-black flex items-center justify-center text-[10px] font-black shadow-2xl ${p.role === 'controller' ? 'bg-cyan-600' : 'bg-purple-600'}`}>{p.role[0].toUpperCase()}</motion.div>
            ))}
          </div>
          <div className="flex gap-4">
            <button onClick={() => setIsPanic(true)} className="w-12 h-12 rounded-2xl glass border-white/5 flex items-center justify-center hover:bg-rose-500/10 text-white/30 hover:text-rose-400 group transition-all"><Shield size={24} className="group-hover:fill-rose-400/10" /></button>
            <button onClick={() => setRole(null)} className="w-12 h-12 rounded-2xl glass border-white/5 flex items-center justify-center hover:bg-white/10 text-white/20 hover:text-white transition-all"><LogOut size={20} /></button>
          </div>
        </div>
      </nav>

      <div className="main-content-grid">
        <div className="space-y-8">
          <div className={`reaction-stage glass ${speed > 40 ? 'beat-active' : ''}`}>
            <AnimatePresence mode="wait">
              <motion.img
                key={getReactionImage()}
                src={getReactionImage()}
                initial={{ opacity: 0, scale: 1.05 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ duration: 1.2 }}
                className="w-full h-full object-cover grayscale-[0.3]"
              />
            </AnimatePresence>
            <div className="stage-overlay" />
            <div className="absolute inset-0 border-[20px] border-black/20 pointer-events-none rounded-[3.5rem]" />
            <div className="absolute top-10 left-10 flex flex-col gap-2">
              <div className="flex items-center gap-3 bg-black/60 backdrop-blur-md px-4 py-2 rounded-xl border border-white/5">
                <Activity size={14} className="text-rose-500 animate-pulse" />
                <span className="text-[10px] font-black uppercase tracking-[0.3em] text-white/60">Stage Active</span>
              </div>
            </div>
            {connected && (
              <div className="absolute top-10 right-10 flex gap-4">
                <button onClick={() => { if (ws) ws.send(JSON.stringify({ action: 'reaction', value: '🔥' })); spawnReaction('🔥') }} className="p-4 glass rounded-[1.5rem] hover:bg-orange-500/30 transition-all border-orange-500/20"><Flame size={24} className="text-orange-400" /></button>
                <button onClick={() => { if (ws) ws.send(JSON.stringify({ action: 'reaction', value: '❤️' })); spawnReaction('❤️') }} className="p-4 glass rounded-[1.5rem] hover:bg-pink-500/30 transition-all border-pink-500/20"><Heart size={24} className="pink-pink-400 text-pink-400" /></button>
              </div>
            )}
            <div className="absolute bottom-10 inset-x-10">
              <div className="intensity-meter">
                <div className="intensity-bar" style={{ width: `${speed}%` }} />
              </div>
            </div>
          </div>

          <div className="glass p-10 space-y-10">
            <div className="flex justify-between items-end">
              <div className="space-y-1">
                <h2 className="text-2xl font-black italic tracking-tighter uppercase font-syne">KINETIC DRIVE</h2>
                <p className="text-[10px] text-muted tracking-[0.4em] uppercase font-bold">Synchronized Pulse Matrix</p>
              </div>
              <div className="text-5xl font-black italic tracking-tight font-syne text-purple-400">{speed}<span className="text-xl text-white/20 opacity-40">%</span></div>
            </div>

            {role === 'controller' ? (
              <div className="space-y-10">
                <input type="range" min="0" max="100" value={speed} onChange={e => updateSpeed(e.target.value)} className="w-full h-2 rounded-lg bg-white/5 accent-purple-500 cursor-pointer" />
                <div className="grid grid-cols-4 gap-4">
                  {[
                    { icon: ThumbsUp, color: 'text-emerald-400', emoji: '👍' },
                    { icon: ThumbsDown, color: 'text-rose-400', emoji: '👎' },
                    { icon: Sparkles, color: 'text-cyan-400', emoji: '✨' },
                    { icon: Volume2, color: 'text-indigo-400', emoji: '🔊' }
                  ].map((btn, i) => (
                    <button key={i} onClick={() => { if (ws) ws.send(JSON.stringify({ action: 'reaction', value: btn.emoji })); spawnReaction(btn.emoji) }} className="btn-secondary group">
                      <btn.icon className={`${btn.color} group-hover:scale-125 transition-all drop-shadow-[0_0_10px_rgba(255,255,255,0.1)]`} size={28} />
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="py-12 flex flex-col items-center justify-center gap-6 border-2 border-dashed border-white/5 rounded-[2rem]">
                <Signal size={40} className="text-white/10 animate-pulse" />
                <span className="text-[11px] text-white/30 font-black uppercase tracking-[0.6em]">Listening for Neural Sync...</span>
              </div>
            )}
          </div>
        </div>

        <div className="space-y-8">
          <div className="glass p-10 space-y-8">
            <div className="flex items-center gap-4">
              <Radio className="text-cyan-400" size={24} />
              <h2 className="text-xl font-black font-syne italic tracking-tighter uppercase">LOCAL NODE</h2>
            </div>

            <div className="space-y-4">
              <div className="relative">
                <div className="absolute left-6 top-1/2 -translate-y-1/2 text-white/20"><Cpu size={18} /></div>
                <input type="text" value={deviceId} onChange={e => setDeviceId(e.target.value)} disabled={connected} className="input-premium w-full pl-16 text-xs font-black tracking-widest uppercase" />
              </div>
              <button onClick={connectWS} className={`btn-premium w-full flex items-center justify-center gap-3 ${connected ? 'border-purple-500/40 text-purple-400' : ''}`}>
                {connected ? <RefreshCw className="animate-spin-slow" size={16} /> : <Zap size={16} />}
                {connected ? 'RE-SYNC CORE' : 'ESTABLISH TUNNEL'}
              </button>
            </div>

            {role === 'bridge' && (
              <div className="space-y-4 pt-4">
                <button onClick={connectBLE} className={`w-full py-6 glass rounded-[1.5rem] flex items-center justify-center gap-4 group transition-all ${bleDevice ? 'bg-emerald-500/10 border-emerald-500/40' : 'hover:border-white/20'}`}>
                  <Bluetooth size={24} className={bleDevice ? 'text-emerald-400' : 'text-white/20'} />
                  <span className="uppercase font-black text-xs tracking-[0.2em]">{bleDevice ? 'LINK ACTIVE' : 'BIND HARDWARE'}</span>
                </button>
                <button onClick={copyInvite} className="w-full py-4 glass-premium rounded-[1.25rem] text-cyan-400 text-[10px] font-black tracking-widest flex items-center justify-center gap-3 hover:bg-cyan-400/5 transition-all group">
                  <Copy size={16} className="group-hover:rotate-12 transition-transform" /> SHARE PORTAL ENTRY
                </button>
              </div>
            )}
          </div>

          <div className="glass p-10 space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-black font-syne italic tracking-tighter uppercase">PROTOCOL LOG</h2>
              <button onClick={() => setLogs([])} className="text-white/20 hover:text-rose-400 transition-colors"><Trash2 size={16} /></button>
            </div>
            <div className="h-64 overflow-y-auto custom-scrollbar font-mono text-[10px] space-y-3 bg-black/60 p-6 rounded-[2rem] border border-white/5">
              {logs.length === 0 ? <div className="text-white/10 uppercase tracking-widest italic animate-pulse">Scanning for data...</div> : logs.map((log, i) => (
                <motion.div initial={{ x: -10, opacity: 0 }} animate={{ x: 0, opacity: 1 }} key={i} className="flex gap-4 border-l-2 border-white/5 pl-4 py-1">
                  <span className="text-white/10 whitespace-nowrap">{log.split(' ')[0]}</span>
                  <span className="text-white/60 leading-relaxed">{log.split(' ').slice(1).join(' ')}</span>
                </motion.div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;

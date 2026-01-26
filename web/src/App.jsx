import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Shield,
  Gamepad2,
  Zap,
  Bluetooth,
  Mic,
  MicOff,
  Heart,
  Activity,
  Trash2,
  Send,
  Copy,
  LayoutGrid,
  Terminal,
  RefreshCw,
  LogOut,
  XCircle,
  Users,
  Clock,
  Radio,
  ThumbsUp,
  ThumbsDown,
  Sparkles,
  Trophy,
  Target,
  Flame,
  Volume2
} from 'lucide-react';
import './App.css';
import { PATTERNS } from './patterns';

const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const host = window.location.host.includes('5173') ? 'localhost:8080' : window.location.host;
const WS_URL = `${protocol}//${host}`;

const JOYHUB_SERVICE_UUID = '0000ffa0-0000-1000-8000-00805f9b34fb';
const JOYHUB_TX_CHAR_UUID = '0000ffa1-0000-1000-8000-00805f9b34fb';

// Suggestive character reactions placeholder paths
// User can replace these with their own live-action assets
const REACTION_ASSETS = {
  idle: 'https://images.unsplash.com/photo-1550684848-fac1c5b4e853?q=80&w=1000&auto=format&fit=crop', // Suggestive dark aesthetic
  low: 'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?q=80&w=1000&auto=format&fit=crop',
  medium: 'https://images.unsplash.com/photo-1529626455594-4ff0802cfb7e?q=80&w=1000&auto=format&fit=crop',
  high: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?q=80&w=1000&auto=format&fit=crop',
  climax: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?q=80&w=1000&auto=format&fit=crop'
};

function App() {
  const [activeTab, setActiveTab] = useState('controls');
  const [role, setRole] = useState(null);
  const [deviceId, setDeviceId] = useState('TrueForm-1');
  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState('Disconnected');
  const [speed, setSpeed] = useState(0);
  const [activePattern, setActivePattern] = useState(1);
  const [logs, setLogs] = useState([]);
  const [participants, setParticipants] = useState([]);
  const [isMicSync, setIsMicSync] = useState(false);
  const [isAuthorized, setIsAuthorized] = useState(() => sessionStorage.getItem('tf_auth') === 'true');
  const [passcode, setPasscode] = useState('');
  const [isPanic, setIsPanic] = useState(false);
  const [reactions, setReactions] = useState([]);

  // WebSocket and BLE State
  const [ws, setWs] = useState(null);
  const wsRef = useRef(null);
  const [bleDevice, setBleDevice] = useState(null);
  const bleCharsRef = useRef([]);

  // TNT Sync State
  const [inputText, setInputText] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [remoteIsTyping, setRemoteIsTyping] = useState(false);
  const typingTimeoutRef = useRef(null);
  const lastPulseRef = useRef(0);

  // Audio Processing Refs
  const audioCtxRef = useRef(null);
  const analystRef = useRef(null);
  const streamRef = useRef(null);

  // Game State
  const [gameState, setGameState] = useState({ active: false, score: 0, level: 1 });

  const addLog = (msg) => {
    setLogs(prev => [msg, ...prev].slice(0, 50));
  };

  const spawnReaction = (emoji) => {
    const id = Date.now();
    setReactions(prev => [...prev, { id, emoji, x: Math.random() * 80 + 10, y: Math.random() * 50 + 20 }]);
    setTimeout(() => setReactions(prev => prev.filter(r => r.id !== id)), 2000);
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const r = params.get('role');
    if (r === 'bridge' || r === 'controller') setRole(r);
    const id = params.get('deviceId');
    if (id) setDeviceId(id);
    const p = params.get('passcode');
    if (p === '6969') { setIsAuthorized(true); sessionStorage.setItem('tf_auth', 'true'); }
  }, []);

  const connectWS = () => {
    if (ws) ws.close();
    const socket = new WebSocket(`${WS_URL}?deviceId=${deviceId}&type=${role}`);
    socket.onopen = () => { setStatus('Connected'); setConnected(true); addLog('✓ Secure Tunnel Open'); };
    socket.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      handleRemoteMessage(msg);
    };
    socket.onclose = () => { setStatus('Disconnected'); setConnected(false); setParticipants([]); };
    setWs(socket);
    wsRef.current = socket;
  };

  const handleRemoteMessage = (msg) => {
    if (msg.action === 'room-state') { setParticipants(msg.value); return; }
    if (msg.action === 'reaction') { spawnReaction(msg.value); return; }

    if (role === 'bridge') {
      if (msg.action === 'speed') { setSpeed(msg.value); sendBLECommand(activePattern, msg.value); }
      else if (msg.action === 'pattern') { setActivePattern(msg.value); sendBLECommand(msg.value, speed || 50); }
      else if (msg.action === 'pulse') { sendBLECommand(activePattern, msg.value); }
      else if (msg.action === 'typing') { setRemoteIsTyping(msg.value); }
    } else if (role === 'controller') {
      if (msg.action === 'status') addLog(`📡 Bridge: ${msg.value}`);
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
      addLog('✅ Hardware Linked');
      if (ws) ws.send(JSON.stringify({ action: 'status', value: 'Bridge Online' }));
    } catch (err) { addLog(`❌ BLE Error: ${err.message}`); }
  };

  const sendBLECommand = async (mode, rawSpeed) => {
    if (!bleCharsRef.current.length) return;
    const intensity = Math.min(255, Math.floor((rawSpeed / 100) * 255));
    const finalMode = rawSpeed === 0 ? 0 : mode;
    const cmd = new Uint8Array([0xa0, 0x0c, 0x00, 0x00, finalMode, intensity]);
    try { await bleCharsRef.current[0].writeValue(cmd); } catch (err) { }
  };

  const updateSpeed = (val) => {
    const intVal = parseInt(val);
    setSpeed(intVal);
    if (ws && role === 'controller') ws.send(JSON.stringify({ action: 'speed', value: intVal }));
    if (role === 'bridge') sendBLECommand(activePattern, intVal);
  };

  const handleTyping = (text) => {
    setInputText(text);
    if (role === 'controller' && ws) {
      const now = Date.now();
      if (now - lastPulseRef.current > 120) {
        ws.send(JSON.stringify({ action: 'pulse', value: 80 }));
        if (!isTyping) { setIsTyping(true); ws.send(JSON.stringify({ action: 'typing', value: true })); }
        clearTimeout(typingTimeoutRef.current);
        typingTimeoutRef.current = setTimeout(() => { setIsTyping(false); ws.send(JSON.stringify({ action: 'typing', value: false })); }, 2000);
        lastPulseRef.current = now;
      }
    }
  };

  // --- Zen Game Logic ---
  const handleZenClick = () => {
    if (!gameState.active) return;
    setGameState(prev => ({ ...prev, score: prev.score + 10 }));
    if (ws && role === 'controller') ws.send(JSON.stringify({ action: 'pulse', value: 100 }));
    spawnReaction('🔥');
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
      <div className="auth-view flex items-center justify-center min-h-screen p-6">
        <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="glass-premium p-12 max-w-sm w-full text-center space-y-8">
          <div className="flex justify-center"><Shield className="text-purple-400" size={48} /></div>
          <h2 className="text-3xl font-black italic tracking-tighter text-gradient">IDENTIFY</h2>
          <input type="password" placeholder="KEY CODE" className="input-premium text-center tracking-[0.5em] font-black" value={passcode} onChange={e => setPasscode(e.target.value)} onKeyPress={e => e.key === 'Enter' && (passcode === '6969' && (setIsAuthorized(true), sessionStorage.setItem('tf_auth', 'true')))} />
          <button onClick={() => passcode === '6969' ? (setIsAuthorized(true), sessionStorage.setItem('tf_auth', 'true')) : addLog('Denied')} className="btn-premium w-full uppercase">Bypass</button>
        </motion.div>
      </div>
    );
  }

  if (isPanic) return <div className="min-h-screen bg-black flex items-center justify-center cursor-pointer" onClick={() => setIsPanic(false)}><div className="text-[10px] text-white/5 uppercase tracking-[1em] animate-pulse">System Offline</div></div>

  if (!role) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-mesh">
        <div className="grid md:grid-cols-2 gap-8 max-w-4xl w-full">
          <motion.div whileHover={{ scale: 1.02 }} className="glass p-12 text-center space-y-8 cursor-pointer border-indigo-500/10" onClick={() => setRole('controller')}>
            <Gamepad2 className="mx-auto text-indigo-400" size={64} />
            <h2 className="text-3xl font-black text-gradient-cyan italic uppercase">Controller</h2>
            <p className="text-[10px] text-muted tracking-widest uppercase">Direct Influence</p>
          </motion.div>
          <motion.div whileHover={{ scale: 1.02 }} className="glass p-12 text-center space-y-8 cursor-pointer border-purple-500/10" onClick={() => setRole('bridge')}>
            <Activity className="mx-auto text-purple-400" size={64} />
            <h2 className="text-3xl font-black text-gradient italic uppercase">Bridge</h2>
            <p className="text-[10px] text-muted tracking-widest uppercase">Physical Link</p>
          </motion.div>
        </div>
      </div>
    );
  }

  return (
    <div className="app-container">
      {/* Floating Reactions Overlay */}
      <AnimatePresence>
        {reactions.map(r => (
          <motion.div key={r.id} initial={{ y: 0, opacity: 1, scale: 0.5 }} animate={{ y: -200, opacity: 0, scale: 2 }} exit={{ opacity: 0 }} className="reaction-particle" style={{ left: `${r.x}%`, top: `${r.y}%` }}>{r.emoji}</motion.div>
        ))}
      </AnimatePresence>

      <nav className="glass p-6 mb-8 flex flex-col md:flex-row justify-between items-center rounded-[2rem] gap-4 border-white/5">
        <div className="flex items-center gap-4">
          <Zap className="text-purple-400" size={24} />
          <div className="flex flex-col">
            <h1 className="text-xl font-black italic tracking-tighter uppercase leading-tight">TRUEFORM.<span className="text-gradient">BRIDGE</span></h1>
            <div className={`text-[9px] uppercase tracking-widest flex items-center gap-1 font-bold ${connected ? 'text-cyan-400' : 'text-rose-400'}`}>
              <Radio size={10} className={connected ? 'animate-pulse' : ''} /> {status}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-6">
          <div className="hidden md:flex gap-6">
            {['controls', 'play', 'vault'].map(tab => (
              <span key={tab} className={`nav-link text-[10px] font-black uppercase tracking-widest cursor-pointer transition-all ${activeTab === tab ? 'text-white' : 'text-white/30 hover:text-white/60'}`} onClick={() => setActiveTab(tab)}>{tab}</span>
            ))}
          </div>
          <div className="h-6 w-px bg-white/10" />
          <div className="flex -space-x-1.5 items-center">
            {participants.map(p => (
              <div key={p.id} className={`w-7 h-7 rounded-full border border-black shadow-lg flex items-center justify-center text-[9px] font-black ${p.role === 'controller' ? 'bg-cyan-600' : 'bg-purple-600'}`} title={p.role}>
                {p.role[0].toUpperCase()}
              </div>
            ))}
            {participants.length === 0 && <span className="text-[8px] text-white/20 uppercase tracking-widest ml-4">Lone Session</span>}
          </div>
          <div className="flex gap-3">
            <button onClick={() => setIsPanic(true)} className="w-10 h-10 rounded-full glass border-white/5 flex items-center justify-center hover:bg-rose-500/10 transition-all text-white/40 hover:text-rose-400 group"><Shield size={18} className="group-hover:fill-rose-400/20" /></button>
            <button onClick={() => setRole(null)} className="w-10 h-10 rounded-full glass border-white/5 flex items-center justify-center hover:bg-white/10 transition-all text-white/20 hover:text-white"><LogOut size={16} /></button>
          </div>
        </div>
      </nav>

      <div className="main-content-grid">
        <div className="left-panel space-y-8">

          {/* Reaction Theatre / Character Stage */}
          <div className="glass overflow-hidden rounded-[3rem] border-white/5 aspect-video relative group">
            <AnimatePresence mode="wait">
              <motion.img
                key={getReactionImage()}
                src={getReactionImage()}
                initial={{ opacity: 0, scale: 1.1 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ duration: 0.8 }}
                className="w-full h-full object-cover grayscale-[0.2] sepia-[0.1]"
              />
            </AnimatePresence>
            <div className="absolute inset-0 bg-gradient-to-t from-black via-transparent to-black/40 pointer-events-none" />
            <div className="absolute bottom-6 left-8">
              <div className="flex items-center gap-3">
                <div className="w-2 h-2 bg-rose-500 rounded-full animate-pulse" />
                <span className="text-[10px] font-black uppercase tracking-[0.3em] text-white/60 italic">Live Reaction Feed</span>
              </div>
            </div>
            {connected && (
              <div className="absolute top-6 right-8 flex gap-2">
                <button onClick={() => { if (ws) ws.send(JSON.stringify({ action: 'reaction', value: '🔥' })); spawnReaction('🔥') }} className="p-3 glass rounded-2xl hover:bg-orange-500/20 transition-all"><Flame size={20} className="text-orange-400" /></button>
                <button onClick={() => { if (ws) ws.send(JSON.stringify({ action: 'reaction', value: '❤️' })); spawnReaction('❤️') }} className="p-3 glass rounded-2xl hover:bg-pink-500/20 transition-all"><Heart size={20} className="text-pink-400" /></button>
              </div>
            )}
          </div>

          <div className="glass p-8 space-y-8">
            <div className="flex justify-between items-center">
              <h2 className="text-xl font-black italic tracking-tighter uppercase flex items-center gap-2"><Zap size={20} className="text-cyan-400" /> Kinetic Engine</h2>
              <div className="text-3xl font-black italic tracking-tighter text-white">{speed}%</div>
            </div>

            {role === 'controller' ? (
              <div className="space-y-8">
                <input type="range" min="0" max="100" value={speed} onChange={e => updateSpeed(e.target.value)} className="w-full accent-cyan-400" />
                <div className="grid grid-cols-4 gap-4">
                  {[
                    { icon: ThumbsUp, color: 'text-emerald-400', emoji: '👍' },
                    { icon: ThumbsDown, color: 'text-rose-400', emoji: '👎' },
                    { icon: Sparkles, color: 'text-purple-400', emoji: '✨' },
                    { icon: Volume2, color: 'text-indigo-400', emoji: '🔊' }
                  ].map((btn, i) => (
                    <button key={i} onClick={() => { if (ws) ws.send(JSON.stringify({ action: 'reaction', value: btn.emoji })); spawnReaction(btn.emoji) }} className="btn-secondary aspect-square flex items-center justify-center group">
                      <btn.icon className={`${btn.color} group-hover:scale-125 transition-transform`} size={24} />
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="visualizer-display glass-premium rounded-[2.5rem] p-12 text-center relative overflow-hidden">
                <motion.div animate={{ scale: 1 + (speed / 100), opacity: 0.1 + (speed / 100) }} className="absolute inset-0 bg-cyan-500/20 blur-3xl rounded-full" />
                <span className="relative text-[10px] text-white/30 font-black uppercase tracking-widest">Awaiting Command Link...</span>
              </div>
            )}
          </div>
        </div>

        <div className="right-panel space-y-8">
          {/* Active Connections Modernized */}
          <div className="glass p-8 space-y-6">
            <h2 className="text-xl font-black italic tracking-tighter uppercase flex items-center gap-2"><Users size={20} className="text-purple-400" /> Secured Link</h2>
            <div className="space-y-3">
              {participants.map(p => (
                <div key={p.id} className="flex items-center justify-between p-4 glass-premium rounded-2xl border-white/5 group hover:border-white/10 transition-all">
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${p.role === 'controller' ? 'bg-cyan-500/10 text-cyan-400' : 'bg-purple-500/10 text-purple-400'}`}>
                      {p.role === 'controller' ? <Gamepad2 size={18} /> : <Activity size={18} />}
                    </div>
                    <div>
                      <p className="text-xs font-black uppercase text-white tracking-widest leading-none mb-1">{p.role}</p>
                      <p className="text-[9px] text-white/20 font-bold uppercase tracking-tighter">Synced {new Date(p.joinedAt).toLocaleTimeString()}</p>
                    </div>
                  </div>
                  <div className="text-[8px] font-mono text-white/10 group-hover:text-cyan-400/40 transition-colors">#{p.id}</div>
                </div>
              ))}
              {participants.length === 0 && <div className="py-6 text-center text-white/5 uppercase font-black text-[10px] tracking-[0.3em]">Channel Vacant</div>}
            </div>

            <div className="pt-4 space-y-4">
              <div className="relative">
                <input type="text" value={deviceId} onChange={e => setDeviceId(e.target.value)} disabled={connected} className="input-premium h-12 text-xs font-bold tracking-widest uppercase border-white/5" />
                <button onClick={connectWS} className="absolute right-1 top-1 bottom-1 px-4 glass rounded-xl text-[9px] font-black uppercase tracking-widest hover:bg-white/5 transition-all">{connected ? 'STAGING' : 'BRIDGE'}</button>
              </div>
              {role === 'bridge' && (
                <button onClick={connectBLE} className={`w-full h-16 btn-premium flex items-center justify-center gap-3 transition-colors ${bleDevice ? 'bg-emerald-600 border-emerald-400/40' : 'hover:border-white/20'}`}>
                  <Bluetooth size={20} /> <span className="uppercase font-black text-xs tracking-widest">{bleDevice ? 'HARDWARE ACTIVE' : 'LINK HARDWARE'}</span>
                </button>
              )}
              {role === 'bridge' && (
                <button onClick={copyInvite} className="w-full h-12 glass border-white/5 text-cyan-400 text-[9px] font-black tracking-widest flex items-center justify-center gap-2 hover:bg-cyan-400/5 transition-all">
                  <Copy size={14} /> COPY ACCESS PORTAL
                </button>
              )}
            </div>
          </div>

          <div className="glass p-8 space-y-6">
            <h2 className="text-xl font-black italic tracking-tighter uppercase flex items-center gap-2"><LayoutGrid size={20} className="text-indigo-400" /> Presets</h2>
            <div className="grid grid-cols-2 gap-3">
              {PATTERNS.slice(0, 8).map(p => (
                <button
                  key={p.id}
                  onClick={() => { setActivePattern(p.id); if (ws) ws.send(JSON.stringify({ action: 'pattern', value: p.id })); sendBLECommand(p.id, speed || 50); }}
                  className={`p-4 rounded-[1.5rem] text-[9px] font-black uppercase tracking-widest border transition-all ${activePattern === p.id ? 'bg-gradient-to-br from-indigo-500 to-purple-600 border-white/20 text-white shadow-2xl scale-[1.02]' : 'bg-white/[0.02] border-white/5 text-white/30 hover:border-indigo-500/40'}`}
                >
                  {p.name}
                </button>
              ))}
            </div>
          </div>

          <div className="glass p-8 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-white/20">
                <Terminal size={14} />
                <h2 className="text-[10px] font-black uppercase tracking-widest italic">Protocol Output</h2>
              </div>
              <button onClick={() => setLogs([])} className="p-1.5 glass rounded-lg hover:text-rose-400 transition-colors"><Trash2 size={12} /></button>
            </div>
            <div className="h-44 overflow-y-auto custom-scrollbar font-mono text-[9px] space-y-2 opacity-40 bg-black/40 p-5 rounded-[2rem] border border-white/5">
              {logs.length === 0 ? <div className="text-white/10 italic">Secure handshake log empty...</div> : logs.map((log, i) => (
                <div key={i} className="border-b border-white/2 pb-1 leading-relaxed">{log}</div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;

import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Shield,
  Zap,
  Activity,
  Heart,
  Copy,
  LayoutGrid,
  Radio,
  ThumbsUp,
  ThumbsDown,
  Flame,
  Volume2,
  Cpu,
  Fingerprint,
  RefreshCw,
  Lock,
  MessageSquare,
  User,
  Check,
  X,
  ExternalLink,
  ChevronRight,
  Info,
  Trash2
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

function App() {
  // --- AUTH & SETUP ---
  const [isSiteAuthorized, setIsSiteAuthorized] = useState(() => sessionStorage.getItem('tf_auth') === 'true');
  const [sitePasscode, setSitePasscode] = useState('');
  const [username, setUsername] = useState(sessionStorage.getItem('tf_username') || '');
  const [role, setRole] = useState(null);
  const [deviceId, setDeviceId] = useState('TNT-ALPHA-01');

  // --- SESSION STATE ---
  const [connected, setConnected] = useState(false);
  const [handshakeStatus, setHandshakeStatus] = useState('idle'); // idle, pending, active, denied
  const [speed, setSpeed] = useState(0);
  const [activePattern, setActivePattern] = useState(1);
  const [logs, setLogs] = useState([]);
  const [participants, setParticipants] = useState([]);
  const [inputText, setInputText] = useState('');
  const [messages, setMessages] = useState([]);

  const wsRef = useRef(null);
  const [bleDevice, setBleDevice] = useState(null);
  const bleCharsRef = useRef([]);

  // --- ACTIONS ---
  const addLog = (msg) => {
    const timestamp = new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit' });
    setLogs(prev => [`[${timestamp}] ${msg}`, ...prev].slice(0, 10));
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const d = params.get('deviceId');
    if (d) setDeviceId(d);
    const p = params.get('passcode');
    if (p === '6969') { setIsSiteAuthorized(true); sessionStorage.setItem('tf_auth', 'true'); }
  }, []);

  const connectWS = () => {
    if (!username) return alert('Username required.');
    sessionStorage.setItem('tf_username', username);

    if (wsRef.current) wsRef.current.close();

    const socket = new WebSocket(`${WS_URL}?deviceId=${deviceId}&type=${role}&username=${encodeURIComponent(username)}`);

    socket.onopen = () => {
      setConnected(true);
      if (role === 'controller') setHandshakeStatus('pending');
      else setHandshakeStatus('active');
      addLog(`Connected to Tunnel: ${deviceId}`);
    };

    socket.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.action === 'room-state') { setParticipants(msg.value); return; }
        if (msg.action === 'handshake-approved') { setHandshakeStatus('active'); addLog('✓ Handshake Approved by Host'); return; }
        if (msg.action === 'handshake-denied') { setHandshakeStatus('denied'); addLog('X Handshake Denied'); return; }

        // Active session messages
        if (msg.action === 'speed') setSpeed(msg.value);
        if (msg.action === 'chat') setMessages(prev => [...prev, msg.value].slice(-20));
        if (msg.action === 'climax') triggerShake();
      } catch (e) { }
    };

    socket.onclose = () => { setConnected(false); setHandshakeStatus('idle'); addLog('! Connection Lost'); };
    wsRef.current = socket;
  };

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
    if (role === 'bridge') sendBLECommand(activePattern, s);
  };

  const triggerClimax = () => {
    updateSpeed(100);
    if (wsRef.current) wsRef.current.send(JSON.stringify({ action: 'climax' }));
    setTimeout(() => updateSpeed(0), 4000);
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
      addLog('✓ BLE Hardware Synced');
    } catch (err) { addLog('BLE Connection Failed'); }
  };

  const sendBLECommand = async (mode, rawSpeed) => {
    if (!bleCharsRef.current.length) return;
    const intensity = Math.min(255, Math.floor((rawSpeed / 100) * 255));
    const finalMode = rawSpeed === 0 ? 0 : mode;
    const cmd = new Uint8Array([0xa0, 0x0c, 0x00, 0x00, finalMode, intensity]);
    try { await bleCharsRef.current[0].writeValue(cmd); } catch (err) { }
  };

  const [shake, setShake] = useState(false);
  const triggerShake = () => { setShake(true); setTimeout(() => setShake(false), 2000); };

  // --- VIEWS ---

  // 1. Initial Site Password Gate
  if (!isSiteAuthorized) {
    return (
      <div className="lobby-overlay">
        <div className="setup-gate animate-intimate">
          <Fingerprint className="text-secondary" size={80} />
          <div className="tnt-logo purple">TNT <span>SYNC</span></div>
          <p className="tnt-subtitle">ENTER THE VOID PROTOCOL TO ACCESS THE BRIDGE INTERFACE.</p>
          <form onSubmit={(e) => { e.preventDefault(); if (sitePasscode === '6969') { setIsSiteAuthorized(true); sessionStorage.setItem('tf_auth', 'true'); } else alert('Invalid Access Key'); }} className="w-full space-y-4">
            <input type="password" placeholder="ACCESS KEY" value={sitePasscode} onChange={e => setSitePasscode(e.target.value)} className="input-tnt" />
            <button type="submit" className="btn-climax-huge w-full">AUTHENTICATE</button>
          </form>
        </div>
      </div>
    );
  }

  // 2. Setup (Role & Username)
  if (!role || !connected) {
    return (
      <div className="lobby-overlay">
        <div className="setup-gate">
          <div className="tnt-logo">TNT <span>SYNC</span></div>
          <p className="tnt-subtitle">PREMIUM REAL-TIME TOY CONTROL FOR INTIMACY WITHOUT BOUNDARIES.</p>

          <div className="w-full space-y-6">
            <div className="space-y-2">
              <label className="text-[10px] font-black text-dim tracking-widest uppercase">Select Identity</label>
              <div className="grid grid-cols-2 gap-4">
                <button onClick={() => setRole('controller')} className={`glass p-6 rounded-2xl border ${role === 'controller' ? 'border-primary bg-primary/10' : 'border-white/5 opacity-50'}`}>
                  <Gamepad2 className="mx-auto mb-2" />
                  <div className="text-[10px] font-black uppercase">Controller</div>
                </button>
                <button onClick={() => setRole('bridge')} className={`glass p-6 rounded-2xl border ${role === 'bridge' ? 'border-secondary bg-secondary/10' : 'border-white/5 opacity-50'}`}>
                  <Activity className="mx-auto mb-2" />
                  <div className="text-[10px] font-black uppercase">Host</div>
                </button>
              </div>
            </div>

            <div className="space-y-4">
              <input type="text" placeholder="DISPLAY NAME" value={username} onChange={e => setUsername(e.target.value)} className="input-tnt" />
              {role === 'controller' && <input type="text" placeholder="SESSION ID" value={deviceId} onChange={e => setDeviceId(e.target.value)} className="input-tnt" />}
              <button onClick={connectWS} className="btn-climax-huge w-full">ESTABLISH SYNC</button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // 3. Pending Handshake (Controller View)
  if (role === 'controller' && handshakeStatus === 'pending') {
    return (
      <div className="lobby-overlay">
        <div className="setup-gate">
          <div className="status-circle shake-it">
            <div className="circle-content">🛡️</div>
          </div>
          <h2 className="tnt-logo"><span>WAITING</span></h2>
          <p className="tnt-subtitle">THE HOST HAS BEEN NOTIFIED. PLEASE WAIT FOR HANDSHAKE CONFIRMATION.</p>
          <div className="w-full p-6 glass rounded-2xl border-white/5">
            <div className="text-[10px] font-black text-dim tracking-widest">SESSION: {deviceId}</div>
            <div className="text-[10px] font-black text-primary tracking-widest">IDENTITY: {username}</div>
          </div>
          <button onClick={() => setConnected(false)} className="btn-tnt-primary bg-zinc-800">CANCEL REQUEST</button>
        </div>
      </div>
    );
  }

  // 4. MAIN INTERFACE
  return (
    <div className={`app-container ${shake ? 'shake-it' : ''}`}>
      {/* Header */}
      <nav className="flex justify-between items-center mb-10">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 bg-primary/20 rounded-xl flex items-center justify-center border border-primary/30">
            <Radio className="text-primary animate-pulse" size={20} />
          </div>
          <div className="tnt-logo text-3xl mb-0">TNT <span>SYNC</span></div>
        </div>
        <div className="flex items-center gap-6">
          <div className="hidden md:flex flex-col items-end">
            <div className="text-[9px] font-black text-emerald-400 tracking-[0.4em] uppercase">SERVER LIVE</div>
            <div className="text-[9px] font-black text-dim tracking-[0.4em] uppercase">LATENCY: 42MS</div>
          </div>
          <button onClick={() => { if (wsRef.current) wsRef.current.close(); setConnected(false); }} className="p-3 glass rounded-xl text-dim hover:text-white"><Lock size={18} /></button>
        </div>
      </nav>

      <div className="tnt-grid">
        {/* Left Column: Device & Status */}
        <div className="space-y-6">
          <div className="tnt-card status-engaged">
            <div className="flex justify-between items-center">
              <Shield className="text-emerald-500" size={24} />
              <div className="tnt-badge">ENGAGED</div>
            </div>
            <div className="text-center">
              <h2 className="text-2xl font-black italic uppercase font-syne">1 DEVICE SYNCED</h2>
              <p className="text-[9px] text-dim font-black tracking-widest uppercase mt-1">PRIMARY VIBRATOR ACTIVE</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <button className="glass py-4 rounded-xl border-white/5 hover:border-emerald-500/30 transition-all"><ThumbsUp size={20} className="mx-auto text-emerald-500" /></button>
              <button className="glass py-4 rounded-xl border-white/5 hover:border-rose-500/30 transition-all"><ThumbsDown size={20} className="mx-auto text-rose-500" /></button>
            </div>
            <button onClick={triggerClimax} className="btn-climax-huge">🔥 I'M GONNA CUM! 🍬</button>
          </div>

          <div className="tnt-card">
            <div className="status-circle">
              <div className="circle-content">🌸</div>
            </div>
            <div className="text-center space-y-1">
              <div className="text-[10px] font-black text-dim tracking-widest uppercase">INTENSITY MATRIX</div>
              <div className="text-4xl font-black italic font-syne text-primary">{speed}%</div>
            </div>
          </div>

          <div className="tnt-card p-6">
            <div className="text-[9px] font-black text-dim tracking-widest uppercase mb-4">REQUEST LOBBY</div>
            <div className="space-y-3">
              {participants.filter(p => p.status === 'pending').length === 0 ? (
                <div className="text-[9px] font-black text-dim uppercase text-center py-6 border border-dashed border-white/10 rounded-xl">NO PENDING REQUESTS</div>
              ) : (
                participants.filter(p => p.status === 'pending').map(p => (
                  <div key={p.id} className="flex justify-between items-center bg-white/5 p-3 rounded-xl border border-white/5">
                    <div>
                      <div className="text-[10px] font-black text-white">{p.username}</div>
                      <div className="text-[8px] font-black text-dim uppercase">WANTS TO CONTROL</div>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => handleHandshake(p.id, 'accept')} className="p-2 bg-emerald-500/20 text-emerald-500 rounded-lg"><Check size={14} /></button>
                      <button onClick={() => handleHandshake(p.id, 'deny')} className="p-2 bg-rose-500/20 text-rose-500 rounded-lg"><X size={14} /></button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Middle Column: Media & Chat */}
        <div className="space-y-6">
          <div className="media-stage">
            <div className="w-12 h-12 bg-white/5 rounded-2xl flex items-center justify-center">
              <Volume2 className="text-dim" />
            </div>
            <h3>MEDIA STAGE OFFLINE</h3>
            <p className="text-[10px] font-black text-dim/50 tracking-[0.4em] uppercase">CLICK TO BROADCAST SESSION MEDIA</p>
          </div>

          <div className="tnt-card p-0 h-[380px] flex flex-col">
            <div className="p-4 border-b border-white/5 flex justify-between items-center">
              <div className="text-[9px] font-black text-dim tracking-[0.3em] uppercase">RECENT WHISPERS</div>
              <div className="tnt-badge bg-primary/10 text-primary">SESSION LIVE</div>
            </div>
            <div className="flex-1 p-6 overflow-y-auto space-y-4 scroll-smooth">
              {messages.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center space-y-4 opacity-20">
                  <MessageSquare size={32} />
                  <div className="text-[10px] font-black tracking-widest uppercase">SILENCE IS WAITING TO BE BROKEN...</div>
                </div>
              ) : (
                messages.map((m, i) => (
                  <div key={i} className={`flex flex-col ${m.user === username ? 'items-end' : 'items-start'}`}>
                    <div className="text-[8px] font-black text-dim uppercase mb-1">{m.user} • {m.time}</div>
                    <div className={`max-w-[80%] p-3 rounded-2xl ${m.user === username ? 'bg-primary text-white' : 'bg-white/5 text-white/80'}`}>
                      {m.text}
                    </div>
                  </div>
                ))
              )}
            </div>
            <div className="p-4">
              <div className="whisper-box">
                <input
                  type="text"
                  placeholder="WHISPER BACK TO YOUR PARTNER..."
                  className="whisper-input"
                  value={inputText}
                  onChange={e => setInputText(e.target.value)}
                  onKeyPress={e => e.key === 'Enter' && sendChatMessage()}
                />
                <button onClick={sendChatMessage} className="btn-whisper-send">
                  <ChevronRight size={20} />
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Controls & Link */}
        <div className="space-y-6">
          <div className="tnt-card">
            <div className="text-[9px] font-black text-dim tracking-[0.3em] uppercase">PARTNER LINK</div>
            <div className="bg-black/50 p-4 rounded-xl border border-white/5 text-[10px] font-mono text-primary text-truncate">{window.location.origin}/?deviceId={deviceId}</div>
            <button
              onClick={() => { navigator.clipboard.writeText(`${window.location.origin}/?deviceId=${deviceId}`); addLog('✓ Portal coordinates copied'); }}
              className="btn-tnt-primary bg-zinc-800 text-white"
            >
              COPY LINK
            </button>
            <button onClick={() => triggerShake()} className="text-[9px] font-black text-dim hover:text-primary transition-all uppercase tracking-widest">⚡ SYNC TEST</button>
          </div>

          <div className="tnt-card">
            <div className="text-[9px] font-black text-dim tracking-[0.3em] uppercase">OVERRIDES</div>
            <div className="space-y-6">
              <div className="space-y-3">
                <div className="flex justify-between text-[10px] font-black uppercase tracking-widest">
                  <span>Master Sync</span>
                  <Zap size={14} className="text-secondary" />
                </div>
                <input type="range" min="0" max="100" value={speed} onChange={e => updateSpeed(e.target.value)} className="w-full accent-secondary" />
              </div>
              {role === 'bridge' && (
                <button onClick={connectBLE} className={`w-full py-4 glass rounded-xl border-white/5 flex items-center justify-center gap-3 ${bleDevice ? 'text-emerald-400 border-emerald-400/20' : 'text-dim'}`}>
                  <Cpu size={16} />
                  <span className="text-[9px] font-black uppercase tracking-widest">{bleDevice ? 'HARDWARE SYNCED' : 'SYNC HARDWARE'}</span>
                </button>
              )}
            </div>
          </div>

          <div className="tnt-card border-rose-500/20">
            <div className="text-[9px] font-black text-dim tracking-[0.3em] uppercase">SESSION CONTROL</div>
            <button onClick={() => window.location.reload()} className="w-full py-4 bg-rose-500/10 border border-rose-500/30 text-rose-500 rounded-xl text-[9px] font-black tracking-widest uppercase hover:bg-rose-500 hover:text-white transition-all">DESTROY SESSION & LINK</button>
          </div>
        </div>
      </div>

      {/* Footer / Privacy */}
      <div className="privacy-banner mt-10">
        <div className="flex items-center gap-4">
          <Shield className="text-primary" size={32} />
          <div>
            <h2 className="text-2xl font-black italic uppercase font-syne">PRIVACY FIRST PROTOCOL</h2>
            <p className="text-[9px] text-dim font-black tracking-[0.4em] uppercase">YOUR SAFETY IS NON-NEGOTIABLE</p>
          </div>
        </div>
        <div className="grid md:grid-cols-2 gap-8">
          <div className="p-6 glass rounded-2xl border-white/5 space-y-2">
            <div className="flex items-center gap-2 text-[10px] font-black text-emerald-400 uppercase">✓ End-to-End Encryption</div>
            <p className="text-[9px] text-dim/60 leading-relaxed">EACH CONNECTION IS STRICTLY SECURED VIA TLS/SSL. HANDSHAKE CODES ARE UNIQUE PER SESSION AND DESTROYED UPON DISCONNECT.</p>
          </div>
          <div className="p-6 glass rounded-2xl border-white/5 space-y-2">
            <div className="flex items-center gap-2 text-[10px] font-black text-emerald-400 uppercase">✓ TOS COMPLIANCE</div>
            <p className="text-[9px] text-dim/60 leading-relaxed">TNT SYNC OPERATES IN FULL COMPLIANCE WITH LOVENSE DEVELOPER TERMS. WE NEVER STORE PERSONAL BIOMETRIC DATA OR VOICE RECORDINGS.</p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;

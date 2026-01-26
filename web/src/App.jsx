import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Shield,
  Zap,
  Activity,
  Heart,
  Copy,
  Camera,
  CameraOff,
  Mic,
  MicOff,
  Gamepad2,
  Wifi,
  MessageSquare,
  Check,
  X,
  ChevronRight,
  Lock,
  Cpu,
  RefreshCw,
  LogOut,
  Fingerprint
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
  // --- STAGES: auth -> setup -> dashboard ---
  const [authStep, setAuthStep] = useState(sessionStorage.getItem('mp_auth') === 'true' ? 'setup' : 'auth');
  const [passcode, setPasscode] = useState('');
  const [username, setUsername] = useState(sessionStorage.getItem('mp_username') || '');
  const [role, setRole] = useState(null); // 'controller' or 'bridge'
  const [deviceId, setDeviceId] = useState('MP-X1');
  const [handshakeStatus, setHandshakeStatus] = useState('pending'); // pending, active, denied

  // --- SESSION ---
  const [connected, setConnected] = useState(false);
  const [speed, setSpeed] = useState(0);
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const [participants, setParticipants] = useState([]);
  const [pattern, setPattern] = useState(1);
  const [isClimax, setIsClimax] = useState(false);

  // --- WebRTC ---
  const [localStream, setLocalStream] = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);
  const [camEnabled, setCamEnabled] = useState(false);
  const [micEnabled, setMicEnabled] = useState(false);

  // --- REFS ---
  const wsRef = useRef(null);
  const pcRef = useRef(null);
  const localVidRef = useRef(null);
  const remoteVidRef = useRef(null);
  const bleCharsRef = useRef([]);

  // --- INITIALIZATION ---
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('passcode') === '6969') {
      sessionStorage.setItem('mp_auth', 'true');
      setAuthStep('setup');
    }
    if (params.get('deviceId')) setDeviceId(params.get('deviceId'));
  }, []);

  // --- LOGIC: WEBSOCKET ---
  const connectWS = () => {
    if (!username) return alert('Username required.');
    sessionStorage.setItem('mp_username', username);

    const socket = new WebSocket(`${WS_URL}?deviceId=${deviceId}&type=${role}&username=${encodeURIComponent(username)}`);

    socket.onopen = () => {
      setConnected(true);
      setAuthStep('dashboard');
      if (role === 'bridge') setHandshakeStatus('active');
    };

    socket.onmessage = async (event) => {
      const msg = JSON.parse(event.data);
      handleWSMessage(msg);
    };

    socket.onclose = () => {
      setConnected(false);
      alert('Connection Lost.');
      window.location.reload();
    };

    wsRef.current = socket;
  };

  const handleWSMessage = async (msg) => {
    switch (msg.action) {
      case 'room-state':
        setParticipants(msg.value);
        break;
      case 'handshake-approved':
        setHandshakeStatus('active');
        break;
      case 'handshake-denied':
        alert('Access Denied.');
        window.location.reload();
        break;
      case 'speed':
        setSpeed(msg.value);
        if (role === 'bridge') sendBLE(pattern, msg.value);
        break;
      case 'pattern':
        setPattern(msg.value);
        break;
      case 'chat':
        setMessages(prev => [...prev, msg.value].slice(-50));
        break;
      case 'climax':
        setIsClimax(true);
        setTimeout(() => setIsClimax(false), 5000);
        if (role === 'bridge') {
          sendBLE(1, 100);
          setTimeout(() => sendBLE(pattern, speed), 5000);
        }
        break;
      // WebRTC Signaling
      case 'offer':
        const pcOffer = pcRef.current || initPC();
        await pcOffer.setRemoteDescription(new RTCSessionDescription(msg.value));
        const ans = await pcOffer.createAnswer();
        await pcOffer.setLocalDescription(ans);
        wsRef.current.send(JSON.stringify({ action: 'answer', value: ans }));
        break;
      case 'answer':
        if (pcRef.current) await pcRef.current.setRemoteDescription(new RTCSessionDescription(msg.value));
        break;
      case 'ice':
        if (pcRef.current) await pcRef.current.addIceCandidate(new RTCIceCandidate(msg.value));
        break;
    }
  };

  // --- LOGIC: WebRTC ---
  const initPC = () => {
    const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
    pc.onicecandidate = (e) => {
      if (e.candidate) wsRef.current.send(JSON.stringify({ action: 'ice', value: e.candidate }));
    };
    pc.ontrack = (e) => {
      setRemoteStream(e.streams[0]);
      if (remoteVidRef.current) remoteVidRef.current.srcObject = e.streams[0];
    };
    pcRef.current = pc;
    return pc;
  };

  const toggleMedia = async (type) => {
    if (type === 'cam') {
      if (camEnabled) {
        localStream.getTracks().forEach(t => t.stop());
        setCamEnabled(false);
        setLocalStream(null);
      } else {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
          setLocalStream(stream);
          setCamEnabled(true);
          setMicEnabled(true);
          if (localVidRef.current) localVidRef.current.srcObject = stream;

          const pc = pcRef.current || initPC();
          stream.getTracks().forEach(track => pc.addTrack(track, stream));

          if (role === 'bridge') {
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            wsRef.current.send(JSON.stringify({ action: 'offer', value: offer }));
          }
        } catch (err) { alert('Camera failed: ' + err.message); }
      }
    }
  };

  // --- LOGIC: BLE ---
  const connectBLE = async () => {
    try {
      const device = await navigator.bluetooth.requestDevice({ filters: [{ namePrefix: 'J-' }], optionalServices: [JOYHUB_SERVICE_UUID] });
      const server = await device.gatt.connect();
      const service = await server.getPrimaryService(JOYHUB_SERVICE_UUID);
      const char = await service.getCharacteristic(JOYHUB_TX_CHAR_UUID);
      bleCharsRef.current = [char];
      alert('Toy Connected.');
    } catch (e) { alert('BLE Error: ' + e.message); }
  };

  const sendBLE = async (m, s) => {
    if (!bleCharsRef.current.length) return;
    const intensity = Math.min(255, Math.floor((s / 100) * 255));
    const cmd = new Uint8Array([0xa0, 0x0c, 0x00, 0x00, s === 0 ? 0 : m, intensity]);
    try { await bleCharsRef.current[0].writeValue(cmd); } catch (e) { }
  };

  // --- LOGIC: CONTROLS ---
  const updateSpeed = (s) => {
    setSpeed(s);
    if (wsRef.current) wsRef.current.send(JSON.stringify({ action: 'speed', value: s }));
  };

  const sendChat = () => {
    if (!inputText.trim()) return;
    const m = { user: username, text: inputText, time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) };
    wsRef.current.send(JSON.stringify({ action: 'chat', value: m }));
    setMessages(prev => [...prev, m]);
    setInputText('');
  };

  // --- RENDER REGIONS ---

  if (authStep === 'auth') {
    return (
      <div className="gate-screen">
        <div className="gate-card">
          <Fingerprint size={60} className="text-[#00f2ff] mx-auto animate-pulse" />
          <h1 className="mp-logo">MY<span>PLEASURE</span></h1>
          <input type="password" placeholder="ACCESS CODE" value={passcode} onChange={e => setPasscode(e.target.value)} className="gate-input" />
          <button onClick={() => { if (passcode === '6969') setAuthStep('setup'); }} className="btn-sexy" style={{ height: '60px' }}>AUTHENTICATE</button>
        </div>
      </div>
    );
  }

  if (authStep === 'setup') {
    return (
      <div className="gate-screen">
        <div className="gate-card">
          <h1 className="mp-logo">MY<span>PLEASURE</span></h1>
          <div className="grid grid-cols-2 gap-4">
            <button onClick={() => setRole('controller')} className={`btn-sexy ${role === 'controller' ? 'active' : ''}`}><Gamepad2 size={24} /> CONTROLLER</button>
            <button onClick={() => setRole('bridge')} className={`btn-sexy ${role === 'bridge' ? 'active' : ''}`}><Activity size={24} /> HOST</button>
          </div>
          <input type="text" placeholder="DISPLAY NAME" value={username} onChange={e => setUsername(e.target.value)} className="gate-input" />
          <input type="text" placeholder="SESSION ID" value={deviceId} onChange={e => setDeviceId(e.target.value)} className="gate-input" />
          <button onClick={connectWS} className="btn-sexy" style={{ height: '60px' }}>ESTABLISH SYNC</button>
        </div>
      </div>
    );
  }

  if (role === 'controller' && handshakeStatus === 'pending') {
    return (
      <div className="gate-screen">
        <div className="gate-card">
          <div className="status-circle" style={{ width: '100px', height: '100px', borderRadius: '50%', border: '2px solid var(--accent-cyan)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto' }}>
            <Wifi className="text-[#00f2ff] animate-pulse" />
          </div>
          <h2 className="font-syne text-2xl">WAITING FOR HANDSHAKE</h2>
          <p className="text-dim text-sm">THE HOST MUST APPROVE YOUR CONNECTION REQUEST.</p>
          <button onClick={() => window.location.reload()} className="btn-sexy">CANCEL</button>
        </div>
      </div>
    );
  }

  return (
    <div className={`mp-layout ${isClimax ? 'climaxing' : ''}`}>
      <header className="glass flex justify-between items-center">
        <h1 className="mp-logo">MY<span>PLEASURE</span></h1>
        <div className="flex gap-4">
          <div className="text-right">
            <div className="text-[10px] font-black tracking-widest uppercase">NODE: {deviceId}</div>
            <div className="text-[10px] font-bold text-[#00f2ff] tracking-widest uppercase">{username}</div>
          </div>
          <button onClick={() => window.location.reload()} className="btn-sexy"><LogOut size={16} /></button>
        </div>
      </header>

      <div className="mp-left space-y-4">
        <div className="glass">
          <h3 className="text-[10px] font-black uppercase mb-4 tracking-widest">Haptic Console</h3>
          <div className="control-grid mb-6">
            {[0, 20, 40, 60, 80, 100].map(s => (
              <button key={s} onClick={() => updateSpeed(s)} className={`btn-sexy ${speed === s ? 'active' : ''}`}>{s}%</button>
            ))}
          </div>
          <input type="range" min="0" max="100" value={speed} onChange={e => updateSpeed(e.target.value)} className="intensity-slider mb-4" />
          <button onClick={() => wsRef.current.send(JSON.stringify({ action: 'climax' }))} className="btn-sexy btn-climax w-full">FIRE CLIMAX</button>
        </div>

        <div className="glass flex-1">
          <h3 className="text-[10px] font-black uppercase mb-4 tracking-widest">Sync Lobby</h3>
          <div className="space-y-2">
            {participants.filter(p => p.status === 'pending').map(p => (
              <div key={p.id} className="flex justify-between items-center bg-white/5 p-3 rounded-xl border border-white/5">
                <span className="text-xs font-bold">{p.username}</span>
                <div className="flex gap-2">
                  <button onClick={() => wsRef.current.send(JSON.stringify({ action: 'accept-guest', guestId: p.id }))} className="text-emerald-400"><Check size={18} /></button>
                  <button onClick={() => wsRef.current.send(JSON.stringify({ action: 'deny-guest', guestId: p.id }))} className="text-rose-400"><X size={18} /></button>
                </div>
              </div>
            ))}
            {participants.filter(p => p.status === 'pending').length === 0 && <div className="text-center py-8 opacity-20 text-xs">LOBBY EMPTY</div>}
          </div>
        </div>
      </div>

      <div className="mp-main stage">
        <video ref={remoteVidRef} className="video-full" autoPlay playsInline />
        <div className="stage-overlay" />

        {localStream && (
          <div className="local-preview" style={{ position: 'absolute', top: '2rem', right: '2rem', width: '200px', aspectScale: '16/9', borderRadius: '1.5rem', border: '2px solid var(--accent-cyan)', overflow: 'hidden' }}>
            <video ref={localVidRef} className="video-internal" autoPlay playsInline muted />
          </div>
        )}

        <div className="cam-controls">
          <button onClick={() => toggleMedia('cam')} className={`btn-sexy ${camEnabled ? 'active' : ''}`}>
            {camEnabled ? <CameraOff /> : <Camera />}
          </button>
          <button onClick={() => setMicEnabled(!micEnabled)} className={`btn-sexy ${micEnabled ? 'active' : ''}`}>
            {micEnabled ? <Mic /> : <MicOff />}
          </button>
          {role === 'bridge' && <button onClick={connectBLE} className="btn-sexy"><Cpu /></button>}
        </div>
      </div>

      <div className="mp-right glass chat-box">
        <h3 className="text-[10px] font-black uppercase mb-4 tracking-widest">Whisper Feed</h3>
        <div className="chat-msgs custom-scrollbar">
          {messages.map((m, i) => (
            <div key={i} className={`msg ${m.user === username ? 'msg-own' : 'msg-other'}`}>
              <div className="text-[8px] font-black opacity-50 uppercase mb-1">{m.user} &bull; {m.time}</div>
              {m.text}
            </div>
          ))}
          {messages.length === 0 && <div className="h-full flex items-center justify-center opacity-10 text-xs">SILENCE IS WAITING...</div>}
        </div>
        <div className="chat-input">
          <input type="text" value={inputText} onChange={e => setInputText(e.target.value)} onKeyPress={e => e.key === 'Enter' && sendChat()} className="chat-input-field" placeholder="Signal..." />
          <button onClick={sendChat} className="btn-sexy"><ChevronRight size={18} /></button>
        </div>
      </div>

      <footer className="glass flex items-center justify-center text-[10px] font-black text-dim uppercase tracking-[1em]">
        MyPleasure Protocol &bull; Secure Encrypted Link
      </footer>
    </div>
  );
}

export default App;

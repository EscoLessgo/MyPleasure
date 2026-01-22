import React, { useState, useEffect, useRef } from 'react';
import './App.css';
import { PATTERNS } from './patterns';

const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const host = window.location.host.includes('5173') ? 'localhost:8080' : window.location.host;
const WS_URL = `${protocol}//${host}`;

const JOYHUB_SERVICE_UUID = '0000ffa0-0000-1000-8000-00805f9b34fb';
const JOYHUB_TX_CHAR_UUID = '0000ffa1-0000-1000-8000-00805f9b34fb';

function App() {
  const [role, setRole] = useState(null);
  const [deviceId, setDeviceId] = useState('trueform-1');
  const [connected, setConnected] = useState(false);

  // Remote Control State & Refs for stable WS access
  const [powerLevel, setPowerLevel] = useState(0);
  const [activePattern, setActivePattern] = useState(1);
  const powerLevelRef = useRef(0);
  const activePatternRef = useRef(1);

  // Chat & Media State
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const [remoteStream, setRemoteStream] = useState(null);
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const peerConnection = useRef(null);
  const canvasRef = useRef(null);
  const requestRef = useRef();

  const [status, setStatus] = useState('Disconnected');
  const [ws, setWs] = useState(null);
  const [bleDevice, setBleDevice] = useState(null);
  const bleCharsRef = useRef([]);
  const isWritingRef = useRef(false);

  // --- BLE Functions ---
  const sendCommand = async (mode, intensity) => {
    if (!bleCharsRef.current.length || isWritingRef.current) return;
    isWritingRef.current = true;

    // Safety check for mode 0
    const finalMode = intensity === 0 ? 0 : mode;
    const finalIntensity = intensity;

    const cmd = new Uint8Array([0xa0, 0x0c, 0x00, 0x00, finalMode, finalIntensity]);
    try {
      await bleCharsRef.current[0].writeValue(cmd);
    } catch (err) {
      console.error('BLE fail:', err);
    } finally {
      setTimeout(() => { isWritingRef.current = false; }, 50);
    }
  };

  const getIntensityValue = (level) => {
    if (level === 0) return 0;
    if (level === 1) return 85;  // Low
    if (level === 2) return 170; // Med
    return 255;                  // High
  };

  // --- WebRTC Functions ---
  const startMedia = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      if (localVideoRef.current) localVideoRef.current.srcObject = stream;

      // Setup PEER connection
      peerConnection.current = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
      });

      stream.getTracks().forEach(track => peerConnection.current.addTrack(track, stream));

      peerConnection.current.ontrack = (event) => {
        setRemoteStream(event.streams[0]);
        if (remoteVideoRef.current) remoteVideoRef.current.srcObject = event.streams[0];
      };

      peerConnection.current.onicecandidate = (event) => {
        if (event.candidate && ws) {
          ws.send(JSON.stringify({ action: 'ice-candidate', candidate: event.candidate }));
        }
      };
    } catch (err) {
      console.error('Media fail:', err);
    }
  };

  const createOffer = async () => {
    const offer = await peerConnection.current.createOffer();
    await peerConnection.current.setLocalDescription(offer);
    ws.send(JSON.stringify({ action: 'offer', offer }));
  };

  // --- WebSocket Sync ---
  const updateRemote = (action, value) => {
    if (ws && connected) {
      ws.send(JSON.stringify({ action, value }));
    }
  };

  useEffect(() => {
    if (ws) {
      ws.onmessage = async (event) => {
        const msg = JSON.parse(event.data);

        // Handle Control
        if (role === 'bridge') {
          if (msg.action === 'power') {
            const level = parseInt(msg.value);
            setPowerLevel(level);
            powerLevelRef.current = level;

            const intensity = getIntensityValue(level);
            sendCommand(activePatternRef.current, intensity);
          } else if (msg.action === 'pattern') {
            const pattern = parseInt(msg.value);
            setActivePattern(pattern);
            activePatternRef.current = pattern;

            if (powerLevelRef.current === 0) {
              setPowerLevel(1);
              powerLevelRef.current = 1;
            }
            const intensity = getIntensityValue(powerLevelRef.current);
            sendCommand(pattern, intensity);
          }
        }

        // Handle Chat
        if (msg.action === 'chat') {
          setMessages(prev => [...prev, msg.value].slice(-20));
        }

        // Handle WebRTC Signaling
        if (msg.action === 'offer') {
          await peerConnection.current.setRemoteDescription(new RTCSessionDescription(msg.offer));
          const answer = await peerConnection.current.createAnswer();
          await peerConnection.current.setLocalDescription(answer);
          ws.send(JSON.stringify({ action: 'answer', answer }));
        } else if (msg.action === 'answer') {
          await peerConnection.current.setRemoteDescription(new RTCSessionDescription(msg.answer));
        } else if (msg.action === 'ice-candidate') {
          try {
            await peerConnection.current.addIceCandidate(new RTCIceCandidate(msg.candidate));
          } catch (e) { }
        }
      };
    }
  }, [ws, role]);

  const handleSendMessage = () => {
    if (!inputText.trim()) return;
    const msg = { user: role, text: inputText };
    updateRemote('chat', msg);
    setMessages(prev => [...prev, msg]);
    setInputText('');
  };

  // --- Realtime Visualizer Logic ---
  const animate = (time) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const { width, height } = canvas;
    ctx.clearRect(0, 0, width, height);

    const centerX = width / 2;
    const centerY = height / 2;
    const baseRadius = 40 + (powerLevel * 15);
    const timeFactor = time / 1000;

    // Draw Outer Pulse
    const pulse = Math.sin(timeFactor * (powerLevel + 2) * 2) * 10;
    const gradient = ctx.createRadialGradient(centerX, centerY, 5, centerX, centerY, baseRadius + pulse);
    gradient.addColorStop(0, role === 'bridge' ? '#ec4899' : '#6366f1');
    gradient.addColorStop(1, 'transparent');

    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(centerX, centerY, baseRadius + pulse, 0, Math.PI * 2);
    ctx.fill();

    // Draw Orbiting Particles based on Pattern
    const particleCount = 10 + (powerLevel * 5);
    for (let i = 0; i < particleCount; i++) {
      const angle = (timeFactor * (powerLevel + 1)) + (i * ((Math.PI * 2) / particleCount));
      const dist = baseRadius + 20 + Math.cos(timeFactor * (activePattern % 5 + 1) + i) * 10;
      const px = centerX + Math.cos(angle) * dist;
      const py = centerY + Math.sin(angle) * dist;

      ctx.fillStyle = role === 'bridge' ? '#f472b6' : '#818cf8';
      ctx.beginPath();
      ctx.arc(px, py, 2 + (powerLevel), 0, Math.PI * 2);
      ctx.fill();
    }

    requestRef.current = requestAnimationFrame(animate);
  };

  useEffect(() => {
    requestRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(requestRef.current);
  }, [powerLevel, activePattern]);

  const connectWS = async () => {
    if (ws) ws.close();
    const socket = new WebSocket(`${WS_URL}?deviceId=${deviceId}&type=${role}`);
    socket.onopen = () => { setStatus('Connected'); setConnected(true); startMedia(); };
    socket.onclose = () => { setStatus('Disconnected'); setConnected(false); };
    setWs(socket);
  };

  const connectBLE = async () => {
    try {
      const device = await navigator.bluetooth.requestDevice({ filters: [{ namePrefix: 'J-' }], optionalServices: [JOYHUB_SERVICE_UUID] });
      const server = await device.gatt.connect();
      const service = await server.getPrimaryService(JOYHUB_SERVICE_UUID);
      const txChar = await service.getCharacteristic(JOYHUB_TX_CHAR_UUID);
      bleCharsRef.current = [txChar];
      setBleDevice(device);
      if (ws) ws.send(JSON.stringify({ action: 'status', value: 'Bridge Connected' }));
    } catch (err) { console.error(err); }
  };

  if (!role) {
    return (
      <div className="setup-container">
        <div className="logo">⚡ TrueForm Remote IM</div>
        <div className="role-selector">
          <button onClick={() => setRole('controller')} className="btn-large controller">
            <span className="icon">🎮</span> Controller
          </button>
          <button onClick={() => setRole('bridge')} className="btn-large bridge">
            <span className="icon">🔗</span> Bridge
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={`app ${role}`}>
      <header>
        <h1>{role === 'bridge' ? '🔗 Bridge' : '🎮 Controller'}</h1>
        <div className={`status ${connected ? 'connected' : ''}`}>{status}</div>
        <button onClick={() => setRole(null)} className="btn-reset">Reset</button>
      </header>

      <main>
        {!connected && (
          <div className="connect-card">
            <input type="text" value={deviceId} onChange={(e) => setDeviceId(e.target.value)} className="device-input" />
            <button onClick={connectWS} className="btn-connect">Join Session</button>
          </div>
        )}

        {role === 'bridge' && connected && !bleDevice && (
          <button onClick={connectBLE} className="btn-ble">Connect BLE Toy</button>
        )}

        {connected && (
          <div className="immersive-container">
            <div className="media-section">
              <div className="video-container">
                <video ref={localVideoRef} autoPlay muted playsInline />
                <div className="video-label">YOU</div>
              </div>
              <div className="video-container">
                <video ref={remoteVideoRef} autoPlay playsInline />
                <div className="video-label">REMOTE</div>
                {!remoteStream && <button onClick={createOffer} className="btn-call">START CALL</button>}
              </div>
            </div>

            <div className="controls-container">
              <div className="visualizer-section">
                <canvas ref={canvasRef} width="300" height="200" className="vibe-canvas" />
                <div className="vibe-label">CYBER-PULSE FEEDBACK</div>
              </div>

              <div className="control-row">
                <div className="intensity-section">
                  <h3>Power</h3>
                  <div className="vertical-slider-wrapper">
                    <input type="range" orient="vertical" min="0" max="3" step="1" value={powerLevel} onChange={(e) => handlePowerChange(e.target.value)} className="vertical-slider" />
                    <div className="slider-labels">
                      <span className={powerLevel === 3 ? 'active' : ''}>MAX</span>
                      <span className={powerLevel === 2 ? 'active' : ''}>MED</span>
                      <span className={powerLevel === 1 ? 'active' : ''}>LOW</span>
                      <span className={powerLevel === 0 ? 'active' : ''}>OFF</span>
                    </div>
                  </div>
                  <button onClick={() => handlePowerChange(0)} className="btn-stop-mini">STOP</button>
                </div>

                <div className="patterns-section">
                  <h3>Vibration Patterns</h3>
                  <div className="patterns-grid">
                    {PATTERNS.map(p => (
                      <button
                        key={p.id}
                        className={`pattern-btn ${activePattern === p.id ? 'active' : ''}`}
                        onClick={() => handlePatternChange(p.id)}
                      >
                        <span className="p-icon">{p.icon}</span>
                        <span className="p-name">{p.name}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="chat-section">
                <div className="messages">
                  {messages.map((m, i) => (
                    <div key={i} className={`msg ${m.user === role ? 'own' : ''}`}>
                      <b>{m.user}:</b> {m.text}
                    </div>
                  ))}
                </div>
                <div className="chat-input">
                  <input value={inputText} onChange={(e) => setInputText(e.target.value)} onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()} />
                  <button onClick={handleSendMessage}>Send</button>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );

  function handlePowerChange(level) {
    const val = parseInt(level);
    setPowerLevel(val);
    powerLevelRef.current = val;

    if (role === 'bridge') {
      const intensity = getIntensityValue(val);
      sendCommand(activePatternRef.current, intensity);
    }
    updateRemote('power', val);
  }
  function handlePatternChange(patId) {
    const val = parseInt(patId);
    setActivePattern(val);
    activePatternRef.current = val;

    // Default to Low power if turning on a pattern when stopped
    if (powerLevelRef.current === 0) {
      setPowerLevel(1);
      powerLevelRef.current = 1;
    }

    if (role === 'bridge') {
      const intensity = getIntensityValue(powerLevelRef.current);
      sendCommand(val, intensity);
    }
    updateRemote('pattern', val);
  }
}

export default App;

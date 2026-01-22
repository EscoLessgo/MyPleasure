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

  // Level: 0 (Off), 1 (Low), 2 (Med), 3 (High)
  const [powerLevel, setPowerLevel] = useState(0);
  // Pattern: 4-10
  const [activePattern, setActivePattern] = useState(4);

  // Track what was last active to know what to send
  const [lastActiveMode, setLastActiveMode] = useState(0);

  const [status, setStatus] = useState('Disconnected');
  const [ws, setWs] = useState(null);
  const [bleDevice, setBleDevice] = useState(null);
  const bleCharsRef = useRef([]);
  const isWritingRef = useRef(false);

  const sendCommand = async (mode) => {
    if (!bleCharsRef.current.length || isWritingRef.current) return;
    isWritingRef.current = true;

    // Command format discovered: [0xa0, 0x0c, 0x00, 0x00, mode, 0xff]
    // Mode 0 = Stop
    const intensityByte = mode === 0 ? 0x00 : 0xff;
    const cmd = new Uint8Array([0xa0, 0x0c, 0x00, 0x00, mode, intensityByte]);

    try {
      await bleCharsRef.current[0].writeValue(cmd);
      console.log(`✓ Command Sent: Mode ${mode}`);
    } catch (err) {
      console.error('Command failed:', err);
    } finally {
      // Short delay to prevent GATT congestion
      setTimeout(() => { isWritingRef.current = false; }, 50);
    }
  };

  const updateRemote = (action, value) => {
    if (ws && connected) {
      ws.send(JSON.stringify({ action, value }));
    }
  };

  const handlePowerChange = (level) => {
    const val = parseInt(level);
    setPowerLevel(val);

    let targetMode = 0;
    if (val === 1) targetMode = 1;
    else if (val === 2) targetMode = 2;
    else if (val === 3) targetMode = 3;

    setLastActiveMode(targetMode);
    if (role === 'bridge') sendCommand(targetMode);
    updateRemote('power', val);
  };

  const handlePatternChange = (patId) => {
    const val = parseInt(patId);
    setActivePattern(val);
    // Switching to pattern mode turns the "Power Level" slider to a virtual 'On' state
    if (powerLevel === 0) setPowerLevel(1);

    setLastActiveMode(val);
    if (role === 'bridge') sendCommand(val);
    updateRemote('pattern', val);
  };

  const handleStop = () => {
    setPowerLevel(0);
    setLastActiveMode(0);
    if (role === 'bridge') sendCommand(0);
    updateRemote('power', 0);
  };

  useEffect(() => {
    if (ws) {
      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (role === 'bridge') {
          if (msg.action === 'power') {
            setPowerLevel(msg.value);
            let mode = 0;
            if (msg.value === 1) mode = 1;
            else if (msg.value === 2) mode = 2;
            else if (msg.value === 3) mode = 3;
            sendCommand(mode);
          } else if (msg.action === 'pattern') {
            setActivePattern(msg.value);
            if (powerLevel === 0) setPowerLevel(1);
            sendCommand(msg.value);
          }
        }
      };
    }
  }, [ws, role, powerLevel]);

  const connectWS = () => {
    if (ws) ws.close();
    const socket = new WebSocket(`${WS_URL}?deviceId=${deviceId}&type=${role}`);
    socket.onopen = () => { setStatus('Connected'); setConnected(true); };
    socket.onclose = () => { setStatus('Disconnected'); setConnected(false); };
    setWs(socket);
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
      if (ws) ws.send(JSON.stringify({ action: 'status', value: 'Bridge Connected' }));
    } catch (err) { console.error(err); }
  };

  if (!role) {
    return (
      <div className="setup-container">
        <div className="logo">⚡ TrueForm Remote</div>
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
            <button onClick={connectWS} className="btn-connect">Link System</button>
          </div>
        )}

        {role === 'bridge' && connected && !bleDevice && (
          <button onClick={connectBLE} className="btn-ble">Connect Hardware</button>
        )}

        {((role === 'controller' && connected) || (role === 'bridge' && bleDevice)) && (
          <div className="controls-container">
            <div className="intensity-section">
              <h3>Power Level</h3>
              <div className="vertical-slider-wrapper">
                <input
                  type="range"
                  orient="vertical"
                  min="0" max="3" step="1"
                  value={powerLevel}
                  onChange={(e) => handlePowerChange(e.target.value)}
                  className="vertical-slider"
                />
                <div className="slider-labels">
                  <span className={powerLevel === 3 ? 'active' : ''}>HIGH</span>
                  <span className={powerLevel === 2 ? 'active' : ''}>MED</span>
                  <span className={powerLevel === 1 ? 'active' : ''}>LOW</span>
                  <span className={powerLevel === 0 ? 'active' : ''}>OFF</span>
                </div>
              </div>
            </div>

            <div className="patterns-section">
              <h3>Patterns</h3>
              <input
                type="range"
                min="4" max="10" step="1"
                value={activePattern}
                onChange={(e) => handlePatternChange(e.target.value)}
                className="pattern-slider"
              />
              <div className="active-pattern-card">
                <div className="pat-icon">{PATTERNS.find(p => p.id === activePattern)?.icon || '✨'}</div>
                <div className="pat-name">{PATTERNS.find(p => p.id === activePattern)?.name || 'Default Pattern'}</div>
              </div>
            </div>

            <button onClick={handleStop} className="btn-stop-major">EMERGENCY STOP</button>
          </div>
        )}
      </main>
    </div>
  );
}

export default App;

import React, { useState, useEffect, useRef } from 'react';
import './App.css';

// Config - Adjust WebSocket URL to your deployment
const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const host = window.location.host.includes('5173')
  ? 'localhost:8080'
  : window.location.host;
const WS_URL = `${protocol}//${host}`;
const BLE_SERVICE_UUID = 0xffa0; // Main service from logs
const VIBE_SERVICE_UUID = '5833ff01-9b8b-5191-6142-22a4536ef123'; // Specific long service from logs
const FITNESS_SERVICE = 0x1814;

function App() {
  const [role, setRole] = useState(null); // 'controller' or 'bridge'
  const [deviceId, setDeviceId] = useState('trueform-1');
  const [connected, setConnected] = useState(false);
  const [speed, setSpeed] = useState(0);
  const [status, setStatus] = useState('Disconnected');
  const [ws, setWs] = useState(null);
  const [bleDevice, setBleDevice] = useState(null);
  const [bleChars, setBleChars] = useState([]);
  const [log, setLog] = useState([]);

  const addLog = (msg) => {
    setLog(prev => [msg, ...prev].slice(0, 10));
    console.log(`[LOG]: ${msg}`);
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const r = params.get('role');
    if (r === 'bridge' || r === 'controller') {
      setRole(r);
    }
    const id = params.get('deviceId');
    if (id) setDeviceId(id);
  }, []);

  const sendVibeCommand = async (rawValue) => {
    if (!bleChars.length) return;
    const s = Math.min(255, Math.floor((rawValue / 100) * 255));

    // Shotgun approach: Try every common protocol
    const cmds = [
      new Uint8Array([s]),                        // Raw
      new Uint8Array([0x01, s]),                  // Common Op 1
      new Uint8Array([0x03, s]),                  // Common Op 3
      new Uint8Array([0x0F, 0x03, 0x00, s, s]),   // Satisfyer/Generic
      new Uint8Array([0x01, 0x01, s]),            // Hismith/Standard
      new Uint8Array([0x02, s, 0x00]),            // Fitness
    ];

    for (const char of bleChars) {
      for (const cmd of cmds) {
        try {
          // Use withoutResponse for speed
          await char.writeValueWithoutResponse(cmd);
          await new Promise(r => setTimeout(r, 10));
        } catch (e) { }
      }
    }
    addLog(`Vibe ${rawValue}% Shotgun Sent`);
  };

  const connectWS = () => {
    if (ws) ws.close();
    const socket = new WebSocket(`${WS_URL}?deviceId=${deviceId}&type=${role}`);

    socket.onopen = () => {
      setStatus('Connected to Server');
      setConnected(true);
      addLog('WebSocket Linked');
    };

    socket.onmessage = async (event) => {
      const msg = JSON.parse(event.data);
      if (role === 'bridge' && msg.action === 'speed') {
        const val = parseInt(msg.value);
        setSpeed(val);
        sendVibeCommand(val);
      } else if (role === 'controller' && msg.action === 'status') {
        setStatus(`Bridge: ${msg.value}`);
      }
    };

    socket.onclose = () => {
      setStatus('Disconnected from Server');
      setConnected(false);
      addLog('WebSocket Disconnected');
    };

    setWs(socket);
  };

  const connectBLE = async () => {
    try {
      addLog('Scanning for J-TrueForm3...');
      setStatus('Scanning...');
      const device = await navigator.bluetooth.requestDevice({
        filters: [{ name: 'J-TrueForm3' }, { namePrefix: 'J-' }],
        optionalServices: [VIBE_SERVICE_UUID, BLE_SERVICE_UUID, FITNESS_SERVICE]
      });

      const onDisconnect = () => {
        addLog('BLE Hardware Disconnected');
        setStatus('Disconnected');
        setBleDevice(null);
        setBleChars([]);
      };
      device.addEventListener('gattserverdisconnected', onDisconnect);

      addLog('Connecting to GATT Server...');
      let server = await device.gatt.connect();

      // Retry logic if not connected
      if (!server.connected) {
        addLog('Retrying GATT Connect...');
        server = await device.gatt.connect();
      }

      addLog('Discovering Services...');
      const services = await server.getPrimaryServices();
      addLog(`Found ${services.length} services`);

      // Try specialized vibe service first
      let service = services.find(s => s.uuid.toLowerCase().includes('5833ff01')) ||
        services.find(s => s.uuid.toLowerCase().includes('ffa0')) ||
        services[0];

      if (!service) throw new Error('No compatible services found');

      addLog(`Using service: ${service.uuid.substring(0, 8)}`);
      const chars = await service.getCharacteristics();
      const writableChars = chars.filter(c => c.properties.write || c.properties.writeWithoutResponse);

      if (writableChars.length === 0) throw new Error('No writable characteristics found');

      addLog(`Ready! Linked ${writableChars.length} channels`);
      setBleChars(writableChars);
      setBleDevice(device);
      setStatus('Hardware Ready');

      if (ws) {
        ws.send(JSON.stringify({ action: 'status', value: 'Bridge Online & Connected' }));
      }
    } catch (err) {
      addLog(`BLE Error: ${err.message}`);
      setStatus('BLE Failed');
    }
  };

  const updateSpeed = (valStr) => {
    const val = parseInt(valStr);
    setSpeed(val);
    if (ws && role === 'controller') {
      ws.send(JSON.stringify({ action: 'speed', value: val }));
    }
    // Local testing for bridge role
    if (role === 'bridge') {
      sendVibeCommand(val);
    }
  };

  if (!role) {
    return (
      <div className="setup-container">
        <h1>TrueForm Remote</h1>
        <div className="role-selector">
          <button onClick={() => setRole('controller')} className="btn">She (Controller)</button>
          <button onClick={() => setRole('bridge')} className="btn secondary">You (BLE Bridge)</button>
        </div>
      </div>
    );
  }

  return (
    <div className={`app-container ${role}`}>
      <header>
        <h1>{role === 'bridge' ? 'Bridge Mode' : 'Controller Mode'}</h1>
        <div className="status-badge" data-status={connected}>{status}</div>
      </header>

      <main>
        <div className="config-card">
          <label>Device ID:</label>
          <div style={{ display: 'flex', gap: '8px' }}>
            <input
              type="text"
              value={deviceId}
              onChange={(e) => setDeviceId(e.target.value)}
              disabled={connected}
              style={{ flex: 1 }}
            />
            {connected && <button onClick={() => setConnected(false)} className="btn secondary" style={{ padding: '8px 12px' }}>Reset Link</button>}
          </div>
          {!connected && <button onClick={connectWS} className="btn">Connect WebSocket</button>}
        </div>

        {role === 'bridge' && (
          <div className="action-card">
            <h2>Hardware Connection</h2>
            <button onClick={connectBLE} className="btn" disabled={!connected || bleDevice}>
              {bleDevice ? 'BLE Connected' : 'Connect Treadmill (BLE)'}
            </button>
            <div className="speed-display">
              <span className="label">Power Level:</span>
              <span className="value">{speed}%</span>
            </div>

            <div style={{ display: 'flex', gap: '10px', marginTop: '15px' }}>
              <button
                onClick={() => updateSpeed(100)}
                className="btn secondary"
                style={{ flex: 1 }}
                disabled={!bleDevice}
              >
                Pulse 100%
              </button>
              <button
                onClick={() => updateSpeed(0)}
                className="btn secondary"
                style={{ flex: 1, background: '#475569' }}
                disabled={!bleDevice}
              >
                Stop
              </button>
            </div>

            <div className="debug-console" style={{ marginTop: '20px', padding: '15px', background: 'rgba(0,0,0,0.3)', borderRadius: '12px', fontSize: '12px' }}>
              <h3 style={{ margin: '0 0 10px 0', fontSize: '14px', color: '#94a3b8' }}>System Log</h3>
              <div style={{ maxHeight: '100px', overflowY: 'auto' }}>
                {log.length === 0 ? <div style={{ color: '#475569' }}>Waiting for activity...</div> : log.map((msg, i) => (
                  <div key={i} style={{ marginBottom: '4px', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '2px' }}>
                    {msg}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {role === 'controller' && (
          <div className="action-card">
            <h2>Speed Control</h2>
            <div className="speed-slider-container">
              <input
                type="range"
                min="0"
                max="100"
                step="1"
                value={speed}
                onChange={(e) => updateSpeed(e.target.value)}
                className="speed-slider"
              />
              <div className="speed-value">{speed}</div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default App;

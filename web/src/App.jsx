import React, { useState, useEffect, useRef } from 'react';
import './App.css';

// Config - Adjust WebSocket URL to your deployment
const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const host = window.location.host.includes('5173')
  ? 'localhost:8080'
  : window.location.host;
const WS_URL = `${protocol}//${host}`;

// JoyHub Protocol Configuration (from Buttplug device-config-v4)
const JOYHUB_SERVICE_UUID = '0000ffa0-0000-1000-8000-00805f9b34fb';
const JOYHUB_TX_CHAR_UUID = '0000ffa1-0000-1000-8000-00805f9b34fb';

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

    // TrueForm3 Protocol: [0xa0, 0x0c, 0x00, 0x00, mode, intensity]
    // Mode 0x01 = Constant vibration (direct intensity control)
    const intensity = Math.min(255, Math.floor((rawValue / 100) * 255));
    const mode = 0x01;

    const cmd = new Uint8Array([0xa0, 0x0c, 0x00, 0x00, mode, intensity]);

    try {
      await bleChars[0].writeValue(cmd);
      addLog(`✓ Vibration set to ${rawValue}% (0x${intensity.toString(16)})`);
    } catch (err) {
      addLog(`✗ Command failed: ${err.message}`);
    }
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
      addLog(`📨 Received: ${JSON.stringify(msg)}`);

      if (role === 'bridge' && msg.action === 'speed') {
        const val = parseInt(msg.value);
        setSpeed(val);
        addLog(`🎮 Controller set speed to ${val}%`);
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
        optionalServices: [JOYHUB_SERVICE_UUID]
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

      addLog('Getting JoyHub Service...');
      const service = await server.getPrimaryService(JOYHUB_SERVICE_UUID);

      addLog('Getting TX Characteristic...');
      const txChar = await service.getCharacteristic(JOYHUB_TX_CHAR_UUID);

      if (!txChar.properties.writeWithResponse && !txChar.properties.writeWithoutResponse) {
        throw new Error('TX characteristic is not writable');
      }

      addLog(`✓ JoyHub Connected! Ready to send commands.`);
      setBleChars([txChar]);
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
      const msg = { action: 'speed', value: val };
      ws.send(JSON.stringify(msg));
      addLog(`📤 Sent to bridge: ${val}%`);
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

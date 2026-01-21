import React, { useState, useEffect, useRef } from 'react';
import './App.css';

// Config - Adjust WebSocket URL to your deployment
const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const host = window.location.host.includes('5173')
  ? 'localhost:8080'
  : window.location.host;
const WS_URL = `${protocol}//${host}`;
const BLE_SERVICE_UUID = 0xffa0; // Corrected to hex alias
const VIBE_SERVICE_UUID = '5833ff01-9b8b-5191-6142-22a4536ef123';
const FITNESS_SERVICE = 0x1814;

function App() {
  const [role, setRole] = useState(null); // 'controller' or 'bridge'
  const [deviceId, setDeviceId] = useState('trueform-1');
  const [connected, setConnected] = useState(false);
  const [speed, setSpeed] = useState(0);
  const [status, setStatus] = useState('Disconnected');
  const [ws, setWs] = useState(null);
  const [bleDevice, setBleDevice] = useState(null);
  const [bleChars, setBleChars] = useState([]); // Changed to array to try multiple

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const r = params.get('role');
    if (r === 'bridge' || r === 'controller') {
      setRole(r);
    }
    const id = params.get('deviceId');
    if (id) setDeviceId(id);
  }, []);

  const connectWS = () => {
    if (ws) ws.close();
    const socket = new WebSocket(`${WS_URL}?deviceId=${deviceId}&type=${role}`);

    socket.onopen = () => {
      setStatus('Connected to Server');
      setConnected(true);
    };

    socket.onmessage = async (event) => {
      const msg = JSON.parse(event.data);
      if (role === 'bridge' && msg.action === 'speed') {
        const rawValue = parseInt(msg.value);
        setSpeed(rawValue);
        if (bleChars.length > 0) {
          try {
            const scaledValue = Math.min(255, Math.floor((rawValue / 100) * 255));
            console.log(`Hardware Command: UI=${rawValue} -> Scaled=${scaledValue}`);

            // Try writing to ALL writable characteristics found
            for (const char of bleChars) {
              try {
                if (char.uuid.includes('2ad9')) {
                  await char.writeValue(new Uint8Array([0x02, scaledValue, 0x00]));
                } else {
                  // This is the common "Vibe" packet format for many devices:
                  // [0x0F, 0x03, 0x00, speed, speed]
                  const vibeCmd = new Uint8Array([0x0F, 0x03, 0x00, scaledValue, scaledValue]);

                  // Try specialized vibe command
                  await char.writeValue(vibeCmd);

                  // fallback to raw single byte if the above fails or doesn't work
                  await char.writeValue(new Uint8Array([scaledValue]));
                }
                console.log(`Success writing to ${char.uuid}`);
              } catch (e) {
                console.warn(`Failed writing to ${char.uuid}: ${e.message}`);
              }
            }
          } catch (err) {
            console.error('BLE Write Error:', err);
            setStatus(`Err: ${err.message}`);
          }
        }
      } else if (role === 'controller' && msg.action === 'status') {
        setStatus(`Bridge: ${msg.value}`);
      }
    };

    socket.onclose = () => {
      setStatus('Disconnected from Server');
      setConnected(false);
    };

    setWs(socket);
  };

  const connectBLE = async () => {
    try {
      setStatus('Scanning for TrueForm...');

      const device = await navigator.bluetooth.requestDevice({
        filters: [
          { name: 'J-TrueForm3' },
          { namePrefix: 'J-' },
          { services: [VIBE_SERVICE_UUID] },
          { services: [BLE_SERVICE_UUID] }
        ],
        optionalServices: [VIBE_SERVICE_UUID, BLE_SERVICE_UUID, FITNESS_SERVICE]
      });

      setStatus(`Connecting to ${device.name}...`);
      const server = await device.gatt.connect();

      let service;
      try {
        service = await server.getPrimaryService(VIBE_SERVICE_UUID);
      } catch (e) {
        try {
          service = await server.getPrimaryService(BLE_SERVICE_UUID);
        } catch (e2) {
          service = await server.getPrimaryService(FITNESS_SERVICE);
        }
      }

      setStatus(`Fetching characteristics...`);
      const chars = await service.getCharacteristics();

      // Keep only writable ones
      const writableChars = chars.filter(c => c.properties.write || c.properties.writeWithoutResponse);

      console.log('Writable Chars:', writableChars.map(c => c.uuid));

      setBleChars(writableChars);
      setBleDevice(device);
      setStatus(`BLE Connected: ${device.name}`);

      if (ws) {
        ws.send(JSON.stringify({ action: 'status', value: `Active: ${device.name}` }));
      }
    } catch (err) {
      console.error('BLE Error:', err);
      setStatus(`BLE Error: ${err.message || 'Failed'}`);
    }
  };

  const updateSpeed = (newSpeed) => {
    const val = parseInt(newSpeed);
    setSpeed(val);
    if (ws && role === 'controller') {
      ws.send(JSON.stringify({ action: 'speed', value: val }));
    } else if (role === 'bridge') {
      // Allow local testing to trigger the message handler logic
      const event = { data: JSON.stringify({ action: 'speed', value: val }) };
      socket.onmessage(event);
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
        <h1>TrueForm {role === 'bridge' ? 'Bridge' : 'Controller'}</h1>
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
            {connected && <button onClick={() => setConnected(false)} className="btn secondary" style={{ padding: '8px 12px' }}>Reset</button>}
          </div>
          {!connected && <button onClick={connectWS} className="btn">Connect WebSocket</button>}
        </div>

        {role === 'bridge' && (
          <div className="action-card">
            <h2>Bridge Control</h2>
            <button onClick={connectBLE} className="btn" disabled={!connected || bleDevice}>
              {bleDevice ? 'BLE Connected' : 'Connect Treadmill (BLE)'}
            </button>
            <div className="speed-display">
              <span className="label">Current Speed:</span>
              <span className="value">{speed}</span>
            </div>
            {bleDevice && bleChars.length > 0 && (
              <div style={{ fontSize: '10px', color: '#94a3b8', textAlign: 'center' }}>
                Active Chars: {bleChars.map(c => c.uuid.substring(0, 8)).join(', ')}
              </div>
            )}
            <div style={{ display: 'flex', gap: '10px', marginTop: '15px' }}>
              <button
                onClick={() => {
                  const val = 100;
                  setSpeed(val);
                  // Manually trigger logic
                  const mockEvent = { data: JSON.stringify({ action: 'speed', value: val }) };
                  const socket = {
                    onmessage: async (e) => {
                      const msg = JSON.parse(e.data);
                      // Inline the logic for testing
                      for (const char of bleChars) {
                        const scaled = 255;
                        try { await char.writeValue(new Uint8Array([0x0F, 0x03, 0x00, scaled, scaled])); } catch (e) { }
                        try { await char.writeValue(new Uint8Array([scaled])); } catch (e) { }
                      }
                    }
                  };
                  socket.onmessage(mockEvent);
                }}
                className="btn secondary"
                style={{ flex: 1 }}
                disabled={!bleDevice}
              >
                Test 100%
              </button>
              <button
                onClick={() => {
                  setSpeed(0);
                  for (const char of bleChars) {
                    char.writeValue(new Uint8Array([0x0F, 0x03, 0x00, 0, 0])).catch(() => { });
                    char.writeValue(new Uint8Array([0])).catch(() => { });
                  }
                }}
                className="btn secondary"
                style={{ flex: 1, background: '#475569' }}
                disabled={!bleDevice}
              >
                Stop
              </button>
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

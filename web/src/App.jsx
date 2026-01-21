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
  const [bleChar, setBleChar] = useState(null);

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
        if (bleChar) {
          try {
            // Scale 0-100 to 0-255 for hardware
            const scaledValue = Math.min(255, Math.floor((rawValue / 100) * 255));

            // Try different write formats
            if (bleChar.uuid.includes('2ad9')) {
              // Fitness Machine Control Point OpCode 0x02 (Set Target Speed)
              // Speed is often value * 100, sent as 2 bytes
              const data = new Uint8Array([0x02, scaledValue, 0x00]);
              await bleChar.writeValue(data);
            } else {
              // Standard raw single byte write (most common for simple devices)
              await bleChar.writeValue(new Uint8Array([scaledValue]));
            }
            console.log(`BLE Write: UI=${rawValue} -> Hardware=${scaledValue}`);
          } catch (err) {
            console.error('BLE Write Error:', err);
            setStatus('BLE Write Error');
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
          { namePrefix: 'TrueForm' },
          { services: [VIBE_SERVICE_UUID] },
          { services: [BLE_SERVICE_UUID] }
        ],
        optionalServices: [VIBE_SERVICE_UUID, BLE_SERVICE_UUID, FITNESS_SERVICE]
      });

      setStatus(`Connecting to ${device.name}...`);
      const server = await device.gatt.connect();

      // Try services in order of specificity
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
      const characteristics = await service.getCharacteristics();
      console.log('Available Characteristics:', characteristics.map(c => ({
        uuid: c.uuid,
        props: c.properties
      })));

      // Logic to find the control characteristic
      const char = characteristics.find(c => c.properties.write || c.properties.writeWithoutResponse) || characteristics[0];

      if (!char.properties.write && !char.properties.writeWithoutResponse) {
        setStatus('Warning: Selected char is NOT writable');
      }

      setBleChar(char);
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
          <input
            type="text"
            value={deviceId}
            onChange={(e) => setDeviceId(e.target.value)}
            disabled={connected}
          />
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

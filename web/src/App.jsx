import React, { useState, useEffect, useRef } from 'react';
import './App.css';

// Config - Adjust WebSocket URL to your deployment
const WS_URL = window.location.hostname === 'localhost'
  ? 'ws://localhost:8080'
  : 'wss://tnt.veroe.fun/api/ble';
const BLE_SERVICE_UUID = '0000ffa0-0000-1000-8000-00805f9b34fb'; // Common expansion for 16-bit UUID 'ffa0'
const BLE_CHAR_UUID = '0000ffa1-0000-1000-8000-00805f9b34fb'; // Placeholder - user should verify

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
        setSpeed(msg.value);
        if (bleChar) {
          try {
            await bleChar.writeValue(new Uint8Array([msg.value]));
            console.log('BLE Write Success:', msg.value);
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

      const FITNESS_SERVICE = '00001814-0000-1000-8000-00805f9b34fb';

      const device = await navigator.bluetooth.requestDevice({
        filters: [
          { namePrefix: 'TrueForm' },
          { name: 'TrueForm3' },
          { services: [BLE_SERVICE_UUID] },
          { services: ['00001814-0000-1000-8000-00805f9b34fb'] }
        ],
        optionalServices: [BLE_SERVICE_UUID, FITNESS_SERVICE]
      });

      setStatus(`Connecting to ${device.name}...`);
      const server = await device.gatt.connect();

      let service;
      try {
        service = await server.getPrimaryService(FITNESS_SERVICE);
      } catch (e) {
        service = await server.getPrimaryService(BLE_SERVICE_UUID);
      }

      setStatus(`Fetching characteristics...`);
      const characteristics = await service.getCharacteristics();
      console.log('Available Characteristics:', characteristics.map(c => c.uuid));

      // 0x2AD9 is Fitness Machine Control Point
      const controlPoint = characteristics.find(c => c.uuid.includes('2ad9'));
      const char = controlPoint || characteristics.find(c => c.properties.write) || characteristics[0];

      setBleChar(char);
      setBleDevice(device);
      setStatus(`BLE Connected: ${device.name}`);

      if (ws) {
        ws.send(JSON.stringify({ action: 'status', value: `Connected: ${device.name}` }));
      }
    } catch (err) {
      console.error('BLE Error:', err);
      setStatus(`BLE Error: ${err.message || 'Failed'}`);
    }
  };

  const updateSpeed = (newSpeed) => {
    setSpeed(newSpeed);
    if (ws && role === 'controller') {
      ws.send(JSON.stringify({ action: 'speed', value: parseInt(newSpeed) }));
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
                max="20"
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

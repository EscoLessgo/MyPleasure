import React, { useState, useEffect, useRef } from 'react';
import './App.css';
import { PATTERNS } from './patterns';

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
  const [role, setRole] = useState(null);
  const [deviceId, setDeviceId] = useState('trueform-1');
  const [connected, setConnected] = useState(false);
  const [intensity, setIntensity] = useState(0);
  const [pattern, setPattern] = useState(1);
  const [status, setStatus] = useState('Disconnected');
  const [ws, setWs] = useState(null);
  const [bleDevice, setBleDevice] = useState(null);
  const bleCharsRef = useRef([]);
  const isWritingRef = useRef(false);

  const sendCommand = async (patternId, intensityValue) => {
    if (!bleCharsRef.current.length || isWritingRef.current) return;
    isWritingRef.current = true;

    const intensityByte = Math.min(255, Math.floor((intensityValue / 100) * 255));
    const cmd = new Uint8Array([0xa0, 0x0c, 0x00, 0x00, patternId, intensityByte]);

    try {
      await bleCharsRef.current[0].writeValue(cmd);
      console.log(`✓ Pattern ${patternId}, Intensity ${intensityValue}%`);
    } catch (err) {
      console.error('Command failed:', err);
    } finally {
      isWritingRef.current = false;
    }
  };

  const connectWS = () => {
    if (ws) ws.close();
    const socket = new WebSocket(`${WS_URL}?deviceId=${deviceId}&type=${role}`);

    socket.onopen = () => {
      setStatus('Connected');
      setConnected(true);
    };

    socket.onmessage = async (event) => {
      const msg = JSON.parse(event.data);

      if (role === 'bridge') {
        if (msg.action === 'intensity') {
          setIntensity(msg.value);
          sendCommand(pattern, msg.value);
        } else if (msg.action === 'pattern') {
          setPattern(msg.value);
          sendCommand(msg.value, intensity);
        }
      } else if (role === 'controller' && msg.action === 'status') {
        setStatus(`Bridge: ${msg.value}`);
      }
    };

    socket.onclose = () => {
      setStatus('Disconnected');
      setConnected(false);
    };

    setWs(socket);
  };

  const connectBLE = async () => {
    try {
      const device = await navigator.bluetooth.requestDevice({
        filters: [{ name: 'J-TrueForm3' }, { namePrefix: 'J-' }],
        optionalServices: [JOYHUB_SERVICE_UUID]
      });

      device.addEventListener('gattserverdisconnected', () => {
        setBleDevice(null);
        bleCharsRef.current = [];
      });

      const server = await device.gatt.connect();
      const service = await server.getPrimaryService(JOYHUB_SERVICE_UUID);
      const txChar = await service.getCharacteristic(JOYHUB_TX_CHAR_UUID);

      bleCharsRef.current = [txChar];
      setBleDevice(device);

      if (ws) {
        ws.send(JSON.stringify({ action: 'status', value: 'Bridge Connected' }));
      }
    } catch (err) {
      console.error('BLE Error:', err);
    }
  };

  const handlePatternChange = (patternId) => {
    setPattern(patternId);

    if (ws && role === 'controller') {
      ws.send(JSON.stringify({ action: 'pattern', value: patternId }));
    }

    if (role === 'bridge') {
      sendCommand(patternId, intensity);
    }
  };

  const handleIntensityChange = (value) => {
    setIntensity(value);

    if (ws && role === 'controller') {
      ws.send(JSON.stringify({ action: 'intensity', value }));
    }

    if (role === 'bridge') {
      sendCommand(pattern, value);
    }
  };

  if (!role) {
    return (
      <div className="setup-container">
        <div className="logo">⚡ TrueForm Remote</div>
        <div className="role-selector">
          <button onClick={() => setRole('controller')} className="btn-large controller">
            <span className="icon">🎮</span>
            <span className="label">Controller</span>
            <span className="sublabel">Control remotely</span>
          </button>
          <button onClick={() => setRole('bridge')} className="btn-large bridge">
            <span className="icon">🔗</span>
            <span className="label">Bridge</span>
            <span className="sublabel">Connect to device</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={`app ${role}`}>
      <header>
        <div className="header-left">
          <h1>{role === 'bridge' ? '🔗 Bridge' : '🎮 Controller'}</h1>
          <div className={`status ${connected ? 'connected' : ''}`}>{status}</div>
        </div>
        <button onClick={() => setRole(null)} className="btn-reset">↻ Change Role</button>
      </header>

      <main>
        {!connected && (
          <div className="connect-card">
            <input
              type="text"
              value={deviceId}
              onChange={(e) => setDeviceId(e.target.value)}
              placeholder="Device ID"
              className="device-input"
            />
            <button onClick={connectWS} className="btn-connect">
              Connect to Server
            </button>
          </div>
        )}

        {role === 'bridge' && connected && !bleDevice && (
          <button onClick={connectBLE} className="btn-ble">
            📡 Connect to TrueForm3
          </button>
        )}

        {((role === 'controller' && connected) || (role === 'bridge' && bleDevice)) && (
          <>
            <div className="pattern-selector">
              <h3>Vibration Pattern</h3>
              <div className="pattern-grid">
                {PATTERNS.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => handlePatternChange(p.id)}
                    className={`pattern-btn ${pattern === p.id ? 'active' : ''}`}
                  >
                    <span className="pattern-icon">{p.icon}</span>
                    <span className="pattern-name">{p.name}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="intensity-control">
              <div className="intensity-header">
                <h3>Intensity</h3>
                <div className="intensity-value">{intensity}%</div>
              </div>
              <input
                type="range"
                min="0"
                max="100"
                value={intensity}
                onChange={(e) => handleIntensityChange(parseInt(e.target.value))}
                className="intensity-slider"
              />
              <div className="quick-controls">
                <button onClick={() => handleIntensityChange(0)} className="btn-quick">Off</button>
                <button onClick={() => handleIntensityChange(25)} className="btn-quick">Low</button>
                <button onClick={() => handleIntensityChange(50)} className="btn-quick">Mid</button>
                <button onClick={() => handleIntensityChange(75)} className="btn-quick">High</button>
                <button onClick={() => handleIntensityChange(100)} className="btn-quick">Max</button>
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}

export default App;

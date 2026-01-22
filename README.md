# TrueForm Remote Bridge & Controller

A WebSocket-based bridge and web controller for **JoyHub devices** (specifically J-TrueForm3), implementing the official [Buttplug.io JoyHub protocol](https://github.com/buttplugio/buttplug/blob/master/crates/buttplug_server_device_config/device-config-v4/protocols/joyhub.yml).

## 🎯 Features

- ✅ **Official JoyHub Protocol**: Battle-tested command format from Buttplug.io
- 🌐 **WebSocket Relay**: Control devices remotely over the network
- 📱 **Dual Interface**: Bridge mode (BLE gateway) and Controller mode (remote)
- 🔧 **Precise Control**: 0-100% intensity slider with proper 0-255 scaling
- 📊 **Live Logging**: Real-time system logs for debugging
- 🎨 **Beautiful UI**: Modern glassmorphism design with smooth animations

## 🚀 Quick Start

### Prerequisites

- **Node.js** 18+ and npm
- **Chrome/Edge browser** (Web Bluetooth required)
- **JoyHub device** (J-TrueForm3 or compatible)

### Installation

```bash
# Install all dependencies
npm run install-all

# Start the server
npm start

# In a separate terminal, start the dev server
cd web
npm run dev
```

### Access the Application

- **Bridge Mode**: http://localhost:5173/?role=bridge
- **Controller Mode**: http://localhost:5173/?role=controller

## 📡 How It Works

### Architecture

```
┌─────────────┐                          ┌─────────────┐
│  Controller │  ◄── WebSocket Relay ──► │   Bridge    │
│   (Web UI)  │                          │   (Web UI)  │
└─────────────┘                          └──────┬──────┘
                                                │
                                          BLE Connection
                                         (JoyHub Protocol)
                                                │
                                                ▼
                                         ┌─────────────┐
                                         │ J-TrueForm3 │
                                         └─────────────┘
```

### Bridge Mode

1. Connects to the WebSocket relay server
2. Pairs with J-TrueForm3 via Web Bluetooth
3. Receives commands from controller
4. Translates to JoyHub BLE commands
5. Sends to device via TX characteristic

### Controller Mode

1. Connects to the WebSocket relay server
2. Presents intensity slider (0-100%)
3. Sends commands to bridge
4. Bridge executes on device

## 🔧 JoyHub Protocol

The implementation uses the official JoyHub protocol:

### BLE Specifications

```
Service UUID:  0000ffa0-0000-1000-8000-00805f9b34fb
TX Char UUID:  0000ffa1-0000-1000-8000-00805f9b34fb
```

### Command Format

```
[0xff, 0x04, 0x01, motor_index, intensity]
```

- **Header**: `0xff` - Protocol identifier
- **Length**: `0x04` - Command payload length
- **Version**: `0x01` - Protocol version
- **Index**: `0x00` - Motor index (0 for TrueForm3)
- **Intensity**: `0x00-0xff` - Vibration strength (0-255)

### Examples

```javascript
// Stop
[0xff, 0x04, 0x01, 0x00, 0x00]

// 50% intensity
[0xff, 0x04, 0x01, 0x00, 0x7f]

// Maximum intensity
[0xff, 0x04, 0x01, 0x00, 0xff]
```

## 📖 Documentation

- **[JOYHUB_PROTOCOL.md](../JOYHUB_PROTOCOL.md)**: Complete protocol documentation
- **[PROTOCOL_REFERENCE.md](../PROTOCOL_REFERENCE.md)**: Quick reference with examples

## 🎮 Usage

### Setup Bridge

1. Open bridge interface with `?role=bridge`
2. Enter a unique device ID (e.g., `trueform-1`)
3. Click **Connect WebSocket**
4. Click **Connect Treadmill (BLE)**
5. Select your J-TrueForm3 from the list
6. Wait for "✓ JoyHub Connected!" message

### Setup Controller

1. Open controller interface with `?role=controller`
2. Enter the **same device ID** as bridge
3. Click **Connect WebSocket**
4. Use the slider to control intensity
5. Bridge will execute commands on the device

## 🛠️ Development

### Project Structure

```
trueform-bridge/
├── server/               # WebSocket relay server
│   ├── index.js         # Express + WebSocket server
│   └── package.json
├── web/                 # React frontend
│   ├── src/
│   │   ├── App.jsx      # Main application (JoyHub protocol)
│   │   ├── App.css      # Styling
│   │   └── main.jsx     # Entry point
│   ├── index.html
│   └── package.json
├── JOYHUB_PROTOCOL.md   # Protocol documentation
├── PROTOCOL_REFERENCE.md # Quick reference
└── package.json         # Root package
```

### Key Technologies

- **Backend**: Express.js + WebSocket (ws)
- **Frontend**: React + Vite
- **BLE**: Web Bluetooth API
- **Protocol**: Official Buttplug.io JoyHub implementation

## 🐛 Troubleshooting

### Device Won't Vibrate

1. Check system log for "✓ Command sent successfully"
2. Ensure device is named exactly "J-TrueForm3"
3. Verify device is charged and powered on
4. Try unpairing from system Bluetooth settings

### BLE Connection Fails

1. Use Chrome or Edge (Firefox/Safari don't support Web Bluetooth)
2. Ensure HTTPS in production (localhost works with HTTP)
3. Grant Bluetooth permissions when prompted
4. Check device is in pairing mode

### WebSocket Connection Issues

1. Verify server is running (`npm start`)
2. Check firewall isn't blocking port 8080
3. Ensure device ID matches between bridge and controller

## 🔒 Security Notes

- WebSocket server accepts all CORS origins (for development)
- No authentication required (add for production)
- BLE pairing uses system-level security
- HTTPS required for Web Bluetooth in production

## 📋 Browser Compatibility

| Feature | Chrome | Edge | Opera | Firefox | Safari |
|---------|--------|------|-------|---------|--------|
| Web Bluetooth | ✅ | ✅ | ✅ | ❌ | ❌ |
| WebSocket | ✅ | ✅ | ✅ | ✅ | ✅ |

## 🎉 Supported Devices

This implementation works with **100+ JoyHub devices**:

- J-TrueForm3 ⭐ (tested)
- J-TrueForm
- J-Velocity
- J-ElixirEgg
- J-RetroGuard
- J-Rhythmic2/3
- J-Rainbow
- And many more...

## 🙏 Credits

Protocol implementation based on:
- **Buttplug.io**: Open-source sex toy control framework
- **Device Config**: https://github.com/buttplugio/buttplug

## 📄 License

MIT License

---

**Made with ❤️ for the JoyHub community**

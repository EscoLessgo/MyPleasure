# TrueForm Bridge - JoyHub Protocol Implementation

## Overview

This application now implements the **official JoyHub protocol** based on the [Buttplug.io device configuration](https://github.com/buttplugio/buttplug/blob/master/crates/buttplug_server_device_config/device-config-v4/protocols/joyhub.yml).

## JoyHub Protocol Specifications

### BLE Service & Characteristics
- **Service UUID**: `0000ffa0-0000-1000-8000-00805f9b34fb`
- **TX Characteristic**: `0000ffa1-0000-1000-8000-00805f9b34fb` (writable)

### Command Format

JoyHub devices use **Protocol Index 1** with the following command structure:

```
[0xff, 0x04, 0x01, motor_index, intensity]
```

**Command Breakdown:**
- **Byte 0**: `0xff` - Protocol header
- **Byte 1**: `0x04` - Command length (4 bytes after this)
- **Byte 2**: `0x01` - Protocol version/type
- **Byte 3**: `motor_index` - Motor/feature index (0 for TrueForm3 primary vibrator)
- **Byte 4**: `intensity` - Vibration intensity (0-255)

### Supported J-TrueForm3 Features

According to the device configuration:
- **Feature**: Vibrate
- **Index**: 0
- **Value Range**: 0-255
- **Device ID**: `5a3c541a-2924-44cc-a92d-d48b58cf0159`

## Implementation Details

### Key Changes from Previous Version

1. **Precise Protocol**: Replaced "shotgun" approach with exact JoyHub protocol commands
2. **Correct Service**: Using official `0xffa0` service UUID (full format)
3. **TX Characteristic**: Targeting specific `0xffa1` TX characteristic for writes
4. **Proper Scaling**: Input values (0-100%) are correctly scaled to device range (0-255)

### Command Flow

```
User Input (0-100%) 
  → Scale to 0-255
  → Build JoyHub command: [0xff, 0x04, 0x01, 0x00, intensity]
  → Write to TX characteristic (0xffa1)
  → Device responds with vibration
```

## Testing the Implementation

### Bridge Mode Setup

1. **Open Bridge Interface**:
   ```
   http://localhost:5173/?role=bridge
   ```

2. **Connect to Server**: Click "Connect WebSocket"

3. **Pair Device**: 
   - Click "Connect Treadmill (BLE)"
   - Select "J-TrueForm3" from the Bluetooth device list
   - Wait for "✓ JoyHub Connected!" message

4. **Test Vibration**:
   - Click "Pulse 100%" to send maximum vibration
   - Click "Stop" to turn off vibration
   - Check system log for command confirmations

### Controller Mode

1. **Open Controller Interface**:
   ```
   http://localhost:5173/?role=controller
   ```

2. **Connect to Same Device ID**: Match the bridge's device ID

3. **Control Remotely**: Use the slider to control vibration intensity (0-100%)

## Log Messages

The system log shows detailed feedback:

- **Connection**: `✓ JoyHub Connected! Ready to send commands.`
- **Command Sent**: `Sending JoyHub: vibe=128 (50%)`
- **Success**: `✓ Command sent successfully`
- **Errors**: `✗ Write failed: [error message]`

## Troubleshooting

### Device Won't Vibrate

1. **Check Logs**: Look for "✓ Command sent successfully" messages
2. **Verify Device Name**: Ensure device is actually named "J-TrueForm3"
3. **Check Pairing**: Some devices need to be unpaired from system Bluetooth first
4. **Battery Level**: Low battery can prevent operation

### Connection Fails

1. **Browser Compatibility**: Web Bluetooth requires Chrome/Edge (not Firefox/Safari)
2. **HTTPS Required**: Production deployments need HTTPS (localhost works with HTTP)
3. **Permissions**: Ensure Bluetooth permissions are granted to browser

### Cannot Find Service

If you see "Service not found" errors:
- Device may not be in pairing mode
- Try power cycling the device
- Ensure device is fully charged

## Device Compatibility

This implementation specifically targets **J-TrueForm3**, but the JoyHub protocol is compatible with many other devices:

- J-TrueForm
- J-Velocity
- J-ElixirEgg
- J-RetroGuard
- J-Rhythmic2/3
- J-Rainbow
- And 100+ more JoyHub devices

To add support, simply update the device filter in `connectBLE()`:

```javascript
filters: [
  { name: 'J-TrueForm3' },
  { name: 'J-Velocity' },
  { namePrefix: 'J-' }  // Catches all JoyHub devices
]
```

## Protocol Reference

Based on Buttplug.io's battle-tested implementation, used by thousands of users worldwide.

**Configuration Source**: 
https://github.com/buttplugio/buttplug/blob/master/crates/buttplug_server_device_config/device-config-v4/protocols/joyhub.yml

## Architecture

```
┌─────────────┐         WebSocket         ┌─────────────┐
│  Controller │ ◄──────────────────────► │   Bridge    │
│   (Web UI)  │                           │   (Web UI)  │
└─────────────┘                           └──────┬──────┘
                                                 │
                                                 │ BLE
                                                 │ (JoyHub Protocol)
                                                 ▼
                                          ┌─────────────┐
                                          │ J-TrueForm3 │
                                          │   Device    │
                                          └─────────────┘
```

## Next Steps

- **Add More Features**: Implement oscillate, rotate for multi-feature devices
- **Pattern Support**: Add predefined vibration patterns
- **Battery Monitoring**: Read battery level characteristic
- **Multi-Motor**: Support devices with multiple motors
- **Haptic Feedback**: Add controller vibration feedback

## License

MIT License - Based on Buttplug.io's open-source device configurations

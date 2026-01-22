# JoyHub Protocol Quick Reference

## Connection Parameters

```javascript
Service:        0000ffa0-0000-1000-8000-00805f9b34fb
TX Char:        0000ffa1-0000-1000-8000-00805f9b34fb (Write)
```

## Command Structure

### Vibration Command
```
┌─────┬─────┬─────┬─────┬──────────┐
│ 0xff│ 0x04│ 0x01│ IDX │ INTENSITY│
└─────┴─────┴─────┴─────┴──────────┘
  ^     ^     ^     ^       ^
  │     │     │     │       └─ Motor intensity (0-255)
  │     │     │     └───────── Motor index (0 for TrueForm3)
  │     │     └─────────────── Protocol version
  │     └───────────────────── Command length
  └─────────────────────────── Protocol header
```

## Example Commands

### Stop (0%)
```javascript
[0xff, 0x04, 0x01, 0x00, 0x00]
```

### Low (25%)
```javascript
[0xff, 0x04, 0x01, 0x00, 0x3f]  // 63
```

### Medium (50%)
```javascript
[0xff, 0x04, 0x01, 0x00, 0x7f]  // 127
```

### High (75%)
```javascript
[0xff, 0x04, 0x01, 0x00, 0xbf]  // 191
```

### Maximum (100%)
```javascript
[0xff, 0x04, 0x01, 0x00, 0xff]  // 255
```

## Code Example

```javascript
// Connect to device
const device = await navigator.bluetooth.requestDevice({
  filters: [{ name: 'J-TrueForm3' }],
  optionalServices: ['0000ffa0-0000-1000-8000-00805f9b34fb']
});

const server = await device.gatt.connect();
const service = await server.getPrimaryService('0000ffa0-0000-1000-8000-00805f9b34fb');
const txChar = await service.getCharacteristic('0000ffa1-0000-1000-8000-00805f9b34fb');

// Send 50% vibration
const intensity = 127;  // 50% of 255
const cmd = new Uint8Array([0xff, 0x04, 0x01, 0x00, intensity]);
await txChar.writeValueWithResponse(cmd);
```

## Motor Indices (J-TrueForm3)

| Index | Feature Type | Description        |
|-------|-------------|--------------------|
| 0     | Vibrate     | Primary vibrator   |

*Note: Multi-motor devices have different index mappings*

## Scaling Formula

```javascript
// Convert percentage (0-100) to device value (0-255)
intensity = Math.floor((percentage / 100) * 255)

// Examples:
//   0%   →   0
//  25%   →  63
//  50%   → 127
//  75%   → 191
// 100%   → 255
```

## Device Name Patterns

All JoyHub devices follow the naming convention:
```
J-[DeviceName]
```

Examples:
- J-TrueForm3
- J-Velocity
- J-ElixirEgg
- J-RetroGuard
- J-Rhythmic2
- etc.

## Error Handling

```javascript
try {
  await txChar.writeValueWithResponse(cmd);
  console.log('✓ Success');
} catch (err) {
  if (err.message.includes('GATT')) {
    console.error('Device disconnected');
  } else if (err.message.includes('permission')) {
    console.error('Bluetooth permission denied');
  } else {
    console.error('Write error:', err.message);
  }
}
```

## Timing Considerations

- **Minimum delay between commands**: 50ms recommended
- **Connection timeout**: 10 seconds default
- **Write timeout**: 5 seconds default
- **Disconnect grace period**: 2 seconds for cleanup

## Browser Support

| Browser | Version | Support |
|---------|---------|---------|
| Chrome  | 56+     | ✅ Full  |
| Edge    | 79+     | ✅ Full  |
| Opera   | 43+     | ✅ Full  |
| Firefox | -       | ❌ None  |
| Safari  | -       | ❌ None  |

*Web Bluetooth API required*

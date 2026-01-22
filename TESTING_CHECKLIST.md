# 🧪 Testing Checklist - JoyHub Protocol

## Pre-Flight Checks

- [ ] **Node.js installed** (version 18+)
- [ ] **Chrome or Edge browser** (Web Bluetooth support)
- [ ] **J-TrueForm3 device** (charged and powered on)
- [ ] **Bluetooth enabled** on computer
- [ ] **Device unpaired** from system Bluetooth (if previously paired)

## Installation

```bash
# 1. Install dependencies
npm run install-all

# Expected output: Dependencies installed successfully
```

## Server Startup

```bash
# 2. Start WebSocket relay server
npm start

# Expected output:
# ✓ WebSocket server listening on port 8080
```

## Frontend Development Server

```bash
# 3. In a new terminal, start dev server
cd web
npm run dev

# Expected output:
# ✓ VITE v7.x.x  ready in XXX ms
# ➜  Local:   http://localhost:5173/
```

## Bridge Mode Testing

### Step 1: Access Bridge Interface
```
URL: http://localhost:5173/?role=bridge
```

**Expected:**
- [ ] Glassmorphism UI loads
- [ ] "Bridge Mode" header visible
- [ ] Device ID input shows "trueform-1"
- [ ] Status badge shows "Disconnected" (red)

### Step 2: WebSocket Connection
- [ ] Click **"Connect WebSocket"** button
- [ ] Status changes to "Connected to Server" (green)
- [ ] Button becomes "Reset Link"

**Console Log Expected:**
```
[LOG]: WebSocket Linked
```

### Step 3: BLE Device Connection
- [ ] Click **"Connect Treadmill (BLE)"** button
- [ ] Bluetooth device picker appears
- [ ] "J-TrueForm3" device visible in list
- [ ] Select device and click "Pair"

**Console Log Expected:**
```
[LOG]: Scanning for J-TrueForm3...
[LOG]: Connecting to GATT Server...
[LOG]: Getting JoyHub Service...
[LOG]: Getting TX Characteristic...
[LOG]: ✓ JoyHub Connected! Ready to send commands.
```

**UI Changes Expected:**
- [ ] Status shows "Hardware Ready" (green)
- [ ] "Connect Treadmill" button disabled and shows "BLE Connected"
- [ ] "Pulse 100%" and "Stop" buttons enabled
- [ ] System log shows connection messages

### Step 4: Test Vibration

#### Test 4A: Maximum Intensity
- [ ] Click **"Pulse 100%"** button

**Expected:**
```
[LOG]: Sending JoyHub: vibe=255 (100%)
[LOG]: ✓ Command sent successfully
```

**Physical Result:**
- [ ] **Device vibrates at maximum intensity**

#### Test 4B: Stop Command
- [ ] Click **"Stop"** button

**Expected:**
```
[LOG]: Sending JoyHub: vibe=0 (0%)
[LOG]: ✓ Command sent successfully
```

**Physical Result:**
- [ ] **Device stops vibrating**

#### Test 4C: Progressive Test
Repeat the following sequence:
1. [ ] Click "Pulse 100%" - vibration starts
2. [ ] Wait 2 seconds
3. [ ] Click "Stop" - vibration stops
4. [ ] Wait 1 second

**All tests passed:** Device responds consistently

## Controller Mode Testing

### Step 1: Access Controller Interface
```
URL: http://localhost:5173/?role=controller
```

**Expected:**
- [ ] "Controller Mode" header visible
- [ ] Device ID shows "trueform-1"
- [ ] Speed slider visible
- [ ] Large speed value display shows "0"

### Step 2: Connect to Bridge
- [ ] Enter same device ID as bridge: `trueform-1`
- [ ] Click **"Connect WebSocket"** button
- [ ] Status changes to "Connected to Server"

### Step 3: Remote Control Test

#### Test 3A: Low Intensity (25%)
- [ ] Move slider to 25%
- [ ] Large number displays "25"

**Expected on Bridge:**
```
[LOG]: Sending JoyHub: vibe=63 (25%)
[LOG]: ✓ Command sent successfully
```

**Physical Result:**
- [ ] Device vibrates at low intensity

#### Test 3B: Medium Intensity (50%)
- [ ] Move slider to 50%

**Expected:**
- [ ] Device vibrates at medium intensity
- [ ] Smooth intensity change

#### Test 3C: High Intensity (75%)
- [ ] Move slider to 75%

**Expected:**
- [ ] Device vibrates at high intensity

#### Test 3D: Maximum (100%)
- [ ] Move slider to 100%

**Expected:**
- [ ] Device vibrates at maximum intensity

#### Test 3E: Gradual Control
- [ ] Slowly move slider from 0 to 100
- [ ] Then slowly back down to 0

**Expected:**
- [ ] Smooth, responsive intensity changes
- [ ] No lag or stuttering
- [ ] Commands sent quickly (<100ms)

## Error Handling Tests

### Test E1: Disconnect Device
- [ ] Turn off J-TrueForm3 while connected

**Expected:**
```
[LOG]: BLE Hardware Disconnected
```

**UI Changes:**
- [ ] Status shows "Disconnected"
- [ ] "Connect Treadmill" button re-enabled
- [ ] "Pulse/Stop" buttons disabled

### Test E2: Reconnect Device
- [ ] Turn on J-TrueForm3
- [ ] Click "Connect Treadmill" again

**Expected:**
- [ ] Reconnection successful
- [ ] All functionality restored

### Test E3: WebSocket Disconnect
- [ ] Stop server with Ctrl+C
- [ ] Wait 5 seconds

**Expected:**
- [ ] "Disconnected from Server" status
- [ ] Auto-reconnect attempts (if implemented)

## Performance Tests

### Test P1: Rapid Commands
In controller mode:
- [ ] Quickly move slider back and forth 10 times

**Expected:**
- [ ] All commands execute
- [ ] No crashes or freezes
- [ ] Device responds to each change

### Test P2: Sustained Operation
- [ ] Set slider to 50%
- [ ] Leave running for 5 minutes

**Expected:**
- [ ] No disconnections
- [ ] Consistent vibration
- [ ] No memory leaks

## Browser Developer Tools Check

### Console Tab
- [ ] Open DevTools (F12)
- [ ] No red error messages
- [ ] Only info/log messages

### Network Tab (WebSocket)
- [ ] WebSocket connection shows "101 Switching Protocols"
- [ ] Messages flowing in both directions

### Bluetooth Tab (chrome://bluetooth-internals)
- [ ] GATT connection established
- [ ] Service UUID visible: `0xffa0`
- [ ] Characteristic UUID visible: `0xffa1`

## Common Issues & Solutions

### ❌ "User cancelled the requestDevice() chooser"
**Solution:** User needs to select device and click Pair

### ❌ "GATT Server is disconnected"
**Solution:** 
- Device out of range
- Low battery
- Turn device off and on

### ❌ "Web Bluetooth API not available"
**Solution:** Use Chrome or Edge browser

### ❌ "NotFoundError: No Services matching UUID"
**Solution:**
- Wrong device selected
- Device not in pairing mode
- Try power cycling device

### ❌ Device vibrates but stops immediately
**Solution:**
- Check battery level
- Ensure commands are sustaining (not just one-time pulse)

## Success Criteria

All tests must pass:
- ✅ WebSocket connection stable
- ✅ BLE pairing successful
- ✅ Device vibrates on command
- ✅ Intensity control works
- ✅ Stop command works
- ✅ Remote control functional
- ✅ No console errors
- ✅ Smooth user experience

## Final Validation

### The Ultimate Test
1. [ ] Controller on one device
2. [ ] Bridge on another device
3. [ ] Both connected to same server
4. [ ] Slide controller to 50%
5. [ ] Device in bridge room vibrates

**If this works:** 🎉 **Full success!**

## Troubleshooting Contact

If tests fail, collect:
1. Console log messages
2. Browser name and version
3. Device name as shown in Bluetooth picker
4. Exact error messages
5. When the error occurs

## Notes Section

Use this space to record any issues:

```
Date: ___________
Test Result: Pass / Fail
Issues Found:


Solutions Applied:


```

---

**Last Updated:** 2026-01-22
**Protocol Version:** JoyHub v1 (Buttplug.io)
**Test Suite Version:** 1.0

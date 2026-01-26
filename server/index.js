const express = require('express');
const { WebSocketServer } = require('ws');
const http = require('http');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(cors());

const distPath = path.resolve(__dirname, '..', 'web', 'dist');
app.use(express.static(distPath));

app.get('*', (req, res) => {
    const indexPath = path.join(distPath, 'index.html');
    if (fs.existsSync(indexPath)) res.sendFile(indexPath);
    else res.status(404).send('Frontend not found.');
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const rooms = new Map();

wss.on('connection', (ws, req) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const deviceId = url.searchParams.get('deviceId') || 'default';
    const clientType = url.searchParams.get('type') || 'controller';
    const username = url.searchParams.get('username') || 'Anonymous';

    ws.metadata = {
        role: clientType,
        username: username,
        joinedAt: new Date(),
        id: Math.random().toString(36).substring(2, 7),
        status: clientType === 'bridge' ? 'active' : 'pending' // Host is always active
    };

    if (!rooms.has(deviceId)) {
        rooms.set(deviceId, new Set());
    }
    const clients = rooms.get(deviceId);
    clients.add(ws);

    const broadcastRoomState = () => {
        const participantList = Array.from(clients).map(c => ({
            role: c.metadata.role,
            username: c.metadata.username,
            status: c.metadata.status,
            id: c.metadata.id
        }));
        const stateMessage = JSON.stringify({ action: 'room-state', value: participantList });
        clients.forEach(client => {
            if (client.readyState === 1) client.send(stateMessage);
        });
    };

    broadcastRoomState();

    ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());

        // Handle Handshake logic
        if (msg.action === 'accept-guest' && ws.metadata.role === 'bridge') {
            const guest = Array.from(clients).find(c => c.metadata.id === msg.guestId);
            if (guest) {
                guest.metadata.status = 'active';
                guest.send(JSON.stringify({ action: 'handshake-approved' }));
                broadcastRoomState();
            }
            return;
        }

        if (msg.action === 'deny-guest' && ws.metadata.role === 'bridge') {
            const guest = Array.from(clients).find(c => c.metadata.id === msg.guestId);
            if (guest) {
                guest.send(JSON.stringify({ action: 'handshake-denied' }));
                guest.close();
            }
            return;
        }

        // Normal broadcasting: Only from active participants
        if (ws.metadata.status === 'active') {
            clients.forEach(client => {
                // Bridge gets everything. Guests only get if they are active.
                if (client !== ws && client.readyState === 1) {
                    if (client.metadata.role === 'bridge' || client.metadata.status === 'active') {
                        client.send(JSON.stringify(msg));
                    }
                }
            });
        }
    });

    ws.on('close', () => {
        clients.delete(ws);
        if (clients.size === 0) rooms.delete(deviceId);
        else broadcastRoomState();
    });
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
    console.log(`TNT SYNC Protocol running on port ${PORT}`);
});

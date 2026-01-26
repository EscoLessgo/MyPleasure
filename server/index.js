const express = require('express');
const { WebSocketServer } = require('ws');
const http = require('http');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(cors());

const distPath = path.resolve(__dirname, '..', 'web', 'dist');

// Serve static assets directly
app.use(express.static(distPath));

// Fallback for SPA
app.get('*', (req, res) => {
    const indexPath = path.join(distPath, 'index.html');
    if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
    } else {
        res.status(404).send('Frontend not found. Please build the web project.');
    }
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const rooms = new Map();

wss.on('connection', (ws, req) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const deviceId = url.searchParams.get('deviceId') || 'default';
    const clientType = url.searchParams.get('type') || 'controller';

    ws.metadata = {
        role: clientType,
        joinedAt: new Date(),
        id: Math.random().toString(36).substring(2, 7)
    };

    if (!rooms.has(deviceId)) {
        rooms.set(deviceId, new Set());
    }
    const clients = rooms.get(deviceId);
    clients.add(ws);

    const broadcastRoomState = () => {
        const participantList = Array.from(clients).map(c => ({
            role: c.metadata.role,
            joinedAt: c.metadata.joinedAt,
            id: c.metadata.id
        }));
        const stateMessage = JSON.stringify({ action: 'room-state', value: participantList });
        clients.forEach(client => {
            if (client.readyState === 1) client.send(stateMessage);
        });
    };

    broadcastRoomState();

    ws.on('message', (data) => {
        const messageStr = data.toString();
        clients.forEach(client => {
            if (client !== ws && client.readyState === 1) client.send(messageStr);
        });
    });

    ws.on('close', () => {
        clients.delete(ws);
        if (clients.size === 0) rooms.delete(deviceId);
        else broadcastRoomState();
    });
});

const PORT = 8080;
server.listen(PORT, () => {
    console.log(`TrueForm Bridge running on http://localhost:${PORT}`);
});

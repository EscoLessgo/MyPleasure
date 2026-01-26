const express = require('express');
const { WebSocketServer } = require('ws');
const http = require('http');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());

// In production, serve the built React app
if (process.env.NODE_ENV === 'production') {
    app.use(express.static(path.join(__dirname, '../web/dist')));
    app.get('*', (req, res) => {
        res.sendFile(path.join(__dirname, '../web/dist/index.html'));
    });
} else {
    // In development, just show health check
    app.get('/', (req, res) => {
        res.send('TrueForm Bridge WebSocket Server Running');
    });
}

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// Map of deviceId -> Set of WebSocket clients
const rooms = new Map();

wss.on('connection', (ws, req) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const deviceId = url.searchParams.get('deviceId') || 'default';
    const clientType = url.searchParams.get('type') || 'controller';

    console.log(`New connection: deviceId=${deviceId}, type=${clientType}`);

    if (!rooms.has(deviceId)) {
        rooms.set(deviceId, new Set());
    }
    const clients = rooms.get(deviceId);

    // Add metadata to the socket
    ws.metadata = {
        role: clientType,
        joinedAt: new Date(),
        id: Math.random().toString(36).substring(2, 7)
    };
    clients.add(ws);

    // Helper to broadcast room state (active connections)
    const broadcastRoomState = () => {
        const participantList = Array.from(clients).map(c => ({
            role: c.metadata.role,
            joinedAt: c.metadata.joinedAt,
            id: c.metadata.id
        }));
        const stateMessage = JSON.stringify({ action: 'room-state', value: participantList });
        clients.forEach(client => {
            if (client.readyState === 1) {
                client.send(stateMessage);
            }
        });
    };

    broadcastRoomState();

    ws.on('message', (data) => {
        const messageStr = data.toString();

        // Broadcast to all other clients in the same room
        clients.forEach(client => {
            if (client !== ws && client.readyState === 1) {
                client.send(messageStr);
            }
        });
    });

    ws.on('close', () => {
        console.log(`Connection closed: deviceId=${deviceId}, type=${clientType}`);
        clients.delete(ws);
        if (clients.size === 0) {
            rooms.delete(deviceId);
        } else {
            broadcastRoomState();
        }
    });

    ws.on('error', (err) => {
        console.error(`WebSocket error: ${err.message}`);
    });
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
    console.log(`WebSocket server listening on port ${PORT}`);
});

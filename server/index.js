require('dotenv').config();
const express = require('express');
const { WebSocketServer } = require('ws');
const http = require('http');
const cors = require('cors');
const path = require('path');
const axios = require('axios');

const app = express();
app.use(cors());

// Discord OAuth Configuration
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const REDIRECT_URI = process.env.DISCORD_REDIRECT_URI;
const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:5173';

app.get('/api/auth/discord', (req, res) => {
    const scope = 'identify email';
    const url = `https://discord.com/api/oauth2/authorize?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=${scope}`;
    res.redirect(url);
});

app.get('/api/auth/discord/callback', async (req, res) => {
    const { code } = req.query;

    if (!code) {
        return res.status(400).send('No code provided');
    }

    try {
        const params = new URLSearchParams({
            client_id: CLIENT_ID,
            client_secret: CLIENT_SECRET,
            grant_type: 'authorization_code',
            code,
            redirect_uri: REDIRECT_URI,
        });

        const tokenResponse = await axios.post('https://discord.com/api/oauth2/token', params, {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });

        const { access_token } = tokenResponse.data;

        const userResponse = await axios.get('https://discord.com/api/users/@me', {
            headers: { Authorization: `Bearer ${access_token}` }
        });

        const user = userResponse.data;

        // Redirect back to frontend with user info (in a real app, sign a JWT)
        // For now, we'll pass the simple user info to the frontend
        const redirectUrl = `${CLIENT_URL}?auth=success&username=${encodeURIComponent(user.username)}&id=${user.id}`;
        res.redirect(redirectUrl);

    } catch (error) {
        console.error('Discord Auth Error:', error.response?.data || error.message);
        res.redirect(`${CLIENT_URL}?auth=error`);
    }
});

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
    clients.add(ws);

    ws.on('message', (data) => {
        const message = data.toString();
        // console.log(`Message from ${clientType} [${deviceId}]: ${message}`);

        // Broadcast to all other clients in the same room
        clients.forEach(client => {
            if (client !== ws && client.readyState === 1) { // 1 = OPEN
                client.send(message);
            }
        });
    });

    ws.on('close', () => {
        console.log(`Connection closed: deviceId=${deviceId}, type=${clientType}`);
        clients.delete(ws);
        if (clients.size === 0) {
            rooms.delete(deviceId);
        }
    });

    ws.on('error', (err) => {
        console.error(`WebSocket error: ${err.message}`);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`WebSocket server listening on port ${PORT}`);
});

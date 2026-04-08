const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data.json');
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'VikaWheel2024';
const MAX_JSON_BODY = 2 * 1024 * 1024;
const MAX_UPLOAD_JSON = 12 * 1024 * 1024;

if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify({
        options: [{ label: 'Ничего', sound: '' }, { label: 'Джекпот — 10 000 ₽', sound: '' }, { label: 'Бонуска', sound: '' }],
        history: [],
        settings: {
            spinSound: 'spin.mp3',
            startBtnText: 'Да-да, Нет-нет',
            conveyorSpeed: 15,
            spinTimeSeconds: 12
        },
        lastUpdate: Date.now()
    }, null, 2));
}

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.ogg': 'audio/ogg',
    '.m4a': 'audio/mp4',
    '.aac': 'audio/aac',
    '.webm': 'audio/webm',
    '.json': 'application/json; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon'
};

function safeJoinUpload(urlPath) {
    const name = path.basename(decodeURIComponent(urlPath));
    return path.join(UPLOAD_DIR, name);
}

function sendFile(res, fullPath) {
    try {
        if (!fs.existsSync(fullPath) || !fs.lstatSync(fullPath).isFile()) {
            res.writeHead(404);
            return res.end();
        }
        const ext = path.extname(fullPath).toLowerCase();
        res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
        res.end(fs.readFileSync(fullPath));
    } catch {
        res.writeHead(500);
        res.end();
    }
}

const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Password');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        return res.end();
    }

    if (req.method === 'GET') {
        if (req.url === '/health') {
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify({ status: 'alive', timestamp: new Date().toISOString() }));
        }

        if (req.url === '/api/data') {
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(fs.readFileSync(DATA_FILE));
        }

        let u = req.url.split('?')[0];
        if (u.startsWith('/uploads/')) {
            const full = safeJoinUpload(u.replace(/^\/uploads\//, ''));
            if (!full.startsWith(UPLOAD_DIR)) {
                res.writeHead(403);
                return res.end();
            }
            return sendFile(res, full);
        }

        let filePath = u === '/' ? 'index.html' : u.substring(1);
        const fullPath = path.join(__dirname, filePath);
        if (fs.existsSync(fullPath) && fs.lstatSync(fullPath).isFile()) {
            const ext = path.extname(fullPath).toLowerCase();
            res.writeHead(200, { 'Content-Type': MIME[ext] || 'text/plain; charset=utf-8' });
            return res.end(fs.readFileSync(fullPath));
        }
        res.writeHead(404);
        return res.end();
    }

    if (req.method === 'POST' && req.url === '/api/auth-check') {
        let body = '';
        req.on('data', chunk => {
            body += chunk.toString();
            if (body.length > 4096) req.destroy();
        });
        req.on('end', () => {
            try {
                const j = JSON.parse(body);
                if (j.password !== ADMIN_PASSWORD) {
                    res.writeHead(403, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ ok: false }));
                }
                res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                return res.end(JSON.stringify({ ok: true }));
            } catch {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ ok: false }));
            }
        });
        return;
    }

    if (req.method === 'POST' && req.url === '/api/upload-audio') {
        let body = '';
        req.on('data', chunk => {
            body += chunk.toString();
            if (body.length > MAX_UPLOAD_JSON) req.destroy();
        });
        req.on('end', () => {
            try {
                const j = JSON.parse(body);
                if (j.password !== ADMIN_PASSWORD) {
                    res.writeHead(403, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ error: 'forbidden' }));
                }
                const raw = String(j.data || '');
                const b64 = raw.replace(/^data:audio\/[^;]+;base64,/, '');
                const buf = Buffer.from(b64, 'base64');
                if (buf.length < 32 || buf.length > 8 * 1024 * 1024) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ error: 'invalid_size' }));
                }
                let base = path.basename(j.filename || 'sound.mp3').replace(/[^a-zA-Z0-9._-]/g, '_');
                if (!/\.(mp3|wav|ogg|m4a|aac|webm)$/i.test(base)) base += '.mp3';
                const fname = `${Date.now()}_${base}`;
                fs.writeFileSync(path.join(UPLOAD_DIR, fname), buf);
                res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                return res.end(JSON.stringify({ url: '/uploads/' + fname }));
            } catch (e) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ error: 'bad_request' }));
            }
        });
        return;
    }

    if (req.method === 'POST' && req.url === '/api/data') {
        let body = '';
        req.on('data', chunk => {
            body += chunk.toString();
            if (body.length > MAX_JSON_BODY) req.destroy();
        });
        req.on('end', () => {
            try {
                const incomingData = JSON.parse(body);
                if (incomingData.password !== ADMIN_PASSWORD) {
                    res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
                    return res.end(JSON.stringify({ status: 'error', message: 'wrong_password' }));
                }
                delete incomingData.password;
                incomingData.lastUpdate = Date.now();
                fs.writeFileSync(DATA_FILE, JSON.stringify(incomingData, null, 2));
                res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                return res.end(JSON.stringify({ status: 'ok' }));
            } catch (e) {
                res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
                return res.end(JSON.stringify({ status: 'error', message: 'parse' }));
            }
        });
        return;
    }

    res.writeHead(404);
    res.end();
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);

    const RENDER_URL = process.env.RENDER_EXTERNAL_URL;
    if (RENDER_URL) {
        const PING_INTERVAL = 10 * 60 * 1000;
        setInterval(() => {
            https.get(`${RENDER_URL}/health`, (resp) => {
                console.log(`[Keep-Alive] Ping OK: ${resp.statusCode} | ${new Date().toISOString()}`);
            }).on('error', (err) => {
                console.error(`[Keep-Alive] Ping failed: ${err.message}`);
            });
        }, PING_INTERVAL);
        console.log(`[Keep-Alive] Self-ping enabled every 10 min → ${RENDER_URL}/health`);
    } else {
        console.log('[Keep-Alive] RENDER_EXTERNAL_URL not set, self-ping disabled (local mode)');
    }
});

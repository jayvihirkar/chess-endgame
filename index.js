require('dotenv').config(); // Load environment variables from .env file
const express = require('express');
const cors = require('cors');
const path = require('path');
const https = require('https');
const app = express();
const PORT = process.env.PORT || 3000;

// --- CONFIGURATION ---
// Use the key from .env, with a fallback empty string if missing
const SERVER_API_KEY = process.env.GEMINI_API_KEY || ""; 

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- SCENARIO DATABASE ---
const SCENARIOS = {
    'king-pawn': [
        { fen: '8/8/8/8/4k3/8/4P3/4K3 w - - 0 1', title: 'King in Front', idea: 'Place your King IN FRONT of the pawn to control key squares (d4, e4, f4).' },
        { fen: '8/8/8/5k2/8/5P2/5K2/8 w - - 0 1', title: 'The Opposition', idea: 'Move your King to face the enemy King. This forces them to step aside.' },
        { fen: '8/8/8/8/3k4/8/4P3/3K4 w - - 0 1', title: 'Key Squares', idea: 'Reach the 6th rank ahead of the pawn to force a win.' },
        { fen: '8/8/8/8/8/2k5/1P6/1K6 w - - 0 1', title: 'Pawn Breakthrough', idea: 'Sacrifice or maneuver to get the pawn to the 8th rank.' },
        { fen: '8/5k2/8/5P2/5K2/8/8/8 w - - 0 1', title: 'Cutting Off', idea: 'Use your King to shoulder-barge the enemy King away.' }
    ],
    'king-rook': [
        { fen: '1R6/8/3P4/8/8/4k3/8/4K3 w - - 0 1', title: 'Lucena Position', idea: 'The Bridge! Use your Rook to shield your King from checks.' },
        { fen: '2r5/8/8/8/4k3/8/3R4/3K4 w - - 0 1', title: 'Philidor Position', idea: 'Keep your Rook on the 6th rank to stop the King. Draw technique.' }
    ],
    'king-queen': [
        { fen: '4k3/8/8/4k3/3Q4/8/8/8 w - - 0 1', title: 'Queen Mate', idea: 'Box the enemy King into a corner. Be careful of Stalemate!' },
        { fen: '8/1P6/8/8/2k5/8/5q2/3K4 w - - 0 1', title: 'Queen vs Pawn', idea: 'Bring the King closer while checking.' }
    ]
};

// --- API: GEMINI COACH ---
app.post('/api/ask-coach', async (req, res) => {
    let { prompt, apiKey } = req.body;

    // Use Server Environment Key if client didn't provide one
    if (!apiKey || apiKey.trim() === "") {
        apiKey = SERVER_API_KEY;
    }

    if (!apiKey) {
        console.error("API Key is missing. Ensure GEMINI_API_KEY is set in .env");
        return res.status(500).json({ error: "Server configuration error: API Key missing." });
    }

    try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }]
            })
        });

        if (!response.ok) {
            const errData = await response.text();
            throw new Error(`Gemini API Error: ${response.status} ${errData}`);
        }

        const data = await response.json();
        res.json(data);

    } catch (error) {
        console.error("Coach Error:", error);
        res.status(500).json({ error: "The Coach is currently offline (API Error)." });
    }
});

// --- API: FETCH GAME ---
app.get('/api/fetch-game', async (req, res) => {
    const { platform, gameId } = req.query;

    if (!platform || !gameId) return res.status(400).json({ error: 'Missing params' });

    try {
        let pgn = '';
        if (platform === 'chess.com') {
            try {
                pgn = await fetchChessComGame(gameId);
            } catch (e) {
                return res.status(400).json({ error: "Chess.com blocked request. Please copy the PGN text manually." });
            }
        } else if (platform === 'lichess') {
            pgn = await fetchLichessGame(gameId);
        }
        res.json({ pgn });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

function fetchChessComGame(gameId) {
    return new Promise((resolve, reject) => {
        const url = `https://www.chess.com/callback/live/game/${gameId}`;
        https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    if (json.game && json.game.pgn) resolve(json.game.pgn);
                    else reject(new Error('PGN not found'));
                } catch (e) { reject(e); }
            });
        }).on('error', reject);
    });
}

function fetchLichessGame(gameId) {
    return new Promise((resolve, reject) => {
        const url = `https://lichess.org/game/export/${gameId}?literate=1`;
        https.get(url, (res) => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
                if (data.includes('[Event')) resolve(data);
                else reject(new Error('Invalid Lichess ID'));
            });
        }).on('error', reject);
    });
}

// --- API: SCENARIOS ---
app.get('/api/endgame/:type', (req, res) => {
    const { type } = req.params;
    const prevIndex = parseInt(req.query.prevIndex) || -1;
    
    let key = type;
    if (key === 'random' || !SCENARIOS[key]) {
        const keys = Object.keys(SCENARIOS);
        key = keys[Math.floor(Math.random() * keys.length)];
    }

    const list = SCENARIOS[key];
    let idx = Math.floor(Math.random() * list.length);
    
    if (list.length > 1 && idx === prevIndex) {
        idx = (idx + 1) % list.length;
    }

    res.set('Cache-Control', 'no-store');
    res.json({ ...list[idx], type: key, index: idx });
});

// Regex catch-all for Express 5 compatibility
app.get(/.*/, (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// Start server (only if not in Vercel/Lambda environment)
if (process.env.NODE_ENV !== 'production' || !process.env.VERCEL) {
    app.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));
}

// Export for Vercel
module.exports = app;
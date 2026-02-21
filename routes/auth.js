// middleware/auth.js — Login / Logout / Session check
const express = require('express');
const bcrypt  = require('bcryptjs');
const router  = express.Router();
const db      = require('../db');

// ── POST /api/auth/login ──────────────────────────────────
router.post('/login', async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ error: 'Username and password required.' });
    }

    try {
        const [rows] = await db.query(
            'SELECT * FROM users WHERE username = ? LIMIT 1',
            [username.toLowerCase().trim()]
        );

        if (rows.length === 0) {
            return res.status(401).json({ error: 'No rows: Invalid username or password.' });
        }

        const user = rows[0];
        const match = (password === user.password);

        if (!match) {
            return res.status(401).json({ error: 'Wrong inputs: Invalid username or password.' });
        }

        // Store in session
        req.session.user = {
            id:          user.id,
            username:    user.username,
            displayName: user.display_name,
            role:        user.role,
        };

        return res.json({
            success:     true,
            displayName: user.display_name,
            role:        user.role,
        });

    } catch (err) {
        console.error('Login error:', err);
        return res.status(500).json({ error: 'Server error during login.' });
    }
});

// ── POST /api/auth/logout ─────────────────────────────────
router.post('/logout', (req, res) => {
    req.session.destroy(() => {
        res.json({ success: true });
    });
});

// ── GET /api/auth/me ──────────────────────────────────────
router.get('/me', (req, res) => {
    if (req.session && req.session.user) {
        return res.json({ loggedIn: true, user: req.session.user });
    }
    return res.json({ loggedIn: false });
});

module.exports = router;

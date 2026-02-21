// routes/mediators.js — CRUD for mediators
const express       = require('express');
const router        = express.Router();
const db            = require('../db');
const requireAuth = require('../middleware/requireAuth');

// ── GET /api/mediators — fetch all mediators ──
router.get('/', async (req, res) => {
    try {
        const [rows] = await db.query(
            'SELECT id, name, phone, location FROM mediators ORDER BY name'
        );
        return res.json(rows);
    } catch (err) {
        console.error('GET /mediators error:', err);
        return res.status(500).json({ error: 'Failed to fetch mediators.' });
    }
});

// ── POST /api/mediators — add new mediator ──
router.post('/', requireAuth, async (req, res) => {
    const { name, phone, location } = req.body;

    if (!name) {
        return res.status(400).json({ error: 'Mediator name is required.' });
    }

    try {
        const [result] = await db.query(
            `INSERT INTO mediators (name, phone, location)
             VALUES (?, ?, ?)
             ON DUPLICATE KEY UPDATE
                 phone    = COALESCE(VALUES(phone), phone),
                 location = COALESCE(VALUES(location), location)`,
            [name, phone || null, location || null]
        );
        return res.status(201).json({ success: true, id: result.insertId });
    } catch (err) {
        console.error('POST /mediators error:', err);
        return res.status(500).json({ error: 'Failed to save mediator.' });
    }
});

// ── DELETE /api/mediators/:id — remove a mediator ──
router.delete('/:id', requireAuth, async (req, res) => {
    const { id } = req.params;
    try {
        const [result] = await db.query('DELETE FROM mediators WHERE id = ?', [id]);
        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Mediator not found.' });
        }
        return res.json({ success: true });
    } catch (err) {
        console.error('DELETE /mediators error:', err);
        return res.status(500).json({ error: 'Failed to delete mediator.' });
    }
});

module.exports = router;

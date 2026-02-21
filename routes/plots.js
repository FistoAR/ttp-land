// routes/plots.js — CRUD for plots
const express       = require('express');
const router        = express.Router();
const db            = require('../db');
const requireAuth = require('../middleware/requireAuth');

// ── GET /api/plots  — load all plots into plotDB format ──
router.get('/', async (req, res) => {
    try {
        const [rows] = await db.query('SELECT * FROM plots ORDER BY plot_num');

        // Transform DB rows → plotDB object keyed by plot_key
        const plotDB = {};
        rows.forEach(r => {
            plotDB[r.plot_key] = {
                title:      r.title,
                plotNum:    r.plot_num,
                stampNum:   r.stamp_num,
                price:      r.price,
                length:     r.length_ft,
                width:      r.width_ft,
                sqft:       r.sqft,
                cent:       r.cent,
                facing:     r.facing,
                status:     r.status,       // 'available' | 'booked' | 'reserved' | 'registration done'
                db_id:      r.id,
            };
        });

        return res.json(plotDB);
    } catch (err) {
        console.error('GET /plots error:', err);
        return res.status(500).json({ error: 'Failed to fetch plots.' });
    }
});

// ── PUT /api/plots/:key — update plot details (price, dims, facing) ──
router.put('/:key', requireAuth, async (req, res) => {
    const { key } = req.params;
    const { price, length, width, sqft, cent, facing } = req.body;

    try {
        const [result] = await db.query(
            `UPDATE plots
             SET price = COALESCE(?, price),
                 length_ft = COALESCE(?, length_ft),
                 width_ft  = COALESCE(?, width_ft),
                 sqft      = COALESCE(?, sqft),
                 cent    = COALESCE(?, cent),
                 facing    = COALESCE(?, facing)
             WHERE plot_key = ?`,
            [price ?? null, length ?? null, width ?? null, sqft ?? null, cent ?? null, facing ?? null, key]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Plot not found.' });
        }

        return res.json({ success: true });
    } catch (err) {
        console.error('PUT /plots error:', err);
        return res.status(500).json({ error: 'Failed to update plot.' });
    }
});

// ── PATCH /api/plots/:key/status — update status only (called after customer save) ──
router.patch('/:key/status', requireAuth, async (req, res) => {
    const { key } = req.params;
    const { status } = req.body;  // 'available' | 'booked' | 'reserved' | 'registration done'

    const allowed = ['available', 'booked', 'reserved', 'registration done'];
    if (!allowed.includes(status)) {
        return res.status(400).json({ error: 'Invalid status value.' });
    }

    try {
        const [result] = await db.query(
            'UPDATE plots SET status = ? WHERE plot_key = ?',
            [status, key]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Plot not found.' });
        }

        return res.json({ success: true });
    } catch (err) {
        console.error('PATCH /plots/status error:', err);
        return res.status(500).json({ error: 'Failed to update plot status.' });
    }
});

module.exports = router;

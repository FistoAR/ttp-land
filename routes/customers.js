// routes/customers.js — CRUD for customers + installments
const express         = require('express');
const router          = express.Router();
const db              = require('../db');
const requireAuth = require('../middleware/requireAuth');


// ══════════════════════════════════════════════════════════
//  STATUS TRANSITION RULES
//  reserved    → can move to: booked, registered
//  booked      → can move to: registered ONLY (cannot go back to reserved)
//  registered  → LOCKED — no changes allowed at all
// ══════════════════════════════════════════════════════════
const ALLOWED_TRANSITIONS = {
    'reserved':   ['booked', 'registered'],
    'booked':     ['registered'],
    'registered': [],
};

function canTransition(currentStatus, newStatus) {
    if (currentStatus === newStatus) return true;
    const allowed = ALLOWED_TRANSITIONS[currentStatus] || [];
    return allowed.includes(newStatus);
}

// ── GET /api/customers ──────────────────────────────────
router.get('/', requireAuth, async (req, res) => {
    try {
        const [customers] = await db.query(`
            SELECT c.id,
                   c.customer_name   AS customerName,
                   c.customer_phone  AS customerPhone,
                   c.mediator_name   AS mediator,
                   c.commission,
                   c.booking_amount  AS bookingAmount,
                   c.closure_date    AS closureDate,
                   c.status,
                   p.title           AS plotLabel,
                   p.plot_key        AS plotKey
            FROM customers c
            JOIN plots p ON c.plot_id = p.id
            ORDER BY c.id DESC
        `);

        const [installments] = await db.query(`
            SELECT id, customer_id AS customerId, amount,
                   date_received AS date, follow_up_date AS followUp
            FROM installments ORDER BY customer_id, date_received
        `);

        const instMap = {};
        installments.forEach(inst => {
            if (!instMap[inst.customerId]) instMap[inst.customerId] = [];
            instMap[inst.customerId].push({
                id:       inst.id,
                amount: formatForStorage(inst.amount),
                date:     inst.date     ? inst.date.toISOString().split('T')[0]     : '',
                followUp: inst.followUp ? inst.followUp.toISOString().split('T')[0] : '',
            });
        });

        return res.json(customers.map(c => ({
            id:            c.id,
            customerName:  c.customerName,
            customerPhone: c.customerPhone,
            mediator:      c.mediator || '',
            commission:    formatForStorage(c.commission),
            bookingAmount: formatForStorage(c.bookingAmount),
            closureDate:   c.closureDate ? c.closureDate.toISOString().split('T')[0] : '',
            status:        c.status,
            plotLabel:     c.plotLabel,
            plotKey:       c.plotKey,
            installments:  instMap[c.id] || [],
        })));
    } catch (err) {
        console.error('GET /customers error:', err);
        return res.status(500).json({ error: 'Failed to fetch customers.' });
    }
});

const formatForStorage = (val) => {
  if (!val) return '0';
  return Number(String(val).replace(/,/g, '')).toLocaleString('en-IN');
};
// ── GET /api/customers/by-plot/:plotKey — load customer when plot is clicked ──
router.get('/by-plot/:plotKey', requireAuth, async (req, res) => {
    const { plotKey } = req.params;
    try {
        const [customers] = await db.query(`
            SELECT c.id, c.customer_name AS customerName,
                   c.customer_phone AS customerPhone,
                   c.mediator_name AS mediator, c.commission,
                   c.booking_amount AS bookingAmount,
                   c.closure_date AS closureDate, c.status,
                   p.title AS plotLabel, p.plot_key AS plotKey
            FROM customers c
            JOIN plots p ON c.plot_id = p.id
            WHERE p.plot_key = ?
            ORDER BY c.id DESC LIMIT 1
        `, [plotKey]);

        if (customers.length === 0) return res.json(null);

        const c = customers[0];
        const [insts] = await db.query(`
            SELECT id, amount,
                   date_received AS date, follow_up_date AS followUp
            FROM installments WHERE customer_id = ? ORDER BY date_received
        `, [c.id]);

        return res.json({
            id:            c.id,
            customerName:  c.customerName,
            customerPhone: c.customerPhone,
            mediator:      c.mediator || '',
            commission:    formatForStorage(c.commission),
            bookingAmount: formatForStorage(c.bookingAmount),
            closureDate:   c.closureDate ? c.closureDate.toISOString().split('T')[0] : '',
            status:        c.status,
            plotLabel:     c.plotLabel,
            plotKey:       c.plotKey,
            installments:  insts.map(i => ({
                id:       i.id,
                amount: formatForStorage(i.amount),
                date:     i.date     ? i.date.toISOString().split('T')[0]     : '',
                followUp: i.followUp ? i.followUp.toISOString().split('T')[0] : '',
            })),
        });
    } catch (err) {
        console.error('GET /customers/by-plot error:', err);
        return res.status(500).json({ error: 'Failed to fetch customer for plot.' });
    }
});

// ── POST /api/customers — save NEW customer ──
router.post('/', requireAuth, async (req, res) => {
    const { plotKey, customerName, customerPhone, mediator,
            commission, bookingAmount, closureDate, status, installments } = req.body;

    if (!customerName) return res.status(400).json({ error: 'Customer name is required.' });
    if (!plotKey)      return res.status(400).json({ error: 'Plot key is required.' });

    const statusMap     = { booked: 'booked', reserved: 'reserved', registered: 'registered' };
    const plotStatusMap = { booked: 'booked', reserved: 'reserved', registered: 'registration done' };
    const dbStatus      = statusMap[status];
    if (!dbStatus) return res.status(400).json({ error: 'Invalid status.' });

    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();

        // Block if plot already has a customer
        const [[existingCust]] = await conn.query(`
            SELECT c.id FROM customers c
            JOIN plots p ON c.plot_id = p.id
            WHERE p.plot_key = ? LIMIT 1
        `, [plotKey]);

        if (existingCust) {
            await conn.rollback();
            return res.status(409).json({
                error: 'Plot already has a customer. Use edit instead.',
                existingId: existingCust.id,
            });
        }

        const [[plot]] = await conn.query('SELECT id FROM plots WHERE plot_key = ?', [plotKey]);
        if (!plot) { await conn.rollback(); return res.status(404).json({ error: 'Plot not found.' }); }

        const [custResult] = await conn.query(
            `INSERT INTO customers
             (plot_id, customer_name, customer_phone, mediator_name,
              commission, booking_amount, closure_date, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [plot.id, customerName, customerPhone || null, mediator || null,
             commission || 0, bookingAmount || 0, closureDate || null, dbStatus]
        );
        const customerId = custResult.insertId;

        if (Array.isArray(installments) && installments.length > 0) {
            const instValues = installments
                .filter(i => i.amount)
                .map(i => [customerId, i.amount || 0, i.date || null, i.followUp || null]);
            if (instValues.length > 0)
                await conn.query(
                    'INSERT INTO installments (customer_id, amount, date_received, follow_up_date) VALUES ?',
                    [instValues]
                );
        }

        console.log(plotStatusMap, status);

        await conn.query('UPDATE plots SET status = ? WHERE id = ?', [plotStatusMap[status], plot.id]);
        await conn.commit();

        return res.status(201).json({ success: true, customerId, plotStatus: plotStatusMap[status] });
    } catch (err) {
        await conn.rollback();
        console.error('POST /customers error:', err);
        return res.status(500).json({ error: 'Failed to save customer.' });
    } finally {
        conn.release();
    }
});

// ── PUT /api/customers/:id — EDIT existing customer ──
router.put('/:id', requireAuth, async (req, res) => {
    const { id } = req.params;
    const { customerName, customerPhone, mediator, commission,
            bookingAmount, closureDate, status, installments } = req.body;

    if (!customerName) return res.status(400).json({ error: 'Customer name is required.' });

    const statusMap     = { booked: 'booked', reserved: 'reserved', registered: 'registered' };
    const plotStatusMap = { booked: 'booked', reserved: 'reserved', registered: 'registration done' };
    const newDbStatus   = statusMap[status];
    if (!newDbStatus) return res.status(400).json({ error: 'Invalid status.' });

    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();

        const [[current]] = await conn.query(`
            SELECT c.id, c.status, c.plot_id, p.plot_key
            FROM customers c JOIN plots p ON c.plot_id = p.id
            WHERE c.id = ?
        `, [id]);

        if (!current) { await conn.rollback(); return res.status(404).json({ error: 'Customer not found.' }); }

        // ── STATUS LOCK CHECK ──
        if (!canTransition(current.status, newDbStatus)) {
            await conn.rollback();
            return res.status(403).json({
                error: current.status === 'registered'
                    ? '🔒 This plot is Registered — status cannot be changed.'
                    : `Cannot move status from "${current.status}" back to "${newDbStatus}".`,
                currentStatus: current.status,
                locked: current.status === 'registered',
            });
        }

        await conn.query(
            `UPDATE customers SET
                customer_name = ?, customer_phone = ?, mediator_name = ?,
                commission = ?, booking_amount = ?, closure_date = ?, status = ?
             WHERE id = ?`,
            [customerName, customerPhone || null, mediator || null,
             commission || 0, bookingAmount || 0, closureDate || null, newDbStatus, id]
        );

        // Replace installments
        await conn.query('DELETE FROM installments WHERE customer_id = ?', [id]);
        if (Array.isArray(installments) && installments.length > 0) {
            const instValues = installments
                .filter(i => i.amount)
                .map(i => [id, i.amount || 0, i.date || null, i.followUp || null]);
            if (instValues.length > 0)
                await conn.query(
                    'INSERT INTO installments (customer_id, amount, date_received, follow_up_date) VALUES ?',
                    [instValues]
                );
        }

        await conn.query('UPDATE plots SET status = ? WHERE id = ?', [plotStatusMap[status], current.plot_id]);
        await conn.commit();

        return res.json({ success: true, plotStatus: plotStatusMap[status], newStatus: newDbStatus });
    } catch (err) {
        await conn.rollback();
        console.error('PUT /customers error:', err);
        return res.status(500).json({ error: 'Failed to update customer.' });
    } finally {
        conn.release();
    }
});


router.delete('/:id', requireAuth, async (req, res) => {
    const { id } = req.params;
    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();
        // Get plot_id before deleting
        const [[cust]] = await conn.query('SELECT plot_id FROM customers WHERE id = ?', [id]);
        if (!cust) { await conn.rollback(); return res.status(404).json({ error: 'Customer not found.' }); }
        
        await conn.query('DELETE FROM installments WHERE customer_id = ?', [id]);
        await conn.query('DELETE FROM customers WHERE id = ?', [id]);
        await conn.query('UPDATE plots SET status = ? WHERE id = ?', ['available', cust.plot_id]);
        
        await conn.commit();
        return res.json({ success: true });
    } catch (err) {
        await conn.rollback();
        return res.status(500).json({ error: 'Failed to delete customer.' });
    } finally {
        conn.release();
    }
});


module.exports = router;
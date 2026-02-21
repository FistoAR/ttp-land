// server.js — TTP Land Express Server
require('dotenv').config();
const express        = require('express');
const session        = require('express-session');
const cors           = require('cors');
const path           = require('path');

const authRoutes      = require('./routes/auth');
const plotRoutes      = require('./routes/plots');
const customerRoutes  = require('./routes/customers');
const mediatorRoutes  = require('./routes/mediators');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ────────────────────────────────────────────
app.use(cors({
    origin:      true,          // allow same-origin; lock this down in production
    credentials: true,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session store
app.use(session({
    secret:            process.env.SESSION_SECRET || 'ttp_fallback_secret',
    resave:            false,
    saveUninitialized: false,
    cookie: {
        secure:   process.env.NODE_ENV === 'production',
        httpOnly: true,
        maxAge:   8 * 60 * 60 * 1000,   // 8 hours
    },
}));

// ── Serve static frontend files from /public ─────────────
// Put your index.html, script.js, style.css, SVG etc. in ./public/
app.use(express.static(path.join(__dirname, 'public')));

// ── API Routes ────────────────────────────────────────────
app.use('/api/auth',      authRoutes);
app.use('/api/plots',     plotRoutes);
app.use('/api/customers', customerRoutes);
app.use('/api/mediators', mediatorRoutes);

// ── 404 catch-all for API ────────────────────────────────
app.use('/api', (req, res) => {
    res.status(404).json({ error: 'API endpoint not found.' });
});

// ── SPA fallback — serve index.html for any other route ──
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Global error handler ──────────────────────────────────
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error.' });
});

// ── Start ─────────────────────────────────────────────────
app.listen(PORT, () => {
    console.log(`🚀 TTP Land server running at http://localhost:${PORT}`);
    console.log(`   Environment : ${process.env.NODE_ENV || 'development'}`);
});

// const bcrypt = require('bcryptjs');

// (async () => {
//   const hash = '$2a$10$QZ2inz5bPLqGXnsWxV15ROouHChDWd4B.J0AglcuHfQ/OP6kdtQHe';
//   const result = await bcrypt.compare('admin123 ', hash);
//   console.log(result);
// })();

// // const bcrypt = require('bcryptjs');

// (async () => {
//   const hash = await bcrypt.hash('admin123', 10);
//   console.log(hash);
// })();


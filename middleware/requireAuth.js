function requireAuth(req, res, next) {
    console.log(`Session: ${req} | ${req?.session}`);
    if (!req.session || !req.session.user) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
}

module.exports = requireAuth;

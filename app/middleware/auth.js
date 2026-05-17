const jwt = require('jsonwebtoken');

function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }
  
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(403).json({ error: 'Invalid or expired token' });
  }
}

async function requireAdmin(req, res, next) {
  const userId = req.user.id;
  
  try {
    const result = await global.db.query(
      'SELECT * FROM users WHERE id = $1 AND email = $2',
      [userId, process.env.ADMIN_EMAIL]
    );
    
    if (result.rows.length === 0) {
      return res.status(403).json({ error: 'Admin access required' });
    }
    
    next();
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = { authenticateToken, requireAdmin };

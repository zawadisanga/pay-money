const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const dotenv = require('dotenv');
const { Pool } = require('pg');
const Redis = require('ioredis');

// Load environment variables
dotenv.config();

// Import modules
const authRoutes = require('./app/auth');
const walletRoutes = require('./app/wallet');
const transactionRoutes = require('./app/transactions');
const feeRoutes = require('./app/fees');
const { rateLimitMiddleware } = require('./app/middleware/rateLimit');
const { errorHandler } = require('./app/middleware/errorHandler');
const { initDatabase } = require('./app/utils/db');
const { createPlatformUser } = require('./app/utils/security');

// Initialize database connection
const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Initialize Redis connection
const redis = new Redis(process.env.REDIS_URL);

// Make db and redis available globally
global.db = db;
global.redis = redis;

// Create Express app
const app = express();

// Security middleware
app.use(helmet());
app.use(cors({
  origin: process.env.NODE_ENV === 'production' 
    ? ['https://yourdomain.com', 'https://api.yourdomain.com']
    : '*',
  credentials: true
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Rate limiting
app.use(rateLimitMiddleware);

// Health check endpoint
app.get('/health', async (req, res) => {
  try {
    await db.query('SELECT 1');
    await redis.ping();
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  } catch (error) {
    res.status(500).json({ status: 'error', error: error.message });
  }
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/wallet', walletRoutes);
app.use('/api/transactions', transactionRoutes);
app.use('/api/fees', feeRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// Error handler
app.use(errorHandler);

// Initialize database and start server
const PORT = process.env.PORT || 3000;

async function startServer() {
  try {
    // Initialize database tables
    await initDatabase();
    
    // Create platform revenue user if not exists
    await createPlatformUser();
    
    // Start server
    app.listen(PORT, () => {
      console.log(`🚀 Money System running on port ${PORT}`);
      console.log(`📊 Fee percentage: ${process.env.DEFAULT_FEE_PERCENT}%`);
      console.log(`🌍 Environment: ${process.env.NODE_ENV}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();

module.exports = app;

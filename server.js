const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const dotenv = require('dotenv');
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const rateLimit = require('express-rate-limit');

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// ========================================
// DATABASE CONNECTION (Heroku Postgres)
// ========================================
const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 20000,
});

// Test database connection
db.connect((err, client, release) => {
  if (err) {
    console.error('❌ Database connection error:', err.stack);
  } else {
    console.log('✅ Database connected successfully');
    release();
  }
});

// ========================================
// MIDDLEWARE
// ========================================
app.use(helmet({
  contentSecurityPolicy: false,
}));
app.use(cors({
  origin: '*',
  credentials: true
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  message: { error: 'Too many requests, please try again later.' }
});
app.use('/api/', limiter);

// ========================================
// HEALTH CHECK (Important for Heroku)
// ========================================
app.get('/health', async (req, res) => {
  try {
    await db.query('SELECT 1');
    res.status(200).json({ 
      status: 'ok', 
      timestamp: new Date().toISOString(),
      uptime: process.uptime()
    });
  } catch (error) {
    res.status(500).json({ status: 'error', error: error.message });
  }
});

app.get('/', (req, res) => {
  res.json({
    name: 'Money System API',
    version: '1.0.0',
    status: 'running',
    endpoints: {
      health: 'GET /health',
      auth: 'POST /api/auth/register, POST /api/auth/login',
      wallet: 'GET /api/wallet/balance, POST /api/wallet/deposit',
      transfer: 'POST /api/transfer/internal',
      fees: 'GET /api/fees/rates, POST /api/fees/calculate'
    }
  });
});

// ========================================
// DATABASE INITIALIZATION
// ========================================
async function initDatabase() {
  const createTables = `
    -- Users table
    CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        hashed_password VARCHAR(255) NOT NULL,
        full_name VARCHAR(255),
        phone_number VARCHAR(20),
        is_active BOOLEAN DEFAULT true,
        kyc_status VARCHAR(50) DEFAULT 'pending',
        balance DECIMAL(20,8) DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
    );

    -- Transactions table
    CREATE TABLE IF NOT EXISTS transactions (
        id UUID PRIMARY KEY,
        sender_id UUID REFERENCES users(id),
        receiver_id UUID REFERENCES users(id),
        amount DECIMAL(20,8) NOT NULL,
        currency VARCHAR(3) DEFAULT 'USD',
        type VARCHAR(50) NOT NULL,
        status VARCHAR(50) DEFAULT 'pending',
        fee_amount DECIMAL(20,8) DEFAULT 0,
        metadata JSONB,
        created_at TIMESTAMP DEFAULT NOW(),
        completed_at TIMESTAMP
    );

    -- Fee rules table
    CREATE TABLE IF NOT EXISTS fee_rules (
        id SERIAL PRIMARY KEY,
        transaction_type VARCHAR(50) NOT NULL,
        fee_percent DECIMAL(5,2) NOT NULL,
        min_fee DECIMAL(20,8) DEFAULT 0.01,
        max_fee DECIMAL(20,8) DEFAULT 10.00,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW()
    );

    -- Insert default fee rules
    INSERT INTO fee_rules (transaction_type, fee_percent, min_fee, max_fee)
    SELECT 'internal_transfer', 2.5, 0.01, 10.00
    WHERE NOT EXISTS (SELECT 1 FROM fee_rules WHERE transaction_type = 'internal_transfer');
    
    INSERT INTO fee_rules (transaction_type, fee_percent, min_fee, max_fee)
    SELECT 'external_send', 3.0, 0.05, 15.00
    WHERE NOT EXISTS (SELECT 1 FROM fee_rules WHERE transaction_type = 'external_send');
    
    INSERT INTO fee_rules (transaction_type, fee_percent, min_fee, max_fee)
    SELECT 'withdrawal', 1.5, 0.02, 5.00
    WHERE NOT EXISTS (SELECT 1 FROM fee_rules WHERE transaction_type = 'withdrawal');
  `;
  
  try {
    await db.query(createTables);
    console.log('✅ Database tables initialized');
  } catch (error) {
    console.error('❌ Database init error:', error.message);
  }
}

// ========================================
// HELPER FUNCTIONS
// ========================================
function calculateFee(amount, feePercent, minFee, maxFee) {
  let fee = (amount * feePercent) / 100;
  if (fee < minFee) fee = minFee;
  if (fee > maxFee) fee = maxFee;
  return parseFloat(fee.toFixed(8));
}

// ========================================
// AUTH ROUTES
// ========================================
app.post('/api/auth/register', async (req, res) => {
  const { email, password, full_name, phone_number } = req.body;
  
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }
  
  try {
    // Check if user exists
    const existing = await db.query('SELECT * FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'Email already registered' });
    }
    
    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);
    const userId = uuidv4();
    
    // Create user
    await db.query(
      `INSERT INTO users (id, email, hashed_password, full_name, phone_number, balance, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
      [userId, email, hashedPassword, full_name || email.split('@')[0], phone_number || null, 0]
    );
    
    // Generate token
    const token = jwt.sign({ id: userId, email }, process.env.JWT_SECRET || 'temp_secret', { expiresIn: '7d' });
    
    res.status(201).json({
      success: true,
      user: { id: userId, email, full_name: full_name || email.split('@')[0] },
      token,
      balance: 0
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }
  
  try {
    const result = await db.query('SELECT * FROM users WHERE email = $1', [email]);
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    const user = result.rows[0];
    const validPassword = await bcrypt.compare(password, user.hashed_password);
    
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    const token = jwt.sign(
      { id: user.id, email: user.email },
      process.env.JWT_SECRET || 'temp_secret',
      { expiresIn: '7d' }
    );
    
    res.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        full_name: user.full_name,
        phone_number: user.phone_number
      },
      token,
      balance: parseFloat(user.balance)
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ========================================
// MIDDLEWARE: Verify Token
// ========================================
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }
  
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'temp_secret');
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(403).json({ error: 'Invalid or expired token' });
  }
}

// ========================================
// WALLET ROUTES
// ========================================
app.get('/api/wallet/balance', authenticateToken, async (req, res) => {
  try {
    const result = await db.query('SELECT balance FROM users WHERE id = $1', [req.user.id]);
    res.json({
      success: true,
      balance: parseFloat(result.rows[0]?.balance || 0),
      currency: 'USD'
    });
  } catch (error) {
    console.error('Balance error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/wallet/deposit', authenticateToken, async (req, res) => {
  const { amount } = req.body;
  
  if (!amount || amount <= 0) {
    return res.status(400).json({ error: 'Valid amount required' });
  }
  
  try {
    await db.query(
      'UPDATE users SET balance = balance + $1, updated_at = NOW() WHERE id = $2',
      [amount, req.user.id]
    );
    
    const result = await db.query('SELECT balance FROM users WHERE id = $1', [req.user.id]);
    
    // Record transaction
    await db.query(
      `INSERT INTO transactions (id, receiver_id, amount, type, status, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())`,
      [uuidv4(), req.user.id, amount, 'deposit', 'completed']
    );
    
    res.json({
      success: true,
      new_balance: parseFloat(result.rows[0].balance),
      message: `$${amount} added successfully`
    });
  } catch (error) {
    console.error('Deposit error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ========================================
// FEE ROUTES
// ========================================
app.get('/api/fees/rates', async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM fee_rules WHERE is_active = true');
    res.json({
      success: true,
      rates: result.rows
    });
  } catch (error) {
    console.error('Fee rates error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/fees/calculate', async (req, res) => {
  const { amount, transaction_type } = req.body;
  
  if (!amount || amount <= 0) {
    return res.status(400).json({ error: 'Valid amount required' });
  }
  
  try {
    const result = await db.query(
      'SELECT * FROM fee_rules WHERE transaction_type = $1 AND is_active = true',
      [transaction_type || 'internal_transfer']
    );
    
    let feePercent = 2.5, minFee = 0.01, maxFee = 10.00;
    
    if (result.rows.length > 0) {
      feePercent = parseFloat(result.rows[0].fee_percent);
      minFee = parseFloat(result.rows[0].min_fee);
      maxFee = parseFloat(result.rows[0].max_fee);
    }
    
    const feeAmount = calculateFee(amount, feePercent, minFee, maxFee);
    const netAmount = amount - feeAmount;
    
    res.json({
      success: true,
      original_amount: amount,
      fee_percent: feePercent,
      fee_amount: feeAmount,
      net_amount: netAmount,
      min_fee: minFee,
      max_fee: maxFee,
      currency: 'USD'
    });
  } catch (error) {
    console.error('Fee calculation error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ========================================
// TRANSFER ROUTES (with fee deduction)
// ========================================
app.post('/api/transfer/internal', authenticateToken, async (req, res) => {
  const { receiver_email, amount, note } = req.body;
  
  if (!receiver_email || !amount || amount <= 0) {
    return res.status(400).json({ error: 'Receiver email and valid amount required' });
  }
  
  const client = await db.connect();
  
  try {
    await client.query('BEGIN');
    
    // Get sender
    const senderResult = await client.query('SELECT * FROM users WHERE id = $1 FOR UPDATE', [req.user.id]);
    const sender = senderResult.rows[0];
    
    if (!sender) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Sender not found' });
    }
    
    // Get receiver
    const receiverResult = await client.query('SELECT * FROM users WHERE email = $1 FOR UPDATE', [receiver_email]);
    const receiver = receiverResult.rows[0];
    
    if (!receiver) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Receiver not found' });
    }
    
    // Check balance
    if (parseFloat(sender.balance) < amount) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Insufficient balance' });
    }
    
    // Get fee rate
    const feeResult = await client.query(
      'SELECT * FROM fee_rules WHERE transaction_type = $1 AND is_active = true',
      ['internal_transfer']
    );
    
    let feePercent = 2.5, minFee = 0.01, maxFee = 10.00;
    if (feeResult.rows.length > 0) {
      feePercent = parseFloat(feeResult.rows[0].fee_percent);
      minFee = parseFloat(feeResult.rows[0].min_fee);
      maxFee = parseFloat(feeResult.rows[0].max_fee);
    }
    
    const feeAmount = calculateFee(amount, feePercent, minFee, maxFee);
    const netAmount = amount - feeAmount;
    
    // Update sender balance (deduct full amount)
    await client.query(
      'UPDATE users SET balance = balance - $1, updated_at = NOW() WHERE id = $2',
      [amount, req.user.id]
    );
    
    // Update receiver balance (add net amount after fee)
    await client.query(
      'UPDATE users SET balance = balance + $1, updated_at = NOW() WHERE id = $2',
      [netAmount, receiver.id]
    );
    
    // Record main transaction
    const transactionId = uuidv4();
    await client.query(
      `INSERT INTO transactions (id, sender_id, receiver_id, amount, type, status, fee_amount, metadata, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
      [transactionId, req.user.id, receiver.id, amount, 'internal_transfer', 'completed', feeAmount, JSON.stringify({ note, net_amount: netAmount, fee_percent: feePercent })]
    );
    
    await client.query('COMMIT');
    
    // Get new balances
    const newSenderBalance = parseFloat(sender.balance) - amount;
    const newReceiverBalance = parseFloat(receiver.balance) + netAmount;
    
    res.json({
      success: true,
      transaction_id: transactionId,
      amount_sent: amount,
      fee_amount: feeAmount,
      amount_received: netAmount,
      fee_percent: feePercent,
      sender_new_balance: newSenderBalance,
      receiver_new_balance: newReceiverBalance,
      receiver_name: receiver.full_name,
      receiver_email: receiver.email,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Transfer error:', error);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// ========================================
// TRANSACTION HISTORY
// ========================================
app.get('/api/transactions/history', authenticateToken, async (req, res) => {
  const { limit = 50, offset = 0 } = req.query;
  
  try {
    const result = await db.query(
      `SELECT t.*, 
        u1.full_name as sender_name, u2.full_name as receiver_name
       FROM transactions t
       LEFT JOIN users u1 ON t.sender_id = u1.id
       LEFT JOIN users u2 ON t.receiver_id = u2.id
       WHERE t.sender_id = $1 OR t.receiver_id = $1
       ORDER BY t.created_at DESC
       LIMIT $2 OFFSET $3`,
      [req.user.id, parseInt(limit), parseInt(offset)]
    );
    
    res.json({
      success: true,
      transactions: result.rows.map(t => ({
        ...t,
        amount: parseFloat(t.amount),
        fee_amount: parseFloat(t.fee_amount || 0)
      })),
      count: result.rows.length
    });
  } catch (error) {
    console.error('History error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ========================================
// START SERVER
// ========================================
async function startServer() {
  await initDatabase();
  
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`========================================`);
    console.log(`🚀 Money System API Running`);
    console.log(`========================================`);
    console.log(`📍 Port: ${PORT}`);
    console.log(`📍 Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`💰 Default Fee: ${process.env.DEFAULT_FEE_PERCENT || 2.5}%`);
    console.log(`========================================`);
    console.log(`📋 Available Endpoints:`);
    console.log(`   GET  /health - Health check`);
    console.log(`   POST /api/auth/register - Register user`);
    console.log(`   POST /api/auth/login - Login user`);
    console.log(`   GET  /api/wallet/balance - Get balance`);
    console.log(`   POST /api/wallet/deposit - Add funds`);
    console.log(`   POST /api/transfer/internal - Send money (with fee)`);
    console.log(`   GET  /api/transactions/history - Transaction history`);
    console.log(`   GET  /api/fees/rates - Get fee rates`);
    console.log(`   POST /api/fees/calculate - Calculate fee`);
    console.log(`========================================`);
  });
}

startServer().catch(console.error);

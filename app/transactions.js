const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const { authenticateToken } = require('./middleware/auth');
const { User, Wallet, Transaction } = require('./models');
const { calculateTransactionFee, applyTransactionFee } = require('./fees');

// Internal transfer (with fee deduction)
router.post('/internal',
  authenticateToken,
  body('receiverEmail').isEmail().withMessage('Valid receiver email required'),
  body('amount').isFloat({ min: 0.01 }).withMessage('Amount must be at least 0.01'),
  body('currency').isLength({ min: 3, max: 3 }).withMessage('Valid currency code required'),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    
    const { receiverEmail, amount, currency, note } = req.body;
    const senderId = req.user.id;
    
    const client = await global.db.connect();
    
    try {
      await client.query('BEGIN');
      
      // Get receiver
      const receiver = await User.findByEmail(receiverEmail);
      if (!receiver) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Receiver not found' });
      }
      
      // Get sender's wallet
      let senderWallet = await Wallet.getOrCreate(senderId, currency);
      senderWallet = await client.query(
        'SELECT * FROM wallets WHERE id = $1 FOR UPDATE',
        [senderWallet.id]
      );
      senderWallet = senderWallet.rows[0];
      
      if (parseFloat(senderWallet.balance) < amount) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Insufficient balance' });
      }
      
      // Calculate fee
      const feeInfo = await calculateTransactionFee(amount, 'internal_transfer');
      
      // Check if sender has enough for amount + fee? No, fee is deducted from amount
      // The sender sends 'amount', receiver gets 'netAmount'
      const netAmount = feeInfo.netAmount;
      const feeAmount = feeInfo.feeAmount;
      
      // Get or create receiver's wallet
      let receiverWallet = await Wallet.getOrCreate(receiver.id, currency);
      receiverWallet = await client.query(
        'SELECT * FROM wallets WHERE id = $1 FOR UPDATE',
        [receiverWallet.id]
      );
      receiverWallet = receiverWallet.rows[0];
      
      // Get platform wallet
      const platformUserId = process.env.PLATFORM_USER_ID;
      let platformWallet = await client.query(
        'SELECT * FROM wallets WHERE user_id = $1 AND currency = $2 FOR UPDATE',
        [platformUserId, currency]
      );
      
      if (platformWallet.rows.length === 0) {
        const { v4: uuidv4 } = require('uuid');
        await client.query(
          `INSERT INTO wallets (id, user_id, currency, balance, version, created_at)
           VALUES ($1, $2, $3, $4, $5, NOW())`,
          [uuidv4(), platformUserId, currency, '0', 1]
        );
        platformWallet = await client.query(
          'SELECT * FROM wallets WHERE user_id = $1 AND currency = $2 FOR UPDATE',
          [platformUserId, currency]
        );
      }
      platformWallet = platformWallet.rows[0];
      
      // Update balances
      await client.query(
        `UPDATE wallets 
         SET balance = balance - $3, version = version + 1, updated_at = NOW()
         WHERE id = $1 AND version = $2`,
        [senderWallet.id, senderWallet.version, amount]
      );
      
      await client.query(
        `UPDATE wallets 
         SET balance = balance + $3, version = version + 1, updated_at = NOW()
         WHERE id = $1 AND version = $2`,
        [receiverWallet.id, receiverWallet.version, netAmount]
      );
      
      await client.query(
        `UPDATE wallets 
         SET balance = balance + $3, version = version + 1, updated_at = NOW()
         WHERE id = $1 AND version = $2`,
        [platformWallet.id, platformWallet.version, feeAmount]
      );
      
      // Create main transaction
      const transaction = await Transaction.create({
        senderId,
        receiverId: receiver.id,
        amount,
        currency,
        type: 'internal_transfer',
        status: 'completed',
        metadata: {
          fee: feeAmount,
          net_amount: netAmount,
          fee_percent: feeInfo.feePercent,
          note: note || null
        }
      });
      
      // Create fee transaction record
      await Transaction.create({
        senderId,
        receiverId: platformUserId,
        amount: feeAmount,
        currency,
        type: 'fee',
        status: 'completed',
        metadata: {
          original_transaction_id: transaction.id,
          fee_percent: feeInfo.feePercent
        }
      });
      
      await client.query('COMMIT');
      
      // Get updated balances
      const newSenderBalance = parseFloat(senderWallet.balance) - amount;
      const newReceiverBalance = parseFloat(receiverWallet.balance) + netAmount;
      
      res.json({
        success: true,
        transaction_id: transaction.id,
        amount_sent: amount,
        fee_amount: feeAmount,
        amount_received: netAmount,
        fee_percent: feeInfo.feePercent,
        sender_new_balance: newSenderBalance,
        receiver_new_balance: newReceiverBalance,
        currency,
        timestamp: new Date().toISOString()
      });
      
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Transfer error:', error);
      res.status(500).json({ error: 'Internal server error' });
    } finally {
      client.release();
    }
  }
);

// Get transaction history
router.get('/history', authenticateToken, async (req, res) => {
  const userId = req.user.id;
  const { limit = 50, offset = 0 } = req.query;
  
  try {
    const transactions = await global.db.query(
      `SELECT t.*, 
        u1.full_name as sender_name, u2.full_name as receiver_name
       FROM transactions t
       LEFT JOIN users u1 ON t.sender_id = u1.id
       LEFT JOIN users u2 ON t.receiver_id = u2.id
       WHERE t.sender_id = $1 OR t.receiver_id = $1
       ORDER BY t.created_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, parseInt(limit), parseInt(offset)]
    );
    
    res.json({
      success: true,
      transactions: transactions.rows,
      count: transactions.rows.length
    });
  } catch (error) {
    console.error('Error fetching history:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;

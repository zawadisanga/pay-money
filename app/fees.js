const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const { authenticateToken, requireAdmin } = require('./middleware/auth');
const { FeeRule } = require('./models');

/**
 * Calculate fee for a transaction
 * @param {number} amount - Transaction amount
 * @param {string} transactionType - internal_transfer, external_send, withdrawal
 * @param {string} country - Country code (optional)
 * @param {string} provider - Payment provider (optional)
 * @returns {Promise<{feeAmount: number, netAmount: number, feePercent: number}>}
 */
async function calculateTransactionFee(amount, transactionType, country = null, provider = null) {
  const feeConfig = await FeeRule.getFeePercentage(transactionType, country, provider);
  
  let feeAmount = (amount * feeConfig.percent) / 100;
  
  // Apply min/max limits
  if (feeAmount < feeConfig.minFee) {
    feeAmount = feeConfig.minFee;
  }
  if (feeAmount > feeConfig.maxFee) {
    feeAmount = feeConfig.maxFee;
  }
  
  // Round to 8 decimal places
  feeAmount = Math.round(feeAmount * 1e8) / 1e8;
  const netAmount = amount - feeAmount;
  
  return {
    feeAmount,
    netAmount,
    feePercent: feeConfig.percent,
    minFee: feeConfig.minFee,
    maxFee: feeConfig.maxFee
  };
}

/**
 * Apply fee to a transaction and credit platform wallet
 * @param {object} db - Database connection
 * @param {string} senderId - User sending money
 * @param {number} amount - Original amount
 * @param {number} feeAmount - Calculated fee
 * @param {string} currency - Currency code
 * @param {string} transactionId - Original transaction ID
 * @returns {Promise<object>} - Fee transaction record
 */
async function applyTransactionFee(db, senderId, amount, feeAmount, currency, transactionId) {
  // Get platform wallet
  const platformUserId = process.env.PLATFORM_USER_ID;
  
  let platformWallet = await db.query(
    'SELECT * FROM wallets WHERE user_id = $1 AND currency = $2',
    [platformUserId, currency]
  );
  
  if (platformWallet.rows.length === 0) {
    // Create platform wallet if not exists
    const walletId = require('uuid').v4();
    await db.query(
      `INSERT INTO wallets (id, user_id, currency, balance, version, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())`,
      [walletId, platformUserId, currency, '0', 1]
    );
    platformWallet = { rows: [{ id: walletId, balance: '0', version: 1 }] };
  }
  
  const wallet = platformWallet.rows[0];
  
  // Update platform wallet balance
  await db.query(
    `UPDATE wallets 
     SET balance = balance + $3, version = version + 1, updated_at = NOW()
     WHERE id = $1 AND version = $2`,
    [wallet.id, wallet.version, feeAmount]
  );
  
  // Record fee transaction
  const feeTransactionId = require('uuid').v4();
  await db.query(
    `INSERT INTO transactions (id, sender_id, receiver_id, amount, currency, type, status, metadata, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
    [feeTransactionId, senderId, platformUserId, feeAmount, currency, 'fee', 'completed', JSON.stringify({
      original_transaction_id: transactionId,
      fee_percent: (feeAmount / amount) * 100
    })]
  );
  
  return { feeTransactionId, platformWalletId: wallet.id };
}

// API Endpoints

// Get current fee rates
router.get('/rates', authenticateToken, async (req, res) => {
  try {
    const rates = {
      internal_transfer: await FeeRule.getFeePercentage('internal_transfer'),
      external_send: await FeeRule.getFeePercentage('external_send'),
      withdrawal: await FeeRule.getFeePercentage('withdrawal')
    };
    
    res.json({
      success: true,
      rates,
      currency: 'USD'
    });
  } catch (error) {
    console.error('Error fetching fee rates:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Calculate fee for a specific amount (preview)
router.post('/calculate',
  authenticateToken,
  body('amount').isFloat({ min: 0.01 }).withMessage('Amount must be at least 0.01'),
  body('transactionType').isIn(['internal_transfer', 'external_send', 'withdrawal']),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    
    const { amount, transactionType, country, provider } = req.body;
    
    try {
      const feeInfo = await calculateTransactionFee(amount, transactionType, country, provider);
      
      res.json({
        success: true,
        original_amount: amount,
        fee_amount: feeInfo.feeAmount,
        net_amount: feeInfo.netAmount,
        fee_percent: feeInfo.feePercent,
        min_fee: feeInfo.minFee,
        max_fee: feeInfo.maxFee,
        currency: 'USD'
      });
    } catch (error) {
      console.error('Error calculating fee:', error);
      res.status(500).json({ error: 'Failed to calculate fee' });
    }
  }
);

// Admin: Update fee rules
router.put('/rules/:transactionType',
  authenticateToken,
  requireAdmin,
  body('fee_percent').isFloat({ min: 0, max: 100 }).optional(),
  body('min_fee').isFloat({ min: 0 }).optional(),
  body('max_fee').isFloat({ min: 0 }).optional(),
  async (req, res) => {
    const { transactionType } = req.params;
    const { fee_percent, min_fee, max_fee, country_code, provider } = req.body;
    
    try {
      // Check if rule exists
      const existing = await global.db.query(
        'SELECT * FROM fee_rules WHERE transaction_type = $1 AND (country_code IS NOT DISTINCT FROM $2)',
        [transactionType, country_code || null]
      );
      
      if (existing.rows.length > 0) {
        // Update existing rule
        await global.db.query(
          `UPDATE fee_rules 
           SET fee_percent = COALESCE($1, fee_percent),
               min_fee = COALESCE($2, min_fee),
               max_fee = COALESCE($3, max_fee),
               updated_at = NOW()
           WHERE transaction_type = $4 AND (country_code IS NOT DISTINCT FROM $5)`,
          [fee_percent, min_fee, max_fee, transactionType, country_code || null]
        );
      } else {
        // Insert new rule
        await global.db.query(
          `INSERT INTO fee_rules (transaction_type, fee_percent, min_fee, max_fee, country_code, provider, is_active, priority)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [transactionType, fee_percent || 2.5, min_fee || 0.01, max_fee || 10, country_code || null, provider || null, true, 1]
        );
      }
      
      res.json({ success: true, message: 'Fee rule updated successfully' });
    } catch (error) {
      console.error('Error updating fee rule:', error);
      res.status(500).json({ error: 'Failed to update fee rule' });
    }
  }
);

module.exports = router;
module.exports.calculateTransactionFee = calculateTransactionFee;
module.exports.applyTransactionFee = applyTransactionFee;

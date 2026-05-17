const { v4: uuidv4 } = require('uuid');

class User {
  static async create({ email, passwordHash, fullName, phoneNumber }) {
    const id = uuidv4();
    const result = await global.db.query(
      `INSERT INTO users (id, email, hashed_password, full_name, phone_number, is_active, kyc_status, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
       RETURNING id, email, full_name, phone_number, is_active, kyc_status, created_at`,
      [id, email, passwordHash, fullName, phoneNumber, true, 'pending']
    );
    return result.rows[0];
  }

  static async findByEmail(email) {
    const result = await global.db.query(
      'SELECT * FROM users WHERE email = $1',
      [email]
    );
    return result.rows[0];
  }

  static async findById(id) {
    const result = await global.db.query(
      'SELECT * FROM users WHERE id = $1',
      [id]
    );
    return result.rows[0];
  }
}

class Wallet {
  static async getOrCreate(userId, currency = 'USD') {
    let wallet = await global.db.query(
      'SELECT * FROM wallets WHERE user_id = $1 AND currency = $2',
      [userId, currency]
    );
    
    if (wallet.rows.length === 0) {
      const id = uuidv4();
      await global.db.query(
        `INSERT INTO wallets (id, user_id, currency, balance, version, created_at)
         VALUES ($1, $2, $3, $4, $5, NOW())`,
        [id, userId, currency, '0', 1]
      );
      return { id, userId, currency, balance: '0', version: 1 };
    }
    
    return wallet.rows[0];
  }

  static async updateBalance(userId, currency, amountDelta, version) {
    const result = await global.db.query(
      `UPDATE wallets 
       SET balance = balance + $3, version = version + 1, updated_at = NOW()
       WHERE user_id = $1 AND currency = $2 AND version = $4
       RETURNING *`,
      [userId, currency, amountDelta, version]
    );
    return result.rows[0];
  }
}

class Transaction {
  static async create({ senderId, receiverId, amount, currency, type, status, externalRef, metadata }) {
    const id = uuidv4();
    const result = await global.db.query(
      `INSERT INTO transactions (id, sender_id, receiver_id, amount, currency, type, status, external_ref, metadata, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
       RETURNING *`,
      [id, senderId, receiverId, amount, currency, type, status, externalRef, JSON.stringify(metadata || {})]
    );
    return result.rows[0];
  }

  static async updateStatus(id, status, completedAt = null) {
    await global.db.query(
      `UPDATE transactions 
       SET status = $2, completed_at = COALESCE($3, completed_at)
       WHERE id = $1`,
      [id, status, completedAt || new Date().toISOString()]
    );
  }
}

class FeeRule {
  static async getFeePercentage(transactionType, country = null, provider = null) {
    let query = 'SELECT fee_percent, min_fee, max_fee FROM fee_rules WHERE transaction_type = $1 AND is_active = true';
    const params = [transactionType];
    
    if (country) {
      query += ' AND (country_code = $2 OR country_code IS NULL)';
      params.push(country);
    }
    
    query += ' ORDER BY priority DESC LIMIT 1';
    
    const result = await global.db.query(query, params);
    
    if (result.rows.length > 0) {
      return {
        percent: parseFloat(result.rows[0].fee_percent),
        minFee: parseFloat(result.rows[0].min_fee),
        maxFee: parseFloat(result.rows[0].max_fee)
      };
    }
    
    // Default fee
    return {
      percent: parseFloat(process.env.DEFAULT_FEE_PERCENT) || 2.5,
      minFee: parseFloat(process.env.MIN_FEE) || 0.01,
      maxFee: parseFloat(process.env.MAX_FEE) || 10.00
    };
  }
}

module.exports = { User, Wallet, Transaction, FeeRule };

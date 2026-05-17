const fs = require('fs');
const path = require('path');

async function initDatabase() {
  const initSql = fs.readFileSync(path.join(__dirname, '../../migrations/init.sql'), 'utf8');
  
  try {
    await global.db.query(initSql);
    console.log('✅ Database initialized successfully');
  } catch (error) {
    console.error('❌ Database initialization failed:', error.message);
    throw error;
  }
}

async function createPlatformUser() {
  const platformUserId = process.env.PLATFORM_USER_ID;
  
  // Check if platform user exists
  const result = await global.db.query(
    'SELECT * FROM users WHERE id = $1',
    [platformUserId]
  );
  
  if (result.rows.length === 0) {
    const { v4: uuidv4 } = require('uuid');
    const bcrypt = require('bcryptjs');
    const platformId = uuidv4();
    const hashedPassword = await bcrypt.hash(process.env.ADMIN_PASSWORD_HASH || 'platform_secure_password', 10);
    
    await global.db.query(
      `INSERT INTO users (id, email, hashed_password, full_name, is_active, kyc_status, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
      [platformId, 'platform@money.com', hashedPassword, 'Platform Revenue', true, 'verified']
    );
    
    // Update env variable
    process.env.PLATFORM_USER_ID = platformId;
    console.log(`✅ Platform user created with ID: ${platformId}`);
  } else {
    console.log('✅ Platform user already exists');
  }
}

module.exports = { initDatabase, createPlatformUser };

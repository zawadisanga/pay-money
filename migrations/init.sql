-- Users table
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    hashed_password VARCHAR(255) NOT NULL,
    full_name VARCHAR(255),
    phone_number VARCHAR(20),
    is_active BOOLEAN DEFAULT true,
    kyc_status VARCHAR(50) DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Wallets table
CREATE TABLE IF NOT EXISTS wallets (
    id UUID PRIMARY KEY,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    currency VARCHAR(3) NOT NULL,
    balance NUMERIC(20,8) DEFAULT 0,
    version INTEGER DEFAULT 1,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(user_id, currency)
);

-- Transactions table
CREATE TABLE IF NOT EXISTS transactions (
    id UUID PRIMARY KEY,
    sender_id UUID REFERENCES users(id),
    receiver_id UUID REFERENCES users(id),
    amount NUMERIC(20,8) NOT NULL,
    currency VARCHAR(3) NOT NULL,
    type VARCHAR(50) NOT NULL,
    status VARCHAR(50) DEFAULT 'pending',
    external_ref VARCHAR(255),
    metadata JSONB,
    created_at TIMESTAMP DEFAULT NOW(),
    completed_at TIMESTAMP
);

-- Fee rules table
CREATE TABLE IF NOT EXISTS fee_rules (
    id SERIAL PRIMARY KEY,
    transaction_type VARCHAR(50) NOT NULL,
    fee_percent NUMERIC(5,2) NOT NULL,
    min_fee NUMERIC(20,8) DEFAULT 0.01,
    max_fee NUMERIC(20,8) DEFAULT 10.00,
    country_code VARCHAR(2),
    provider VARCHAR(50),
    is_active BOOLEAN DEFAULT true,
    priority INTEGER DEFAULT 1,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Insert default fee rules
INSERT INTO fee_rules (transaction_type, fee_percent, min_fee, max_fee, priority) VALUES
('internal_transfer', 2.5, 0.01, 10.00, 1),
('external_send', 3.0, 0.05, 15.00, 1),
('withdrawal', 1.5, 0.02, 5.00, 1)
ON CONFLICT DO NOTHING;

-- License keys table
CREATE TABLE IF NOT EXISTS licenses (
    id UUID PRIMARY KEY,
    key VARCHAR(255) UNIQUE NOT NULL,
    encrypted_key VARCHAR(500) NOT NULL,
    is_active BOOLEAN DEFAULT true,
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_transactions_sender ON transactions(sender_id);
CREATE INDEX idx_transactions_receiver ON transactions(receiver_id);
CREATE INDEX idx_transactions_created ON transactions(created_at);
CREATE INDEX idx_wallets_user ON wallets(user_id);
CREATE INDEX idx_users_email ON users(email);

-- Platform revenue user (will be created by app)

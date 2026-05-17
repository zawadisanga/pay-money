-- Meza ya usanidi wa mfumo
CREATE TABLE system_config (
    id SERIAL PRIMARY KEY,
    key VARCHAR(100) UNIQUE NOT NULL,
    value TEXT NOT NULL,
    description TEXT
);

-- Weka asilimia ya ada (kwa mfano 2.5%)
INSERT INTO system_config (key, value, description) 
VALUES ('transaction_fee_percent', '2.5', 'Asilimia ya ada kwa kila muamala');

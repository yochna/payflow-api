CREATE TABLE merchants (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    api_key VARCHAR(64) UNIQUE NOT NULL,
    api_secret VARCHAR(64) NOT NULL,
    is_active BOOLEAN DEFAULT true,
    settlement_account VARCHAR(50),
    created_at TIMESTAMP DEFAULT NOW()
);

-- customers
CREATE TABLE customers(
    id SERIAL PRIMARY KEY,
    merchant_id INTEGER REFERENCES merchants(id) ON DELETE CASCADE,
    name VARCHAR(100),
    email VARCHAR(100),
    phone VARCHAR(15),
    created_at TIMESTAMP DEFAULT NOW()
);

-- payments
CREATE TABLE payments(
    id SERIAL PRIMARY KEY,
    merchant_id INTEGER REFERENCES merchants(id),
    customer_id INTEGER REFERENCES customers(id),
    idempotency_key VARCHAR(100) UNIQUE,
    amount DECIMAL(12,2) NOT NULL,
    currency VARCHAR(3) DEFAULT 'INR',
    status VARCHAR(20) CHECK(status IN('created','processing','captured','failed','refunded','partially_refunded')),
    failure_reason VARCHAR(255),
    payment_method VARCHAR(20) CHECK(payment_method IN ('upi','card','netbanking','wallet')),
    gateway_transaction_id VARCHAR(100),
    created_at TIMESTAMP DEFAULT NOW(),
    captured_at TIMESTAMP
);

-- settlements
CREATE TABLE settlements(
    id SERIAL PRIMARY KEY,
    payment_id INTEGER REFERENCES payments(id),
    merchant_id INTEGER REFERENCES merchants(id),
    gross_amount DECIMAL(12,2),
    platform_fee DECIMAL(12,2),
    tax_amount DECIMAL(12,2),
    net_amount DECIMAL(12,2),
    status VARCHAR(20) CHECK (status IN('pending', 'processing','settled','failed')),
    settled_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW()
);

-- refunds 
CREATE TABLE refunds(
    id SERIAL PRIMARY KEY,
    payment_id INTEGER REFERENCES payments(id),
    amount DECIMAL(12,2) NOT NULL,
    reason VARCHAR(255),
    status VARCHAR(20) CHECK (status IN('pending','processing','refunded','failure')),
    initiated_by VARCHAR(20) CHECK(initiated_by IN ('merchant','customer','admin')),
    craeted_at TIMESTAMP DEFAULT NOW(),
    processed_at TIMESTAMP
);

-- disputes
CREATE TABLE disputes(
    id SERIAL PRIMARY KEY,
    payment_id INTEGER REFERENCES payments(id),
    raised_by INTEGER REFERENCES customers(id),
    reason VARCHAR(255),
    status VARCHAR(20) CHECK (status IN('open','under_review','resolved','rejected')),
    resolution TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    resolved_at TIMESTAMP
);

CREATE TABLE webhook_events(
    id SERIAL PRIMARY KEY,
    merchant_id INTEGER REFERENCES merchants(id),
    event_type VARCHAR(50),
    payload JSONB,
    status VARCHAR(20) CHECK (status IN ('pending','delivered','failed')),
    attempts INTEGER DEFAULT 0,
    next_retry_at TIMESTAMP,
    delivered_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE audit_logs(
    id SERIAL PRIMARY KEY,
    entity_type VARCHAR(50),
    entity_id INTEGER,
    action VARCHAR(50),
    old_value JSONB,
    new_value JSONB,
    performed_by INTEGER,
    craeted_at TIMESTAMP DEFAULT NOW()
);
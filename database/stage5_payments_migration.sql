-- StudentNest Backend Stage 5 — Protected Payments & Transactions
-- Run AFTER Stage 1, Stage 2, Stage 3 and Stage 4 migrations.

CREATE TABLE IF NOT EXISTS provider_bank_accounts (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  provider_id INT UNSIGNED NOT NULL,
  bank_name VARCHAR(120) NOT NULL,
  account_name VARCHAR(160) NOT NULL,
  account_number VARCHAR(32) NOT NULL,
  bank_code VARCHAR(20) NULL,
  verification_status ENUM('pending','verified','rejected') NOT NULL DEFAULT 'pending',
  verification_note VARCHAR(500) NULL,
  verified_at DATETIME NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_bank_provider FOREIGN KEY (provider_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_bank_provider_status (provider_id, verification_status)
);

CREATE TABLE IF NOT EXISTS payment_transactions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  reference VARCHAR(80) NOT NULL UNIQUE,
  gateway VARCHAR(40) NOT NULL DEFAULT 'flutterwave',
  gateway_transaction_id VARCHAR(120) NULL,
  student_id INT UNSIGNED NOT NULL,
  provider_id INT UNSIGNED NOT NULL,
  property_id INT UNSIGNED NOT NULL,
  bank_account_id BIGINT UNSIGNED NULL,
  currency CHAR(3) NOT NULL DEFAULT 'NGN',
  rent_amount DECIMAL(14,2) NOT NULL,
  agent_fee DECIMAL(14,2) NOT NULL DEFAULT 0,
  service_fee DECIMAL(14,2) NOT NULL DEFAULT 0,
  security_deposit DECIMAL(14,2) NOT NULL DEFAULT 0,
  total_amount DECIMAL(14,2) NOT NULL,
  gateway_fee DECIMAL(14,2) NOT NULL DEFAULT 0,
  status ENUM('pending_payment','payment_processing','funds_protected','inspection_pending','confirmed','released','disputed','refunded','failed','expired') NOT NULL DEFAULT 'pending_payment',
  payment_method VARCHAR(40) NULL,
  inspection_deadline DATETIME NULL,
  paid_at DATETIME NULL,
  confirmed_at DATETIME NULL,
  released_at DATETIME NULL,
  refunded_at DATETIME NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_tx_student FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_tx_provider FOREIGN KEY (provider_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_tx_property FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE RESTRICT,
  CONSTRAINT fk_tx_bank FOREIGN KEY (bank_account_id) REFERENCES provider_bank_accounts(id) ON DELETE SET NULL,
  INDEX idx_tx_student_status (student_id, status),
  INDEX idx_tx_provider_status (provider_id, status),
  INDEX idx_tx_property_status (property_id, status),
  INDEX idx_tx_deadline (inspection_deadline, status)
);

CREATE TABLE IF NOT EXISTS payment_events (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  transaction_id BIGINT UNSIGNED NULL,
  gateway VARCHAR(40) NOT NULL,
  gateway_event_id VARCHAR(150) NULL,
  event_type VARCHAR(100) NOT NULL,
  payload JSON NULL,
  processed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_gateway_event (gateway, gateway_event_id),
  CONSTRAINT fk_event_transaction FOREIGN KEY (transaction_id) REFERENCES payment_transactions(id) ON DELETE SET NULL,
  INDEX idx_event_transaction (transaction_id, created_at)
);

CREATE TABLE IF NOT EXISTS payment_disputes (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  transaction_id BIGINT UNSIGNED NOT NULL,
  student_id INT UNSIGNED NOT NULL,
  reason VARCHAR(120) NOT NULL,
  description TEXT NOT NULL,
  evidence JSON NULL,
  status ENUM('open','investigating','resolved_refund','resolved_release','rejected') NOT NULL DEFAULT 'open',
  resolution_note TEXT NULL,
  resolved_by INT UNSIGNED NULL,
  resolved_at DATETIME NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_dispute_tx FOREIGN KEY (transaction_id) REFERENCES payment_transactions(id) ON DELETE CASCADE,
  CONSTRAINT fk_dispute_student FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_dispute_admin FOREIGN KEY (resolved_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_dispute_status (status, created_at)
);

CREATE TABLE IF NOT EXISTS payment_payouts (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  transaction_id BIGINT UNSIGNED NOT NULL,
  provider_id INT UNSIGNED NOT NULL,
  bank_account_id BIGINT UNSIGNED NULL,
  amount DECIMAL(14,2) NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'NGN',
  status ENUM('pending','processing','paid','failed','cancelled') NOT NULL DEFAULT 'pending',
  gateway_reference VARCHAR(120) NULL,
  paid_at DATETIME NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_payout_tx FOREIGN KEY (transaction_id) REFERENCES payment_transactions(id) ON DELETE CASCADE,
  CONSTRAINT fk_payout_provider FOREIGN KEY (provider_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_payout_bank FOREIGN KEY (bank_account_id) REFERENCES provider_bank_accounts(id) ON DELETE SET NULL,
  INDEX idx_payout_status (status, created_at)
);

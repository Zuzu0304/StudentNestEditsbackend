-- StudentNest Stage 18 — Student marketplace + protected marketplace payments
-- Run AFTER Stage 17. Safe to re-run.

CREATE TABLE IF NOT EXISTS student_payout_accounts (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  student_id INT UNSIGNED NOT NULL,
  bank_name VARCHAR(120) NOT NULL,
  account_name VARCHAR(160) NOT NULL,
  account_number VARCHAR(32) NOT NULL,
  bank_code VARCHAR(20) NULL,
  verification_status ENUM('pending','verified','rejected') NOT NULL DEFAULT 'pending',
  verification_note VARCHAR(500) NULL,
  verified_at DATETIME NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_student_payout_owner FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_student_payout_owner_status (student_id, verification_status)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS marketplace_items (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  seller_id INT UNSIGNED NOT NULL,
  title VARCHAR(200) NOT NULL,
  description TEXT NULL,
  category VARCHAR(80) NOT NULL,
  item_condition ENUM('new','used') NOT NULL DEFAULT 'used',
  price DECIMAL(14,2) NOT NULL,
  images JSON NULL,
  status ENUM('available','reserved','sold','hidden') NOT NULL DEFAULT 'available',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_market_item_seller FOREIGN KEY (seller_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_market_items_status (status, created_at),
  INDEX idx_market_items_seller (seller_id, status, created_at),
  INDEX idx_market_items_category (category, status)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS marketplace_orders (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  item_id BIGINT UNSIGNED NOT NULL,
  buyer_id INT UNSIGNED NOT NULL,
  seller_id INT UNSIGNED NOT NULL,
  amount DECIMAL(14,2) NOT NULL,
  status ENUM('pending_payment','paid','completed','cancelled','refunded') NOT NULL DEFAULT 'pending_payment',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_market_order_item FOREIGN KEY (item_id) REFERENCES marketplace_items(id) ON DELETE RESTRICT,
  CONSTRAINT fk_market_order_buyer FOREIGN KEY (buyer_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_market_order_seller FOREIGN KEY (seller_id) REFERENCES users(id) ON DELETE RESTRICT,
  INDEX idx_market_order_buyer (buyer_id, status, created_at),
  INDEX idx_market_order_seller (seller_id, status, created_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS marketplace_transactions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  reference VARCHAR(90) NOT NULL UNIQUE,
  gateway VARCHAR(40) NOT NULL DEFAULT 'mock',
  gateway_transaction_id VARCHAR(120) NULL,
  order_id BIGINT UNSIGNED NOT NULL,
  item_id BIGINT UNSIGNED NOT NULL,
  buyer_id INT UNSIGNED NOT NULL,
  seller_id INT UNSIGNED NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'NGN',
  total_amount DECIMAL(14,2) NOT NULL,
  commission_rate DECIMAL(5,2) NOT NULL DEFAULT 5.00,
  platform_commission_amount DECIMAL(14,2) NULL,
  seller_payout_amount DECIMAL(14,2) NULL,
  payment_method VARCHAR(40) NULL,
  payer_channel VARCHAR(40) NULL,
  payer_account_name VARCHAR(160) NULL,
  payer_account_number VARCHAR(32) NULL,
  status ENUM('pending_payment','payment_processing','funds_protected','confirmed','released','disputed','refunded','failed','expired') NOT NULL DEFAULT 'pending_payment',
  inspection_deadline DATETIME NULL,
  paid_at DATETIME NULL,
  confirmed_at DATETIME NULL,
  released_at DATETIME NULL,
  refunded_at DATETIME NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_market_tx_order FOREIGN KEY (order_id) REFERENCES marketplace_orders(id) ON DELETE CASCADE,
  CONSTRAINT fk_market_tx_item FOREIGN KEY (item_id) REFERENCES marketplace_items(id) ON DELETE RESTRICT,
  CONSTRAINT fk_market_tx_buyer FOREIGN KEY (buyer_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_market_tx_seller FOREIGN KEY (seller_id) REFERENCES users(id) ON DELETE RESTRICT,
  INDEX idx_market_tx_buyer_status (buyer_id, status, created_at),
  INDEX idx_market_tx_seller_status (seller_id, status, created_at),
  INDEX idx_market_tx_item_status (item_id, status),
  INDEX idx_market_tx_deadline (inspection_deadline, status)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS marketplace_disputes (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  transaction_id BIGINT UNSIGNED NOT NULL,
  item_id BIGINT UNSIGNED NOT NULL,
  buyer_id INT UNSIGNED NOT NULL,
  agent_id INT UNSIGNED NULL,
  reason VARCHAR(120) NOT NULL,
  description TEXT NOT NULL,
  evidence JSON NULL,
  status ENUM('open','investigating','resolved_refund','resolved_release','rejected') NOT NULL DEFAULT 'open',
  agent_result ENUM('pending','found','not_found') NOT NULL DEFAULT 'pending',
  agent_report TEXT NULL,
  resolution_note TEXT NULL,
  assigned_at DATETIME NULL,
  investigated_at DATETIME NULL,
  resolved_by INT UNSIGNED NULL,
  resolved_at DATETIME NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_market_dispute_tx FOREIGN KEY (transaction_id) REFERENCES marketplace_transactions(id) ON DELETE CASCADE,
  CONSTRAINT fk_market_dispute_item FOREIGN KEY (item_id) REFERENCES marketplace_items(id) ON DELETE RESTRICT,
  CONSTRAINT fk_market_dispute_buyer FOREIGN KEY (buyer_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_market_dispute_agent FOREIGN KEY (agent_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_market_dispute_admin FOREIGN KEY (resolved_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_market_dispute_status (status, created_at),
  INDEX idx_market_dispute_agent (agent_id, status, created_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS marketplace_payouts (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  transaction_id BIGINT UNSIGNED NOT NULL,
  seller_id INT UNSIGNED NOT NULL,
  bank_account_id BIGINT UNSIGNED NULL,
  amount DECIMAL(14,2) NOT NULL,
  commission_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
  gross_amount DECIMAL(14,2) NULL,
  currency CHAR(3) NOT NULL DEFAULT 'NGN',
  status ENUM('pending','processing','paid','failed','cancelled') NOT NULL DEFAULT 'pending',
  gateway_reference VARCHAR(120) NULL,
  paid_at DATETIME NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_market_payout_tx FOREIGN KEY (transaction_id) REFERENCES marketplace_transactions(id) ON DELETE CASCADE,
  CONSTRAINT fk_market_payout_seller FOREIGN KEY (seller_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_market_payout_bank FOREIGN KEY (bank_account_id) REFERENCES student_payout_accounts(id) ON DELETE SET NULL,
  INDEX idx_market_payout_status (status, created_at)
) ENGINE=InnoDB;

INSERT INTO database_migrations (name)
SELECT 'stage18_marketplace_migration'
WHERE NOT EXISTS (SELECT 1 FROM database_migrations WHERE name='stage18_marketplace_migration');

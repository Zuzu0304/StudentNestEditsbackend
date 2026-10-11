-- StudentNest Backend Stage 6: Booking / Rental Request workflow
-- Run against the existing studentnest database after Stage 5.

CREATE TABLE IF NOT EXISTS booking_requests (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  student_id INT UNSIGNED NOT NULL,
  provider_id INT UNSIGNED NOT NULL,
  property_id INT UNSIGNED NOT NULL,
  payment_transaction_id INT UNSIGNED NULL,
  start_date DATE NOT NULL,
  end_date DATE NULL,
  rent_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  agent_fee DECIMAL(12,2) NOT NULL DEFAULT 0,
  service_fee DECIMAL(12,2) NOT NULL DEFAULT 0,
  security_deposit DECIMAL(12,2) NOT NULL DEFAULT 0,
  total_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  message TEXT NULL,
  status ENUM('pending_provider','approved','rejected','payment_pending','paid','active','cancelled','completed') NOT NULL DEFAULT 'pending_provider',
  provider_response TEXT NULL,
  requested_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  responded_at TIMESTAMP NULL DEFAULT NULL,
  cancelled_at TIMESTAMP NULL DEFAULT NULL,
  activated_at TIMESTAMP NULL DEFAULT NULL,
  completed_at TIMESTAMP NULL DEFAULT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_booking_student (student_id, status),
  KEY idx_booking_provider (provider_id, status),
  KEY idx_booking_property (property_id, status),
  KEY idx_booking_dates (property_id, start_date, end_date),
  KEY idx_booking_payment (payment_transaction_id),
  CONSTRAINT fk_booking_student FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_booking_provider FOREIGN KEY (provider_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_booking_property FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE RESTRICT,
  CONSTRAINT fk_booking_payment FOREIGN KEY (payment_transaction_id) REFERENCES payment_transactions(id) ON DELETE SET NULL
) ENGINE=InnoDB;

INSERT INTO database_migrations (name)
SELECT 'stage6_booking_migration'
WHERE NOT EXISTS (SELECT 1 FROM database_migrations WHERE name='stage6_booking_migration');

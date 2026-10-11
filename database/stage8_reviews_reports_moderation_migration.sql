-- StudentNest Backend Stage 8 — Reviews, Reports, Moderation & Audit Logs
-- Run after Stage 7 against the existing studentnest database.

CREATE TABLE IF NOT EXISTS property_reviews (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  property_id INT UNSIGNED NOT NULL,
  student_id INT UNSIGNED NOT NULL,
  booking_id INT UNSIGNED NULL,
  rating TINYINT UNSIGNED NOT NULL,
  title VARCHAR(160) NULL,
  comment TEXT NULL,
  status ENUM('pending','published','hidden','removed') NOT NULL DEFAULT 'pending',
  moderated_by INT UNSIGNED NULL,
  moderated_at DATETIME NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT chk_review_rating CHECK (rating BETWEEN 1 AND 5),
  CONSTRAINT fk_review_property FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE CASCADE,
  CONSTRAINT fk_review_student FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_review_booking FOREIGN KEY (booking_id) REFERENCES booking_requests(id) ON DELETE SET NULL,
  CONSTRAINT fk_review_moderator FOREIGN KEY (moderated_by) REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE KEY uq_review_student_booking (student_id, booking_id),
  INDEX idx_review_property_status (property_id, status, created_at),
  INDEX idx_review_student (student_id, created_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS platform_reports (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  reporter_id INT UNSIGNED NOT NULL,
  target_type ENUM('property','user','review','message','booking','payment') NOT NULL,
  target_id BIGINT UNSIGNED NOT NULL,
  reason VARCHAR(120) NOT NULL,
  description TEXT NOT NULL,
  evidence JSON NULL,
  status ENUM('open','investigating','resolved','dismissed') NOT NULL DEFAULT 'open',
  priority ENUM('low','normal','high','urgent') NOT NULL DEFAULT 'normal',
  resolution_note TEXT NULL,
  resolved_by INT UNSIGNED NULL,
  resolved_at DATETIME NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_report_reporter FOREIGN KEY (reporter_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_report_resolver FOREIGN KEY (resolved_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_report_status_priority (status, priority, created_at),
  INDEX idx_report_target (target_type, target_id),
  INDEX idx_report_reporter (reporter_id, created_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  actor_id INT UNSIGNED NULL,
  action VARCHAR(120) NOT NULL,
  entity_type VARCHAR(80) NOT NULL,
  entity_id BIGINT UNSIGNED NULL,
  details JSON NULL,
  ip_address VARCHAR(45) NULL,
  user_agent VARCHAR(500) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_audit_actor FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_audit_entity (entity_type, entity_id, created_at),
  INDEX idx_audit_actor (actor_id, created_at),
  INDEX idx_audit_action (action, created_at)
) ENGINE=InnoDB;

INSERT INTO database_migrations (name)
SELECT 'stage8_reviews_reports_moderation_migration'
WHERE NOT EXISTS (SELECT 1 FROM database_migrations WHERE name='stage8_reviews_reports_moderation_migration');

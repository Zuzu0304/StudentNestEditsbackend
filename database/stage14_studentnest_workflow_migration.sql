-- StudentNest Stage 14 — unified student inquiries, appointment confirmation,
-- student-post media, takeover rent details and payment-dispute investigations.
-- Run after Stage 13. Each ALTER is guarded so the migration can be rerun safely.

-- Roommate/takeover posts can carry images and walkthrough videos.
SET @c = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='roommate_listings' AND COLUMN_NAME='media');
SET @sql = IF(@c=0, 'ALTER TABLE roommate_listings ADD COLUMN media JSON NULL AFTER description', 'SELECT 1'); PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @c = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='takeover_listings' AND COLUMN_NAME='months_left');
SET @sql = IF(@c=0, 'ALTER TABLE takeover_listings ADD COLUMN months_left INT UNSIGNED NULL AFTER price', 'SELECT 1'); PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
SET @c = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='takeover_listings' AND COLUMN_NAME='amount_required');
SET @sql = IF(@c=0, 'ALTER TABLE takeover_listings ADD COLUMN amount_required DECIMAL(12,2) NULL AFTER months_left', 'SELECT 1'); PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
SET @c = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='takeover_listings' AND COLUMN_NAME='media');
SET @sql = IF(@c=0, 'ALTER TABLE takeover_listings ADD COLUMN media JSON NULL AFTER description', 'SELECT 1'); PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @c = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='roommate_interests' AND COLUMN_NAME='poster_response');
SET @sql = IF(@c=0, 'ALTER TABLE roommate_interests ADD COLUMN poster_response TEXT NULL AFTER phone', 'SELECT 1'); PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
SET @c = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='takeover_contacts' AND COLUMN_NAME='poster_response');
SET @sql = IF(@c=0, 'ALTER TABLE takeover_contacts ADD COLUMN poster_response TEXT NULL AFTER message', 'SELECT 1'); PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- Viewing requests now carry a provider-proposed appointment and link to the
-- booking that is created when the provider approves the request.
SET @c = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='inquiries' AND COLUMN_NAME='appointment_date');
SET @sql = IF(@c=0, 'ALTER TABLE inquiries ADD COLUMN appointment_date DATE NULL AFTER preferred_viewing_time', 'SELECT 1'); PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
SET @c = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='inquiries' AND COLUMN_NAME='appointment_time');
SET @sql = IF(@c=0, 'ALTER TABLE inquiries ADD COLUMN appointment_time TIME NULL AFTER appointment_date', 'SELECT 1'); PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
SET @c = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='inquiries' AND COLUMN_NAME='appointment_status');
SET @sql = IF(@c=0, "ALTER TABLE inquiries ADD COLUMN appointment_status ENUM('none','proposed','accepted','declined') NOT NULL DEFAULT 'none' AFTER provider_response", 'SELECT 1'); PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
SET @c = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='inquiries' AND COLUMN_NAME='booking_id');
SET @sql = IF(@c=0, 'ALTER TABLE inquiries ADD COLUMN booking_id INT UNSIGNED NULL AFTER appointment_status', 'SELECT 1'); PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
SET @c = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='inquiries' AND COLUMN_NAME='inquiry_type');
SET @sql = IF(@c=0, "ALTER TABLE inquiries ADD COLUMN inquiry_type ENUM('property_viewing','general') NOT NULL DEFAULT 'property_viewing' AFTER property_id", 'SELECT 1'); PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- A booking is only successful after the student accepts the provider's appointment.
SET @sql = "ALTER TABLE booking_requests MODIFY COLUMN status ENUM('pending_provider','pending_student_confirmation','approved','rejected','payment_pending','paid','active','cancelled','completed') NOT NULL DEFAULT 'pending_provider'";
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
SET @c = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='booking_requests' AND COLUMN_NAME='appointment_date');
SET @sql = IF(@c=0, 'ALTER TABLE booking_requests ADD COLUMN appointment_date DATE NULL AFTER end_date', 'SELECT 1'); PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
SET @c = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='booking_requests' AND COLUMN_NAME='appointment_time');
SET @sql = IF(@c=0, 'ALTER TABLE booking_requests ADD COLUMN appointment_time TIME NULL AFTER appointment_date', 'SELECT 1'); PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
SET @c = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='booking_requests' AND COLUMN_NAME='student_confirmed_at');
SET @sql = IF(@c=0, 'ALTER TABLE booking_requests ADD COLUMN student_confirmed_at DATETIME NULL AFTER responded_at', 'SELECT 1'); PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
SET @c = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='booking_requests' AND COLUMN_NAME='inquiry_id');
SET @sql = IF(@c=0, 'ALTER TABLE booking_requests ADD COLUMN inquiry_id INT UNSIGNED NULL AFTER payment_transaction_id', 'SELECT 1'); PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
CREATE INDEX IF NOT EXISTS idx_booking_appointment ON booking_requests(appointment_date, appointment_time, status);

-- Complaints are explicitly attached to the property and can be assigned to an
-- internal StudentNest inspection agent.
SET @c = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='payment_disputes' AND COLUMN_NAME='property_id');
SET @sql = IF(@c=0, 'ALTER TABLE payment_disputes ADD COLUMN property_id INT UNSIGNED NULL AFTER transaction_id', 'SELECT 1'); PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
UPDATE payment_disputes d JOIN payment_transactions t ON t.id=d.transaction_id SET d.property_id=t.property_id WHERE d.property_id IS NULL;

SET @c = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='payment_disputes' AND COLUMN_NAME='agent_id');
SET @sql = IF(@c=0, 'ALTER TABLE payment_disputes ADD COLUMN agent_id INT UNSIGNED NULL AFTER student_id', 'SELECT 1'); PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
SET @c = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='payment_disputes' AND COLUMN_NAME='agent_result');
SET @sql = IF(@c=0, "ALTER TABLE payment_disputes ADD COLUMN agent_result ENUM('pending','found','not_found') NOT NULL DEFAULT 'pending' AFTER agent_id", 'SELECT 1'); PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
SET @c = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='payment_disputes' AND COLUMN_NAME='agent_report');
SET @sql = IF(@c=0, 'ALTER TABLE payment_disputes ADD COLUMN agent_report TEXT NULL AFTER description', 'SELECT 1'); PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
SET @c = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='payment_disputes' AND COLUMN_NAME='assigned_at');
SET @sql = IF(@c=0, 'ALTER TABLE payment_disputes ADD COLUMN assigned_at DATETIME NULL AFTER agent_report', 'SELECT 1'); PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
SET @c = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='payment_disputes' AND COLUMN_NAME='investigated_at');
SET @sql = IF(@c=0, 'ALTER TABLE payment_disputes ADD COLUMN investigated_at DATETIME NULL AFTER assigned_at', 'SELECT 1'); PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
SET @c = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='payment_disputes' AND CONSTRAINT_NAME='fk_dispute_property');
SET @sql = IF(@c=0, 'ALTER TABLE payment_disputes ADD CONSTRAINT fk_dispute_property FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE SET NULL', 'SELECT 1'); PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
SET @c = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='payment_disputes' AND CONSTRAINT_NAME='fk_dispute_agent');
SET @sql = IF(@c=0, 'ALTER TABLE payment_disputes ADD CONSTRAINT fk_dispute_agent FOREIGN KEY (agent_id) REFERENCES users(id) ON DELETE SET NULL', 'SELECT 1'); PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
CREATE INDEX IF NOT EXISTS idx_dispute_agent_status ON payment_disputes(agent_id, status, created_at);

INSERT INTO database_migrations (name)
SELECT 'stage14_studentnest_workflow_migration'
WHERE NOT EXISTS (SELECT 1 FROM database_migrations WHERE name='stage14_studentnest_workflow_migration');

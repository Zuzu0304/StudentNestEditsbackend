-- Compatibility fix for older Stage 1 databases that used `migration` instead of `name`.
SET @has_migration = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='database_migrations' AND COLUMN_NAME='migration');
SET @has_name = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='database_migrations' AND COLUMN_NAME='name');
SET @sql = IF(@has_migration=1 AND @has_name=0, 'ALTER TABLE database_migrations CHANGE COLUMN migration name VARCHAR(255) NOT NULL', 'SELECT 1'); PREPARE s0 FROM @sql; EXECUTE s0; DEALLOCATE PREPARE s0;
-- StudentNest Stage 11: profiles, provider NIN documents and media metadata.
-- Run after Stage 10. Safe to run more than once.
SET @c = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='users' AND COLUMN_NAME='nin_number');
SET @sql = IF(@c=0, 'ALTER TABLE users ADD COLUMN nin_number VARCHAR(11) NULL AFTER institution', 'SELECT 1'); PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
SET @c = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='users' AND COLUMN_NAME='nin_front_image');
SET @sql = IF(@c=0, 'ALTER TABLE users ADD COLUMN nin_front_image VARCHAR(500) NULL AFTER nin_number', 'SELECT 1'); PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
SET @c = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='users' AND COLUMN_NAME='nin_back_image');
SET @sql = IF(@c=0, 'ALTER TABLE users ADD COLUMN nin_back_image VARCHAR(500) NULL AFTER nin_front_image', 'SELECT 1'); PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @c = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='payment_transactions' AND COLUMN_NAME='booking_id');
SET @sql = IF(@c=0, 'ALTER TABLE payment_transactions ADD COLUMN booking_id INT UNSIGNED NULL AFTER property_id', 'SELECT 1'); PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
SET @c = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='payment_transactions' AND CONSTRAINT_NAME='fk_tx_booking');
SET @sql = IF(@c=0, 'ALTER TABLE payment_transactions ADD CONSTRAINT fk_tx_booking FOREIGN KEY (booking_id) REFERENCES booking_requests(id) ON DELETE SET NULL', 'SELECT 1'); PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
CREATE INDEX IF NOT EXISTS idx_tx_booking ON payment_transactions(booking_id);

SET @c = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='inquiries' AND COLUMN_NAME='provider_response');
SET @sql = IF(@c=0, 'ALTER TABLE inquiries ADD COLUMN provider_response TEXT NULL AFTER message', 'SELECT 1'); PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- StudentNest Stage 13 — Viewing request details
-- Run after the existing migrations. Safe to run more than once.

SET @c = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='inquiries' AND COLUMN_NAME='preferred_viewing_date');
SET @sql = IF(@c=0, 'ALTER TABLE inquiries ADD COLUMN preferred_viewing_date DATE NULL AFTER message', 'SELECT 1'); PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @c = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='inquiries' AND COLUMN_NAME='preferred_viewing_time');
SET @sql = IF(@c=0, 'ALTER TABLE inquiries ADD COLUMN preferred_viewing_time TIME NULL AFTER preferred_viewing_date', 'SELECT 1'); PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

CREATE INDEX IF NOT EXISTS idx_inquiries_provider_status ON inquiries(provider_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_inquiries_student_status ON inquiries(student_id, status, created_at);

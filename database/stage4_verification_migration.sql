-- StudentNest Backend Stage 4 — Property Verification & Inspection
-- Run AFTER Stage 1, Stage 2 and Stage 3 migrations against the existing studentnest database.

-- Add the internal StudentNest field-agent role without allowing public registration.
SET @role_sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='users' AND COLUMN_NAME='role'
   AND COLUMN_TYPE NOT LIKE '%''agent''%') > 0,
  'ALTER TABLE users MODIFY COLUMN role ENUM(''student'',''provider'',''agent'',''admin'') NOT NULL DEFAULT ''student''',
  'SELECT 1'
);
PREPARE role_stmt FROM @role_sql;
EXECUTE role_stmt;
DEALLOCATE PREPARE role_stmt;

-- Track the verification lifecycle separately from public listing status.
SET @c = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='properties' AND COLUMN_NAME='verification_status');
SET @sql = IF(@c=0,
  "ALTER TABLE properties ADD COLUMN verification_status ENUM('not_submitted','pending_inspection','inspection_passed','inspection_failed') NOT NULL DEFAULT 'not_submitted' AFTER is_verified",
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @c = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='properties' AND COLUMN_NAME='verification_notes');
SET @sql = IF(@c=0,
  'ALTER TABLE properties ADD COLUMN verification_notes VARCHAR(1000) NULL AFTER verification_status',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @c = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='properties' AND COLUMN_NAME='verified_at');
SET @sql = IF(@c=0,
  'ALTER TABLE properties ADD COLUMN verified_at DATETIME NULL AFTER verification_notes',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

CREATE TABLE IF NOT EXISTS property_inspections (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    property_id INT UNSIGNED NOT NULL,
    agent_id INT UNSIGNED NULL,
    status ENUM('assigned','in_progress','completed','cancelled') NOT NULL DEFAULT 'assigned',
    result ENUM('pending','pass','fail') NOT NULL DEFAULT 'pending',
    location_verified BOOLEAN NOT NULL DEFAULT FALSE,
    property_exists BOOLEAN NOT NULL DEFAULT FALSE,
    amenities_verified BOOLEAN NOT NULL DEFAULT FALSE,
    photos_verified BOOLEAN NOT NULL DEFAULT FALSE,
    rent_verified BOOLEAN NOT NULL DEFAULT FALSE,
    availability_verified BOOLEAN NOT NULL DEFAULT FALSE,
    condition_verified BOOLEAN NOT NULL DEFAULT FALSE,
    notes TEXT NULL,
    evidence JSON NULL,
    inspected_at DATETIME NULL,
    submitted_at DATETIME NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_inspection_property FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE CASCADE,
    CONSTRAINT fk_inspection_agent FOREIGN KEY (agent_id) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_inspection_property (property_id),
    INDEX idx_inspection_agent_status (agent_id, status),
    INDEX idx_inspection_result (result)
);

CREATE TABLE IF NOT EXISTS inspection_activity (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    inspection_id BIGINT UNSIGNED NOT NULL,
    actor_id INT UNSIGNED NULL,
    action VARCHAR(80) NOT NULL,
    details TEXT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_activity_inspection FOREIGN KEY (inspection_id) REFERENCES property_inspections(id) ON DELETE CASCADE,
    CONSTRAINT fk_activity_actor FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_activity_inspection (inspection_id, created_at)
);

CREATE INDEX IF NOT EXISTS idx_properties_verification ON properties(verification_status, listing_status, is_verified);

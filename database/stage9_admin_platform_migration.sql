-- StudentNest Backend Stage 9 — Admin Dashboard & Platform Management
-- Run after Stage 8 against the existing studentnest database.

CREATE TABLE IF NOT EXISTS platform_settings (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  setting_key VARCHAR(100) NOT NULL UNIQUE,
  setting_value TEXT NULL,
  is_public BOOLEAN NOT NULL DEFAULT FALSE,
  updated_by INT UNSIGNED NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_setting_updater FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

INSERT INTO platform_settings (setting_key, setting_value, is_public) VALUES
('studentnest_service_fee_percent','2.5',FALSE),
('inspection_window_days','7',FALSE),
('platform_name','StudentNest',TRUE),
('support_email','',TRUE)
ON DUPLICATE KEY UPDATE setting_key=VALUES(setting_key);

INSERT INTO database_migrations (name)
SELECT 'stage9_admin_platform_migration'
WHERE NOT EXISTS (SELECT 1 FROM database_migrations WHERE name='stage9_admin_platform_migration');

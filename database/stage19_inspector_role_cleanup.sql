-- StudentNest Stage 19 — rename internal field-agent role to inspector.
-- Converts existing internal users from role=agent to role=inspector.
-- Database assignment columns such as agent_id are intentionally retained for
-- compatibility with existing inspection/payment records.

ALTER TABLE users MODIFY COLUMN role ENUM('student','provider','agent','inspector','admin') NOT NULL DEFAULT 'student';
UPDATE users SET role='inspector' WHERE role='agent';
ALTER TABLE users MODIFY COLUMN role ENUM('student','provider','inspector','admin') NOT NULL DEFAULT 'student';

INSERT INTO database_migrations (name)
SELECT 'stage19_inspector_role_cleanup'
WHERE NOT EXISTS (SELECT 1 FROM database_migrations WHERE name='stage19_inspector_role_cleanup');

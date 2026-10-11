-- StudentNest Backend Stage 12 — Roommate Finder & Takeover postings
-- Run after Stage 11 against the existing studentnest database.
-- Lets students post their own roommate-wanted / lease-takeover listings
-- (instead of only browsing the seeded examples) and lets other students
-- express interest / make contact, which notifies the poster.

CREATE TABLE IF NOT EXISTS roommate_listings (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  student_id INT UNSIGNED NOT NULL,
  name VARCHAR(150) NOT NULL,
  level VARCHAR(40) NOT NULL,
  course VARCHAR(150) NOT NULL,
  area VARCHAR(100) NOT NULL,
  gender_preference ENUM('male','female','any') NOT NULL DEFAULT 'any',
  traits JSON NULL,
  description TEXT NULL,
  rent DECIMAL(12,2) NOT NULL,
  split_cost DECIMAL(12,2) NOT NULL,
  duration VARCHAR(80) NOT NULL,
  status ENUM('active','closed') NOT NULL DEFAULT 'active',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_roommate_listing_student FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_roommate_listings_status (status, created_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS roommate_interests (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  listing_id INT UNSIGNED NOT NULL,
  student_id INT UNSIGNED NOT NULL,
  name VARCHAR(150) NOT NULL,
  level VARCHAR(40) NOT NULL,
  age INT UNSIGNED NOT NULL,
  phone VARCHAR(30) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_roommate_interest_listing FOREIGN KEY (listing_id) REFERENCES roommate_listings(id) ON DELETE CASCADE,
  CONSTRAINT fk_roommate_interest_student FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE KEY uq_roommate_interest (listing_id, student_id),
  INDEX idx_roommate_interests_listing (listing_id, created_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS takeover_listings (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  student_id INT UNSIGNED NOT NULL,
  title VARCHAR(200) NOT NULL,
  area VARCHAR(100) NOT NULL,
  price DECIMAL(12,2) NOT NULL,
  reason VARCHAR(200) NOT NULL,
  available_from VARCHAR(80) NOT NULL,
  description TEXT NULL,
  status ENUM('active','closed') NOT NULL DEFAULT 'active',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_takeover_listing_student FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_takeover_listings_status (status, created_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS takeover_contacts (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  listing_id INT UNSIGNED NOT NULL,
  student_id INT UNSIGNED NOT NULL,
  name VARCHAR(150) NOT NULL,
  phone VARCHAR(30) NOT NULL,
  message VARCHAR(500) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_takeover_contact_listing FOREIGN KEY (listing_id) REFERENCES takeover_listings(id) ON DELETE CASCADE,
  CONSTRAINT fk_takeover_contact_student FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE KEY uq_takeover_contact (listing_id, student_id),
  INDEX idx_takeover_contacts_listing (listing_id, created_at)
) ENGINE=InnoDB;

INSERT INTO database_migrations (name)
SELECT 'stage12_roommates_takeovers_migration'
WHERE NOT EXISTS (SELECT 1 FROM database_migrations WHERE name='stage12_roommates_takeovers_migration');

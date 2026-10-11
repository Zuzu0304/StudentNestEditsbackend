-- StudentNest Stage 17 — Unified chat + appointment scheduling
-- Safe to run after Stage 16. Existing student/provider conversations are copied
-- into the unified chat tables so the new chat UI can replace legacy inquiries.

CREATE TABLE IF NOT EXISTS chat_conversations (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  participant_one_id INT UNSIGNED NOT NULL,
  participant_two_id INT UNSIGNED NOT NULL,
  property_id INT UNSIGNED NULL,
  context_key VARCHAR(120) NULL,
  last_message_at DATETIME NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_chat_conv_p1 FOREIGN KEY (participant_one_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_chat_conv_p2 FOREIGN KEY (participant_two_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_chat_conv_property FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE SET NULL,
  INDEX idx_chat_conv_p1 (participant_one_id, updated_at),
  INDEX idx_chat_conv_p2 (participant_two_id, updated_at),
  INDEX idx_chat_conv_property (property_id, updated_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS chat_messages (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  conversation_id BIGINT UNSIGNED NOT NULL,
  sender_id INT UNSIGNED NOT NULL,
  body TEXT NOT NULL,
  read_at DATETIME NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_chat_message_conv FOREIGN KEY (conversation_id) REFERENCES chat_conversations(id) ON DELETE CASCADE,
  CONSTRAINT fk_chat_message_sender FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_chat_message_conv (conversation_id, created_at),
  INDEX idx_chat_message_sender (sender_id, created_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS chat_appointments (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  conversation_id BIGINT UNSIGNED NOT NULL,
  property_id INT UNSIGNED NULL,
  created_by INT UNSIGNED NOT NULL,
  scheduled_for DATETIME NOT NULL,
  status ENUM('proposed','accepted','declined','cancelled') NOT NULL DEFAULT 'proposed',
  note VARCHAR(500) NULL,
  responded_by INT UNSIGNED NULL,
  responded_at DATETIME NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_chat_appt_conv FOREIGN KEY (conversation_id) REFERENCES chat_conversations(id) ON DELETE CASCADE,
  CONSTRAINT fk_chat_appt_property FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE SET NULL,
  CONSTRAINT fk_chat_appt_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_chat_appt_responder FOREIGN KEY (responded_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_chat_appt_creator (created_by, status, scheduled_for),
  INDEX idx_chat_appt_property (property_id, scheduled_for),
  INDEX idx_chat_appt_conv (conversation_id, created_at)
) ENGINE=InnoDB;

-- Copy legacy student/provider conversations without deleting the old tables.
INSERT INTO chat_conversations (participant_one_id, participant_two_id, property_id, context_key, last_message_at, created_at, updated_at)
SELECT c.student_id, c.provider_id, c.property_id, 'property', c.last_message_at, c.created_at, c.updated_at
FROM conversations c
WHERE NOT EXISTS (
  SELECT 1 FROM chat_conversations x
  WHERE x.participant_one_id=c.student_id AND x.participant_two_id=c.provider_id
    AND x.property_id <=> c.property_id
);

INSERT INTO chat_messages (conversation_id, sender_id, body, read_at, created_at)
SELECT cc.id, m.sender_id, m.body, m.read_at, m.created_at
FROM messages m
JOIN conversations c ON c.id=m.conversation_id
JOIN chat_conversations cc ON cc.participant_one_id=c.student_id AND cc.participant_two_id=c.provider_id AND cc.property_id <=> c.property_id
WHERE NOT EXISTS (
  SELECT 1 FROM chat_messages cm WHERE cm.conversation_id=cc.id AND cm.sender_id=m.sender_id AND cm.body=m.body AND cm.created_at=m.created_at
);

INSERT INTO database_migrations (name)
SELECT 'stage17_chat_and_appointments_migration'
WHERE NOT EXISTS (SELECT 1 FROM database_migrations WHERE name='stage17_chat_and_appointments_migration');

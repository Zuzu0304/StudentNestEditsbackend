-- StudentNest Backend Stage 10 — final indexes and platform readiness
-- Run after Stage 9 against the existing studentnest database.

CREATE INDEX idx_users_role_active ON users(role, is_active, created_at);
CREATE INDEX idx_properties_status_city ON properties(listing_status, city, availability_status);
CREATE INDEX idx_properties_provider_status ON properties(provider_id, listing_status, updated_at);
CREATE INDEX idx_bookings_property_status_dates ON booking_requests(property_id, status, start_date, end_date);
CREATE INDEX idx_payments_status_created ON payment_transactions(status, created_at);
CREATE INDEX idx_notifications_user_read_created ON notifications(user_id, is_read, created_at);
CREATE INDEX idx_messages_conversation_created ON messages(conversation_id, created_at);

INSERT INTO database_migrations (name)
SELECT 'stage10_security_indexes_migration'
WHERE NOT EXISTS (SELECT 1 FROM database_migrations WHERE name='stage10_security_indexes_migration');

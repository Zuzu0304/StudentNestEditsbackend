-- StudentNest Backend Stage 16 — Platform commission split, payer account capture, reserved status
-- Run AFTER Stage 15.
-- Idempotent: safe to re-run (follows the same guarded-ALTER pattern as Stage 15).

-- 1. Platform commission bookkeeping on the transaction itself
SET @c = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='payment_transactions' AND COLUMN_NAME='commission_rate');
SET @sql = IF(@c=0, 'ALTER TABLE payment_transactions ADD COLUMN commission_rate DECIMAL(5,2) NOT NULL DEFAULT 5.00 AFTER total_amount', 'SELECT 1'); PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @c = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='payment_transactions' AND COLUMN_NAME='platform_commission_amount');
SET @sql = IF(@c=0, 'ALTER TABLE payment_transactions ADD COLUMN platform_commission_amount DECIMAL(14,2) NULL AFTER commission_rate', 'SELECT 1'); PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @c = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='payment_transactions' AND COLUMN_NAME='provider_payout_amount');
SET @sql = IF(@c=0, 'ALTER TABLE payment_transactions ADD COLUMN provider_payout_amount DECIMAL(14,2) NULL AFTER platform_commission_amount', 'SELECT 1'); PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @c = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='payment_transactions' AND COLUMN_NAME='payer_channel');
SET @sql = IF(@c=0, 'ALTER TABLE payment_transactions ADD COLUMN payer_channel VARCHAR(40) NULL AFTER payment_method', 'SELECT 1'); PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @c = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='payment_transactions' AND COLUMN_NAME='payer_account_name');
SET @sql = IF(@c=0, 'ALTER TABLE payment_transactions ADD COLUMN payer_account_name VARCHAR(160) NULL AFTER payer_channel', 'SELECT 1'); PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @c = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='payment_transactions' AND COLUMN_NAME='payer_account_number');
SET @sql = IF(@c=0, 'ALTER TABLE payment_transactions ADD COLUMN payer_account_number VARCHAR(32) NULL AFTER payer_account_name', 'SELECT 1'); PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- 2. payment_payouts needs to record the commission that was deducted, so
--    `amount` stays unambiguously the NET amount that actually goes to the provider.
SET @c = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='payment_payouts' AND COLUMN_NAME='commission_amount');
SET @sql = IF(@c=0, 'ALTER TABLE payment_payouts ADD COLUMN commission_amount DECIMAL(14,2) NOT NULL DEFAULT 0 AFTER amount', 'SELECT 1'); PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @c = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='payment_payouts' AND COLUMN_NAME='gross_amount');
SET @sql = IF(@c=0, 'ALTER TABLE payment_payouts ADD COLUMN gross_amount DECIMAL(14,2) NULL AFTER commission_amount', 'SELECT 1'); PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- 3. Properties need a "reserved" state distinct from "occupied":
--    reserved   = funds protected, student has not yet confirmed satisfaction
--    occupied   = student confirmed satisfaction (or admin released funds)
--    available  = open for booking (default, or restored after a refund)
ALTER TABLE properties MODIFY COLUMN availability_status ENUM('available','reserved','occupied','unavailable') NOT NULL DEFAULT 'available';

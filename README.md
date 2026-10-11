# StudentNest Backend

Node.js + Express + MySQL backend for StudentNest.

## Database setup
Run the database files in order against the `studentnest` database:

1. `database/schema.sql`
2. `database/stage2_auth_migration.sql`
3. `database/stage3_properties_migration.sql`
4. `database/stage4_verification_migration.sql`
5. `database/stage5_payments_migration.sql`
6. `database/stage6_booking_migration.sql`
7. `database/stage7_notifications_migration.sql`
8. `database/stage8_reviews_reports_moderation_migration.sql`
9. `database/stage9_admin_platform_migration.sql`
10. `database/stage10_security_indexes_migration.sql`
11. `database/stage11_profile_media_migration.sql`
12. `database/stage12_roommates_takeovers_migration.sql`
13. `database/stage13_viewing_requests_migration.sql`

Stage 13 adds preferred viewing date/time fields to student viewing requests and indexes provider/student inquiry lookups.

Keep `backend/.env` local and never commit secrets.
14. `database/stage14_studentnest_workflow_migration.sql`

Stage 14 adds student post media, takeover remaining-rent details, provider-proposed viewing appointments with student confirmation, booking appointment fields, and admin-assigned payment dispute investigations.

Stage 15 migration
Run `database/stage15_ui_workflow_fixes_migration.sql` after Stage 14. This adds the roommate-interest message field used by the poster inbox.

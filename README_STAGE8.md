# StudentNest Backend Stage 8 — Reviews, Reports & Platform Management

Run `database/stage8_reviews_reports_moderation_migration.sql` after Stage 7. Then run `npm install` and `npm run dev`.

New API areas:
- `/api/reviews`
- `/api/reports`
- `/api/moderation`

Admin moderation is protected by the backend `admin` role. Audit logs record moderation actions.

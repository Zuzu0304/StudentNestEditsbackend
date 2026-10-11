# StudentNest Backend Stage 10

Final integration, security and production-readiness foundation.

Changes include Helmet security headers, request IDs, JSON body limits, authentication rate limiting, safer CORS configuration, production-aware error responses, database indexes and an admin-only readiness/cleanup API.

Run `database/stage10_security_indexes_migration.sql` after Stage 9. Then run `npm install` and `npm run dev`.

Before production, set a strong JWT_SECRET, a production CLIENT_ORIGIN, real payment gateway credentials, HTTPS, and a real email provider. Do not use mock payment mode in production.

# StudentNest Backend — Stage 3: Properties & Listings

This stage adds provider property management and public accommodation browsing.

## Database
Run `database/stage3_properties_migration.sql` in phpMyAdmin against the existing `studentnest` database after Stage 1 and Stage 2 are already installed.

## Provider endpoints
- `GET /api/properties/provider/mine` — provider's listings
- `POST /api/properties` — create a draft
- `PUT /api/properties/:id` — edit a draft/rejected listing
- `DELETE /api/properties/:id` — delete a draft/rejected listing
- `POST /api/properties/:id/submit` — submit for StudentNest inspection/admin approval

All provider endpoints require a provider JWT.

## Public endpoints
- `GET /api/properties` — only approved, verified and available properties
- `GET /api/properties/:id` — approved/verified property details

## Important workflow
A provider never publishes directly. A new listing starts as `draft`. On submission it becomes `pending`; later stages will let StudentNest field agents inspect it and admins approve/reject it. Only an approved + verified + available property is returned to public browsing.

## Development notes
- `amenities` and `images` are stored as JSON arrays for this prototype.
- `total_cost` is calculated as rent + service charge + agent fee + security deposit.
- Payment processing is intentionally not implemented in Stage 3; it will use a licensed payment provider in a later protected-transaction stage.

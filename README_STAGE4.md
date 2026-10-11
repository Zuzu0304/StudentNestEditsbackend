# StudentNest Backend — Stage 4: Property Verification & Inspection

This stage adds the internal StudentNest property-verification workflow. It sits between provider submission and admin publication.

## Workflow
1. Provider creates a draft.
2. Provider submits it; the listing becomes `pending` and `verification_status=pending_inspection`.
3. An internal StudentNest field agent is assigned an inspection.
4. The agent visits the property and records a checklist plus evidence.
5. A passing inspection changes the verification state to `inspection_passed`; a failed inspection changes it to `inspection_failed`.
6. Admin reviews the inspection and makes the final approve/reject decision.
7. Only an approved + verified + available property is public.

## Important security rule
The public registration endpoint still accepts only `student` and `provider`. Admins create internal `agent` accounts from the protected admin API.

## New database structures
- `property_inspections`
- `inspection_activity`
- `properties.verification_status`
- `properties.verification_notes`
- `properties.verified_at`
- `users.role` now includes the internal `agent` role

## Main endpoints
### Agent/internal
- `GET /api/inspections/queue`
- `POST /api/inspections/:propertyId/assign`
- `GET /api/inspections/mine`
- `GET /api/inspections/:id`
- `POST /api/inspections/:id/submit`

### Admin
- `POST /api/admin/agents`
- `GET /api/admin/inspections`
- `GET /api/admin/properties/pending`
- `POST /api/admin/properties/:id/decision`

## Testing notes
Use test accounts and local MySQL only. Do not use real payment credentials or real financial transactions. Payment/protected transactions are a later stage.

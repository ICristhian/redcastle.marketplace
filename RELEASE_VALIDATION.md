# Redcastle Marketplace — Validation checklist (development)

Reviewed: 2026-11-24. This applies only to `feature/reservation-portal`; production `main` is unchanged. Do not merge PR #2 until critical tests are completed.

## Validated by user in Opera
- Google OAuth sign-in and profile display.
- Administrator access, stock editing and stock reflected in public catalog.
- Persistent personal cart across sign-out/sign-in.
- Retail visual style, side cart and product details.
- Reservation creates a code, launches WhatsApp, appears in customer history and administration.
- Image previews and metadata visible after upload (8 images for one test product).

## Implemented; awaiting visual confirmation
- Drag-and-drop reorder in Admin → Images; arrow buttons work as a keyboard/touch alternative.
- `reorder_product_images` RPC changes all image positions in one transaction, admin only.
- `unique(product_id,sort_order) DEFERRABLE INITIALLY DEFERRED` prevents duplicate positions.
- Delete renumbers positions. Insert appends; the first image becomes primary.
- Selecting image primary is independent of visual order.
- Replace/delete images and image recovery/error messages require further UI testing.
- Reordered gallery appears in public product detail after refreshing.

## SQL / operational checks
- Admin reordering exercised with transaction rollback: unique contiguous order maintained.
- Reorder under a non-admin identity denied in SQL test.
- Supabase Storage and image metadata: eight objects and eight linked records.
- Supabase expiry cron job exists and is active; actual timed expiry scenario remains untested.
- Supabase Security Advisor has an Auth leaked-password-protection warning; assess if email/password is ever enabled.

## Critical pending before production
- Two real accounts: prove customer A cannot read/modify customer B's cart, profile, or reservations; unauthenticated cannot mutate catalog.
- Concurrent reservations competing for last unit; same-user duplicate reserve requests.
- Pending reservation expiry after 24h and cron release; cancellation/fulfillment inventory effects.
- Validate the new visual reorder on Opera/mobile and refreshed public carousel.
- Verify Microsoft OAuth if Microsoft login will remain enabled; hide it if not configured.
- Complete product attribute editing (name, price, category, description), not merely stock and active state, if the admin requires this before launch.
- Mobile accessibility: buttons, drag alternatives, dialogs, gallery, drawer and focus behavior.
- Personal data retention and privacy policy, anti-abuse/rate limits, backup/restore, custom domain/branding, production secrets and OAuth callbacks.
- Verify image/media suitability: uploaded test screenshots and logos should be replaced with actual product photos before a real catalog launch.

## Important
- There is no online checkout or payment capture. Reservations are tentative stock holds; WhatsApp message sending requires a customer action.
- The current WhatsApp number is for development; do not persist personal numbers or secrets in source files.

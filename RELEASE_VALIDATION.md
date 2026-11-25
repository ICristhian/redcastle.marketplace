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
- Image primary change, metadata edit, atomic reorder, and delete normalization passed a database transaction that was rolled back afterward. Real Storage replace and UI interactions still require browser testing.

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
- Verify Google account switch using a second Google account in Opera. The portal now passes `prompt=select_account`, but real browser confirmation is pending. Google OAuth Testing mode may require adding the second address to Google Cloud → Audience → Test users.
- Verify Microsoft OAuth if Microsoft login will remain enabled; hide it if not configured.
- Product attribute editing (SKU, name, price, category, description) is implemented; real Opera confirmation pending. Database UUID remains immutable; existing reservations retain their snapshot prices and names.
- Mobile accessibility: buttons, drag alternatives, dialogs, gallery, drawer and focus behavior.
- Personal data retention and privacy policy, anti-abuse/rate limits, backup/restore, custom domain/branding, production secrets and OAuth callbacks.
- Verify image/media suitability: uploaded test screenshots and logos should be replaced with actual product photos before a real catalog launch.

## Important
- There is no online checkout or payment capture. Reservations are tentative stock holds; WhatsApp message sending requires a customer action.
- The current WhatsApp number is for development; do not persist personal numbers or secrets in source files.

## 2026-11-24 — Account switching and complete product editing

- Google sign-in includes `queryParams: { prompt: "select_account" }` to request Google's account chooser each time. This does not sign out of Google itself; testing with a second account remains necessary.
- Admin product editor accepts SKU, name, category, price and description; field validation and duplicate SKU handling included.
- Authenticated clients cannot update `products.id` or `created_at`; product UUID is a relational key that must remain stable. Security migration versioned at `20261124024859`.
- Database tests: admin product edit in rolled-back transaction succeeded, a non-admin simulated identity updated zero product rows, image ordering/primary/metadata/delete transaction passed and was rolled back.
- Admin UI and Google account chooser were covered by GitHub Actions static security assertions; browser-level acceptance remains open.

## 2026-11-24 — Admin UX, itemized reservations and SCD2 product snapshots

- Admin → Reservas now renders a per-item table (product name, original quantity, unit price at reservation, subtotal). Historical totals are not recalculated from the live catalog.
- Admin → Inventario removes competing inline Save/Edit actions. One **Editar** action opens a single product editor for SKU, name, category, description, price, stock and visibility; **Guardar producto** invokes `public.admin_update_product`.
- The database operation locks and validates the product and inventory, detects stale edits by timestamps, commits atomically and creates at most one SCD2 version per full save.
- Admin → Historial de precios shows the product timeline with valid_from, valid_to, price, publication status and out-of-stock/unlisted state. Only authenticated administrators can read `public.product_history`.
- SQL-tested in rolled-back transactions: admin price+inventory update generated one new current version, unlisting created a new version, available→out-of-stock created a new version, and a non-admin could not read the history.
- Three existing reservation totals were compared to their stored `reservation_items`; all itemized sums matched.
- Initial SCD2 baseline begins at migration installation. Prices and states before that date **cannot be reconstructed** from the current catalog.
- Remaining: manually confirm edit/visibility/history and itemized reservation table in Opera, then stress-test concurrent reservations and cross-user RLS before publishing.

## 2026-11-24 — Sale confirmation consumes inventory

Previous behavior: status `confirmed` held units in `inventory.reserved` and only `fulfilled` deducted `inventory.on_hand`. This was confusing when the administrator treated confirmation as a completed sale.

Corrected behavior:
- `pending_contact`: stock remains physically on hand, held in `reserved`.
- `confirmed`: sell immediately; decrement `on_hand` and `reserved` once.
- `fulfilled`: delivery/collection marker only; no additional inventory change.
- `cancelled` from pending: release reserved units.
- `cancelled` from confirmed: return sold units to physical inventory, with explicit admin warning. This assumes a cancelled confirmed sale represents a reversal/return, **not** merely a delivery failure.
- `expired`: pending reservation only, releases the hold.
- Active reservation limit counts only pending holds (confirmed sales no longer occupy the limit).

Legacy reconciliation: confirmed sale `101115B1D7D2` for SKU `DEMO-POWERBANK-40000` was reconciled from on_hand=10, reserved=1 to on_hand=9, reserved=0, without changing its historical sale lines.

Database tests were executed within rolled-back transactions: pending→confirmed consumes one physical unit and one reservation; confirmed→fulfilled doesn't double-consume; confirmed→cancelled restores physical stock. Current reserved quantities match pending holds for all nine products.

## 2026-11-24 — Admin-approved reservation holds and in-store payment or credit

- Customer presses **Enviar solicitud** → backend stores a pending request and captures line-item prices, but **does not touch inventory**; cart is cleared only once a request is saved. The WhatsApp link opens a prefilled message, but external WhatsApp sending cannot be programmatically confirmed.
- Admin **Aprobar reserva y separar stock** (pending_contact→confirmed) is the first inventory reservation operation.
- Ready-for-pickup keeps units reserved. **Pago efectuado** or **Entregar a crédito** consumes physical stock and releases the hold exactly once. Paid→fulfilled marks pickup; delivered_unpaid→fulfilled marks credit settlement (the stock already left at handover).
- Cancel pending without stock change; cancel admin-approved unpaid hold releases only reserved units. No automatic restocking or return workflow is offered after payment/physical handover.
- Legacy confirmed sales: migrated to `legacy_sale` and their stock is left unchanged. Their payment state must not be inferred from the old “confirmed” field.
- Only unapproved requests expire after 24 hours, without touching inventory. Admin approval is atomic and rejects insufficient remaining stock.
- Database rollback tests passed: new request creates no hold; ordinary paid and credit pickup paths both consume exactly one unit; marking completed does not deduct twice.
- About section now provides Google Maps location *reference* (Jirón Cuzco at Jirón Libertad, Magdalena del Mar) and **example** hours Mon–Fri 08:00–20:00, Sat–Sun 09:00–15:00; neither kiosk identity nor exact entrance was independently pinned/verified.
- Pre-production: verify Google Maps embed and directions, reserve→WhatsApp UX, admin approval under concurrent competing requests, credit settlement, customer isolation and mobile layout in Opera.

## 2026-11-25 — Mobile usability, physical stock and paid reversal

- Retail side cart includes **Continuar comprando**. It closes the side drawer and returns focus to the product area without clearing cart items.
- Public catalog retains products with zero available inventory as **Agotado**, with product-specific WhatsApp **Consultar stock** action. Such products cannot be added to cart; the administrator decides whether to unpublish them using the product edit visibility toggle.
- Mobile UI includes smaller touch-friendly spacing, responsive product cards, an accessible cart drawer, admin tabs that scroll horizontally, and stacked order/inventory cards for narrow phones. Real device verification remains pending.
- Admin **Ajustar stock** accepts an explicit new physical count, reason (counter sale, restock, physical count, loss, other correction) and optional notes. It refuses inventory below reserved holds, requires a fresh version timestamp, and records immutable `inventory_movements` audit rows (from this deployment onward).
- A manual stock adjustment is separate from editing the product's commercial data; the product editor shows physical stock read-only, preventing conflicting save routes.
- `paid -> refunded`: admin explicitly reverses a *paid, not-yet-collected* order, returns each unit to physical stock once, and logs the movement. Does not process actual electronic/bank refund; administrator handles monetary reversal separately.
- `fulfilled` and credit-pickup orders are not eligible for automatic return in this simple kiosk workflow; no automatic restock after physical handover.
- SQL rollback tests passed for manual stock adjustment with audit record and payment reversal with inventory restock, without changing existing real data; non-admin manual adjustment rejected.
- Still pending before production: buyer checkout simulation on mobile, Google Maps embedding, Android/iOS Admin edit interactions, two users isolating carts/reservations, race conditions on final stock, and confirmation that WhatsApp is correctly configured.

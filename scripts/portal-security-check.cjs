"use strict";
const assert=require("node:assert/strict");
const fs=require("node:fs");
const read=p=>fs.readFileSync(p,"utf8");
const files=["public/portal.html","public/admin.html","public/js/config.js","public/js/backend.js","public/js/retail-portal.js","public/js/admin.js","supabase/migrations/20261123190100_portal.sql"];
for(const p of files)assert.ok(fs.existsSync(p),p);
const sql=read(files[6]),cfg=read("public/js/config.js"),backend=read("public/js/backend.js");
for(const table of ["profiles","products","inventory","cart_items","reservations","reservation_items"]){
  assert.match(sql,new RegExp("alter table public\\."+table+" enable row level security;","i"));
}
for(const rpc of ["reserve_cart","set_reservation_status","get_catalog"]){
  assert.ok(sql.includes("function public."+rpc+"("),rpc);
}
assert.ok(sql.includes("pg_advisory_xact_lock"),"serialized reservations");
assert.ok(sql.includes("INSUFFICIENT_STOCK"),"stock validation");
assert.ok(sql.includes("ACTIVE_RESERVATION_LIMIT"),"active holds limit");
assert.ok(sql.includes("role='admin'"),"role check in database");
assert.ok(sql.includes("for update"),"row locking");
assert.ok(sql.includes("revoke all on public.profiles"),"table grants");
assert.match(cfg,/supabaseUrl:\s*"https:\/\/ygagjdrdckfkranzndqv\.supabase\.co"/,"expected development project URL");
assert.match(cfg,/supabasePublishableKey:\s*"sb_publishable_[A-Za-z0-9_-]+"/,"browser uses publishable-only key");
assert.doesNotMatch(cfg,/supabasePublishableKey:\s*"(?:sb_secret_|eyJ)[^"]*"/i,"no privileged keys assigned to browser configuration");
assert.match(cfg,/whatsappNumber:\s*""/,"frontend does not hardcode the personal WhatsApp number");
assert.match(read("public/js/retail-portal.js"),/if\(!contact\|\|!cart.length\|\|busy\)return/,"reserve action requires valid contact and cart");
assert.ok(read("public/js/retail-portal.js").includes('from("site_settings")'),"contact is configured from Supabase");
assert.ok(read("public/js/retail-portal.js").includes('from("product_images")'),"product images come from Supabase");
assert.ok(read("public/js/admin.js").includes('uploadObject(product,file)'),"admin image upload interface exists");
assert.ok(read("public/js/admin.js").includes('async function loadProductImages()'),"gallery fetch is present");
assert.ok(read("public/js/admin.js").includes('rpc("set_primary_product_image"'),"primary image selection requires database RPC");
assert.ok(read("public/js/retail-portal.js").includes('queryParams:{prompt:"select_account"}'),"Google sign-in always presents account chooser");
assert.ok(read("public/admin.html").includes('id="editProductForm"'),"admin product editor exists");
assert.ok(read("public/js/admin.js").includes('async function updateProduct(event)'),"product update handles admin form");
assert.ok(read("public/js/admin.js").includes('rpc("admin_update_product"'),"product and stock are saved in a single atomic RPC");
assert.ok(read("public/js/admin.js").includes('from("product_history")'),"SCD2 product versions are visible in admin");
assert.ok(read("public/admin.html").includes('id="historyPanel"'),"admin has historic price screen");
assert.ok(read("public/js/admin.js").includes('node("table",undefined,"reservation-breakdown")'),"reservation item prices and subtotals are broken down");
assert.ok(read("public/js/admin.js").includes('Math.round(Number(x.unit_price)*100)'),"reservation item price comes from historical unit price");
assert.ok(!read("public/js/admin.js").includes('action("Guardar",async()=>'),"there is no redundant inline product save");
assert.ok(read("supabase/migrations/20261124032652_scd2_product_price_and_availability_history.sql").includes("product_history_one_current"),"SCD2 has exactly one current product version");
assert.ok(read("supabase/migrations/20261124032735_atomic_admin_product_editor.sql").includes("PRODUCT_EDIT_CONFLICT"),"atomic product edit rejects stale updates");
const flowSql=read("supabase/migrations/20261124050535_consume_stock_when_sale_confirmed.sql");
assert.ok(flowSql.includes("on_hand=on_hand-item.quantity"),"legacy migration consumed stock on sale confirmation");
const pickupSql=read("supabase/migrations/20261124175347_admin_approved_pickup_reservation_payment_credit.sql");
assert.ok(pickupSql.includes("ready_for_pickup")&&pickupSql.includes("delivered_unpaid"),"pickup and credit statuses exist");
assert.ok(pickupSql.includes("reserved=reserved+item.quantity"),"only administrator approval reserves stock");
assert.ok(pickupSql.includes("on_hand=on_hand-item.quantity"),"payment or credit pickup consumes physical stock");
assert.ok(!pickupSql.includes("if new_status='confirmed' then\n    update public.inventory set reserved=reserved-item.quantity"),"confirmation must not sell inventory");
assert.ok(read("public/js/admin.js").includes("Aprobar reserva y separar stock"),"admin approval explicitly reserves");
assert.ok(read("public/js/admin.js").includes("Entregar a crédito"),"credit pickup workflow is available");
assert.ok(read("public/js/retail-portal.js").includes('pending_contact:"Solicitud recibida'),"customer knows request awaits approval");
assert.ok(read("public/portal.html").includes('id="nosotros"'),"about section is visible");
assert.ok(read("public/portal.html").includes("www.google.com/maps?q="),"Google Maps is embedded");
assert.ok(read("public/_headers").includes("frame-src https://www.google.com"),"CSP allows Google Maps iframe");
assert.ok(!read("public/js/admin.js").includes('.update({id:'),"internal database UUID is never updated by frontend");
assert.ok(read("supabase/migrations/20261124024859_limit_product_update_columns.sql").includes("grant update (sku,name,description,category,price,active,updated_at)"),"restricted product edit columns");
assert.ok(read("public/js/admin.js").includes('rpc("reorder_product_images"'),"visual ordering uses atomic database function");
assert.ok(read("public/js/admin.js").includes('item.draggable=true'),"desktop drag and drop available");
assert.ok(read("public/js/admin.js").includes('moveGalleryImage(im.id,-1)'),"accessibility button allows reordering");
assert.ok(!read("public/js/admin.js").includes('sort_order:order'),"sort_order cannot be directly edited by admin UI");
assert.ok(read("supabase/migrations/20261124022134_atomic_visual_product_image_order.sql").includes("unique(product_id,sort_order) deferrable initially deferred"),"product image positions are unique");
assert.ok(read("supabase/migrations/20261124022202_normalize_image_position_after_mutations.sql").includes("redcastle_normalize_images_after_delete"),"delete normalizes positions");

const stockSql=read("supabase/migrations/20261125030218_audited_counter_stock_and_uncollected_payment_reversal.sql");
assert.ok(stockSql.includes("create table public.inventory_movements"),"inventory changes have audit log");
assert.ok(stockSql.includes("STOCK_BELOW_RESERVED"),"physical stock cannot drop below held units");
assert.ok(stockSql.includes("p_expected_inventory_updated_at"),"manual edits reject stale inventory");
assert.ok(stockSql.includes("new_status='refunded'"),"paid but uncollected payment can be reversed");
assert.ok(stockSql.includes("on_hand=on_hand+item.quantity"),"refund restocks exactly once");
assert.ok(read("public/js/admin.js").includes('rpc("admin_adjust_stock"'),"administrator can adjust physical inventory with reason");
assert.ok(read("public/js/admin.js").includes('from("inventory_movements")'),"inventory movements shown in admin");
assert.ok(read("public/admin.html").includes('id="stockAdjustForm"'),"reasoned manual stock form exists");
assert.ok(read("public/js/admin.js").includes("Anular pago y reponer stock"),"paid-order reversal is available");
assert.ok(read("public/portal.html").includes('id="continueShopping"'),"side cart has continue shopping button");
assert.ok(read("public/index.html").includes('id="perfil"')&&read("public/portal.html").includes('id="profileIdentity"'),"profile contains private account and reservation summary");
assert.ok(read("public/js/retail-portal.js").includes("function renderProfile()"),"profile content is session-aware");
assert.ok(read("public/js/retail-portal.js").includes('reservation-"+level'),"customer reservations have semantic status styling");
assert.ok(read("public/portal.html").includes('id="floatingCart"'),"floating cart button always remains available");
assert.ok(read("public/js/retail-portal.js").includes('floatingCartCount'),"floating cart count reacts to real cart changes");
assert.ok(read("public/admin.html").includes('id="inventorySearch"')&&read("public/admin.html").includes('id="inventoryStatus"'),"admin stock has search and availability filter");
assert.ok(read("public/js/admin.js").includes("function renderInventory()"),"stock filters are applied client-side");
assert.ok(read("public/js/admin.js").includes("priority[a.status]"),"admin reservation queue prioritizes outstanding actions");
assert.ok(read("public/admin.html").includes('id="reservationOverview"'),"admin queue has accessible status counts");

assert.ok(read("public/js/retail-portal.js").includes('consultOutOfStock(p)'),"out-of-stock products offer WhatsApp inquiries");
assert.ok(read("public/css/portal.css").includes("#reservationsTable>tr"),"admin reservations adapt to mobile cards");
assert.ok(read("public/css/retail-portal.css").includes("@media(max-width:410px)"),"responsive retail cards cover small phones");
assert.ok(read("public/admin.html").includes('id="imageCount"')&&read("public/admin.html").includes('id="reloadImages"'),"image manager has capacity and reload controls");
assert.ok(read("public/index.html")===read("public/portal.html"),"root and portal present the same storefront");
assert.ok(read("public/index.html").includes('id="cartDialog"'),"side cart remains on storefront");
assert.match(backend,/flowType:"pkce"/,"PKCE enabled");
for(const path of files.slice(1,6)){
  const content=read(path);
  assert.ok(!/\bservice_role\b\s*[:=]\s*["']/.test(content),"No embedded service_role: "+path);
}
const headers=read("public/_headers");
assert.ok(headers.includes("/portal.html")&&headers.includes("/admin.html"),"portal CSP paths present");
assert.match(headers,/connect-src 'self' https:\/\/ygagjdrdckfkranzndqv\.supabase\.co/,"CSP only permits the configured Supabase project");
for (const route of ["/portal","/portal.html","/admin","/admin.html"]) {
  assert.ok(headers.includes([route,"  ! Content-Security-Policy"].join(String.fromCharCode(10))),"Cloudflare detach required for "+route);
}
assert.equal((headers.match(/! Content-Security-Policy/g)||[]).length,4,"no inherited restrictive CSP on portal routes");
assert.match(backend,/import\("\.\/vendor\/supabase\.mjs"\)/,"SDK loaded from Cloudflare origin");
assert.doesNotMatch(backend,/cdn\.jsdelivr\.net|esm\.sh|unpkg\.com/,"no external runtime SDK CDN");
assert.ok(read("public/admin.html").includes('id="adminContent" hidden'),"admin UI hidden by default");
assert.ok(read("public/portal.html").includes("Sin") || read("public/portal.html").includes("pago"),"no checkout");
console.log("Portal security static checks: OK (not an integration or penetration test).");

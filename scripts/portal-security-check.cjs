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
assert.ok(read("public/js/admin.js").includes('.select("id,sku,name,category,price").single()'),"product changes are verified");
assert.ok(!read("public/js/admin.js").includes('.update({id:'),"internal database UUID is never updated by frontend");
assert.ok(read("supabase/migrations/20261124024859_limit_product_update_columns.sql").includes("grant update (sku,name,description,category,price,active,updated_at)"),"restricted product edit columns");
assert.ok(read("public/js/admin.js").includes('rpc("reorder_product_images"'),"visual ordering uses atomic database function");
assert.ok(read("public/js/admin.js").includes('item.draggable=true'),"desktop drag and drop available");
assert.ok(read("public/js/admin.js").includes('moveGalleryImage(im.id,-1)'),"accessibility button allows reordering");
assert.ok(!read("public/js/admin.js").includes('sort_order:order'),"sort_order cannot be directly edited by admin UI");
assert.ok(read("supabase/migrations/20261124022134_atomic_visual_product_image_order.sql").includes("unique(product_id,sort_order) deferrable initially deferred"),"product image positions are unique");
assert.ok(read("supabase/migrations/20261124022202_normalize_image_position_after_mutations.sql").includes("redcastle_normalize_images_after_delete"),"delete normalizes positions");

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

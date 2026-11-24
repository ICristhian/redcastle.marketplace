"use strict";
const assert=require("node:assert/strict");
const fs=require("node:fs");
const read=p=>fs.readFileSync(p,"utf8");
const files=["public/portal.html","public/admin.html","public/js/config.js","public/js/backend.js","public/js/portal.js","public/js/admin.js","supabase/migrations/20261123190100_portal.sql"];
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
assert.match(cfg,/whatsappNumber:\s*""/,"reservations remain disabled until WhatsApp number is configured");
assert.match(read("public/js/portal.js"),/!\/\^\\d\{8,15\}\$\/.test\(APP_CONFIG.whatsappNumber\)/,"reservation operation is gated on WhatsApp configuration");
assert.match(backend,/flowType:"pkce"/,"PKCE enabled");
for(const path of files.slice(1,6)){
  const content=read(path);
  assert.ok(!/\bservice_role\b\s*[:=]\s*["']/.test(content),"No embedded service_role: "+path);
}
const headers=read("public/_headers");
assert.ok(headers.includes("/portal.html")&&headers.includes("/admin.html"),"portal CSP paths present");
assert.match(headers,/connect-src 'self' https:\/\/ygagjdrdckfkranzndqv\.supabase\.co/,"CSP only permits the configured Supabase project");
assert.match(backend,/import\("\.\/vendor\/supabase\.mjs"\)/,"SDK loaded from Cloudflare origin");
assert.doesNotMatch(backend,/cdn\.jsdelivr\.net|esm\.sh|unpkg\.com/,"no external runtime SDK CDN");
assert.ok(read("public/admin.html").includes('id="adminContent" hidden'),"admin UI hidden by default");
assert.ok(read("public/portal.html").includes("Sin") || read("public/portal.html").includes("pago"),"no checkout");
console.log("Portal security static checks: OK (not an integration or penetration test).");

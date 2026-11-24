"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname,"../public");
const read = file => fs.readFileSync(path.join(root,file),"utf8");
const headers = read("_headers");
const html = read("index.html");
const js = read("js/store.js");
const svg = read("assets/products.svg");
let checks = 0;
function test(name,condition) {
  assert.ok(condition,name);
  checks++;
  process.stdout.write("✓ " + name + "\n");
}
const requiredFiles = ["index.html","css/retail.css","js/store.js","assets/products.svg","assets/favicon.svg","_headers"];
for (const file of requiredFiles) test("Archivo requerido: " + file,fs.existsSync(path.join(root,file)));

const header = name => {
  const re = new RegExp("^\\s{2}" + name.replaceAll("-","\\-") + ":\\s*(.*)$","im");
  return headers.match(re)?.[1]?.trim() || "";
};
const csp = header("Content-Security-Policy");
test("CSP establece default-src none",/default-src 'none'/.test(csp));
for (const rule of ["script-src 'self'","style-src 'self'","connect-src 'self'","object-src 'none'","base-uri 'none'","form-action 'none'","frame-ancestors 'none'"]) {
  test("Directiva CSP " + rule,csp.includes(rule));
}
test("CSP no permite inline/eval",!csp.includes("unsafe-inline") && !csp.includes("unsafe-eval"));
test("X-Content-Type-Options",header("X-Content-Type-Options")==="nosniff");
test("X-Frame-Options",header("X-Frame-Options")==="DENY");
test("Política de permisos",header("Permissions-Policy").includes("payment=()"));
test("COOP restringe orígenes",header("Cross-Origin-Opener-Policy")==="same-origin");
test("HSTS provisional de un día",header("Strict-Transport-Security")==="max-age=86400");
test("Demo sin indexación",header("X-Robots-Tag").toLowerCase().includes("noindex"));
test("HTML de prueba con meta noindex",/name="robots" content="noindex, nofollow"/.test(html));
test("HTML sin scripts embebidos",!/<script\b(?![^>]*\bsrc=)[^>]*>/i.test(html));
test("HTML sin manejadores onclick / onerror",!/\son(?:click|error|load|mouseover|focus)\s*=/i.test(html));
test("JavaScript sin eval/innerHTML",!/(?:\beval\s*\(|\binnerHTML\b|\bouterHTML\b|document\.write\s*\(|new\s+Function\s*\()/i.test(js));
test("Carrito usa texto en el DOM",js.includes(".textContent"));
test("Carrito restringe cantidades",js.includes("MAX_QTY = 10") && js.includes("Number.isInteger(q)"));
test("Sin checkout ni pagos en línea",!html.includes("Finalizar compra") && html.includes('id="transferToPortal"') && html.includes("Solicitar reserva"));
test("Reserva inicia deshabilitada sin carrito",/<button class="checkout-button" id="transferToPortal" type="button" disabled>/.test(html));
test("Sin fuentes externas en HTML",!/<(?:script|link)\b[^>]*https?:\/\//i.test(html));
test("Ilustraciones SVG no incluyen scripts",!/<script\b|onload\s*=|javascript:/i.test(svg));
console.log("\n" + checks + " verificaciones de seguridad local superadas.");

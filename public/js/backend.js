import {APP_CONFIG} from "./config.js";

let clientPromise;
export function isConfigured() {
  const {enabled,supabaseUrl,supabasePublishableKey} = APP_CONFIG;
  return enabled && /^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(supabaseUrl)
    && typeof supabasePublishableKey === "string" && supabasePublishableKey.length > 20;
}
const sdkSources = Object.freeze([
  "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.57.0/+esm",
  "https://esm.sh/@supabase/supabase-js@2.57.0?bundle"
]);

async function importSdk() {
  // Los dos proveedores usan una versión exacta. Nunca se carga una versión "latest".
  // Una caída del CDN principal no debe deshabilitar el inicio de sesión.
  for (const source of sdkSources) {
    try {
      const module = await import(source);
      if (typeof module.createClient === "function") return module;
    } catch (error) {
      console.warn("Redcastle: no se pudo cargar un origen de SDK; probando alternativa.", error?.name || "NetworkError");
    }
  }
  throw new Error("SDK_IMPORT_FAILED");
}

export async function supabase() {
  if (!isConfigured()) throw new Error("PORTAL_NOT_CONFIGURED");
  if (!clientPromise) {
    clientPromise = (async () => {
      const sdk = await importSdk();
      return sdk.createClient(APP_CONFIG.supabaseUrl,APP_CONFIG.supabasePublishableKey,{
        auth: {flowType:"pkce",detectSessionInUrl:true,persistSession:true,autoRefreshToken:true}
      });
    })().catch(error => {
      clientPromise = undefined; // Permite reintentar tras un fallo temporal de red.
      throw error;
    });
  }
  return clientPromise;
}
export function formatMoney(value) {
  return new Intl.NumberFormat("es-PE",{style:"currency",currency:"PEN"}).format(Number(value)||0);
}
export function safeError(error) {
  // Nunca renderizamos stack traces ni respuestas privadas del servidor en pantalla.
  const msg=String(error?.message || error || "");
  const known={
    SDK_IMPORT_FAILED:"No se pudo cargar el módulo de Supabase. Revisa tu conexión, bloqueadores y la consola del navegador.",
    PORTAL_NOT_CONFIGURED:"El portal todavía no tiene conexión configurada.",
    AUTH_REQUIRED:"Inicia sesión para continuar.",
    EMPTY_CART:"Tu carrito está vacío.",
    PRODUCT_UNAVAILABLE:"Un producto ya no está disponible.",
    INSUFFICIENT_STOCK:"La disponibilidad cambió. Ajusta tu carrito.",
    FORBIDDEN:"No tienes permisos para realizar esta operación.",
    INVALID_TRANSITION:"Ese cambio de estado no está permitido.",
    RESERVATION_CLOSED:"La reserva ya está cerrada.",
    RESERVATION_NOT_FOUND:"No encontramos esa reserva."
  };
  for (const [key,message] of Object.entries(known)) if(msg.includes(key)) return message;
  if (msg.includes("JWT") || msg.includes("invalid claim")) return "La sesión caducó. Vuelve a iniciar sesión.";
  if (msg.includes("row-level security")) return "La operación fue rechazada por permisos.";
  return "No se completó la operación. Inténtalo de nuevo o consulta al administrador.";
}
export function notify(message, error=false) {
  const el=document.getElementById("toast");
  if(!el)return;
  el.textContent=message;el.hidden=false;el.style.background=error?"#9b3832":"#26303e";
  clearTimeout(notify.timer);
  notify.timer=setTimeout(()=>{el.hidden=true;},4000);
}
export function whatsappLink(code,items=[]) {
  const number=APP_CONFIG.whatsappNumber;
  if(!/^\d{8,15}$/.test(number))return "";
  const lines=[`Hola, deseo continuar con mi reserva Redcastle ${code}.`];
  if(items.length)lines.push(...items.map(x=>`• ${x.quantity} × ${x.product_name}`));
  lines.push("Quisiera coordinar la disponibilidad y el pago fuera de la web.");
  return `https://wa.me/${number}?text=${encodeURIComponent(lines.join("\n"))}`;
}
export function node(tag,text,cls) {
  const el=document.createElement(tag);
  if(text!==undefined)el.textContent=String(text);
  if(cls)el.className=cls;
  return el;
}

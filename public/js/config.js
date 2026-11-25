// Configuración PÚBLICA de frontend: completar solo cuando exista un proyecto Supabase.
// La clave "anon/publishable" está diseñada para frontend; NUNCA usar service_role o secret keys.
// Cambiar enabled a true únicamente después de aplicar SQL, RLS y configurar OAuth.
export const APP_CONFIG = Object.freeze({
  enabled: true,
  supabaseUrl: "https://ygagjdrdckfkranzndqv.supabase.co",
  supabasePublishableKey: "sb_publishable_864vOPx6_glgVN0N6FHOMg_BIviBeYe",
  whatsappNumber: "", // Formato internacional solo dígitos: 51XXXXXXXXX
  reservationHours: 24
});

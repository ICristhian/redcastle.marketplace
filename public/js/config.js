// Configuración PÚBLICA de frontend: completar solo cuando exista un proyecto Supabase.
// La clave "anon/publishable" está diseñada para frontend; NUNCA usar service_role o secret keys.
// Cambiar enabled a true únicamente después de aplicar SQL, RLS y configurar OAuth.
export const APP_CONFIG = Object.freeze({
  enabled: false,
  supabaseUrl: "",
  supabasePublishableKey: "",
  whatsappNumber: "", // Formato internacional solo dígitos: 51XXXXXXXXX
  reservationHours: 24
});

# Supabase security baseline — 2026-11-23

## Cambios verificados en proyecto de desarrollo

- Proyecto `redcastle-marketplace-dev`, región `us-east-1`.
- Se revocó `EXECUTE` público de `public.rls_auto_enable()`. El event trigger RLS se conserva.
- Aplicada migración del portal de reservas: seis tablas con Row Level Security.
- Los métodos con privilegios elevados residen en el esquema `private`; los RPC públicos son `SECURITY INVOKER`.
- Los roles `anon` y `authenticated` tienen acceso restringido por SQL GRANT y RLS.
- El catálogo público se probó desde rol `anon`.
- Se creó un índice para la clave foránea `reservation_items.product_id`.
- Lectura de productos: política RLS separada para `anon` y `authenticated`.
- Habilitado `pg_cron` y job `redcastle-release-expired` (cada cinco minutos), para liberar reservas pendientes vencidas. Confirmado `active=true`.
- Supabase Security Advisor: sin advertencias tras la aplicación.
- Los avisos informativos sobre índices no utilizados son esperables mientras las tablas estén vacías.

## Estado de migraciones aplicadas directamente por MCP

1. `redcastle_reservation_portal_v1`
2. `enable_reservation_expiry_cron`
3. `optimize_reservation_product_access`
4. `separate_anon_authenticated_product_select`

**Nota:** La historia SQL de Supabase y los nombres de archivos Git no tienen los mismos identificadores, porque los cambios se aplicaron mediante MCP. No ejecutar nuevamente estos archivos a ciegas contra el mismo proyecto; primero reconciliar migraciones con la CLI y su historial remoto.

## Pendientes importantes antes de habilitar clientes

1. Configurar Supabase Auth OAuth Google y Microsoft con IDs y secretos propiedad del titular de las cuentas.
2. Configurar URLs de callback exactas y verificar el flujo PKCE.
3. Crear y verificar un usuario normal y otro administrador; probar aislamiento entre usuarios y denegación del acceso administrativo.
4. Probar reservas reales, inventario, concurrencia y liberación del stock con datos de prueba.
5. Configurar el número oficial WhatsApp, sin compartir secretos de API.
6. Habilitar protección antiabuso/rate limiting según tráfico y controles que admita el plan.
7. Revisar conservación de datos, política de privacidad, copias de seguridad y restauración.
8. **Mantener `public/js/config.js` con `enabled:false` hasta completar las pruebas.**
9. No fusionar el PR de portal todavía; el sitio actual de producción permanece intacto.

Este documento recoge validaciones estructurales, no un pentest ni una certificación de seguridad.

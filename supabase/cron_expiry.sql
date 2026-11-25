-- Ejecutar solo tras habilitar la extensión pg_cron en Supabase.
-- Ejemplo: Supabase Dashboard > Integrations > Cron
-- Requiere ejecutar como propietario con permisos para invocar private.release_expired.
-- Revisa en el dashboard si la extensión está instalada antes de habilitar.
create extension if not exists pg_cron with schema pg_catalog;

-- Ejecutar cada cinco minutos y liberar hasta 100 reservas vencidas por ejecución.
select cron.schedule(
  'redcastle-release-expired',
  '*/5 * * * *',
  $$select private.release_expired();$$
);

-- Supervisar en cron.job y cron.job_run_details.
-- Si se vuelve a configurar, confirmar si existe el job para evitar duplicados.

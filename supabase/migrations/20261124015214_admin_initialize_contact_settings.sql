create policy "Admin initialize contact" on public.site_settings
for insert to authenticated with check ((select private.is_admin()));
grant insert(singleton,whatsapp_number,updated_at) on public.site_settings to authenticated;

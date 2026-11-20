# Redcastle Marketplace

Sitio estático de prueba preparado para **Cloudflare Pages**. El alcance funcional del marketplace aún está por definir.

## Publicación
- Proveedor: Cloudflare Pages (no Worker).
- Repositorio: `ICristhian/redcastle.marketplace`
- Rama de producción: `main`
- Framework: `None`
- Build command: **vacío**
- Build output directory: `public`
- Root directory: directorio raíz (valor predeterminado).

Cloudflare Pages publicará automáticamente los nuevos cambios enviados a la rama de producción cuando el proyecto esté conectado.

## Controles iniciales
- Página estática sin formularios, JavaScript ni dependencias externas.
- Cabeceras de seguridad en `public/_headers`, incluidas CSP, anti-clickjacking, nosniff y restricciones de permisos.
- Robots `noindex,nofollow` hasta publicar una versión definitiva.
- No se recopila información personal.

## Validaciones pendientes tras el primer despliegue
1. Confirmar que abre la URL `*.pages.dev` con HTTPS.
2. Revisar las cabeceras HTTP de seguridad de la respuesta.
3. Validar que una modificación a `main` activa el despliegue.
4. Activar MFA en GitHub y Cloudflare y limitar permisos de acceso.
5. Evaluar WAF, rate limiting, observabilidad, DNS y dominio personalizado según la futura aplicación.

> Estas cabeceras son apropiadas para la página de prueba, pero deberán revisarse si se incorporan scripts, fuentes externas, APIs o formularios.

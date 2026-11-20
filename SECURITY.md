# Seguridad — Redcastle Marketplace (demo)

Estado: sitio estático de demostración, sin autenticación, formularios, pagos, API ni backend.

## Controles incluidos en el código
- CSP restrictiva; scripts, estilos e imágenes locales; prohíbe objetos, formularios y frames.
- Encabezados de seguridad: X-Content-Type-Options, Referrer-Policy, X-Frame-Options, Permissions-Policy, COOP y X-Robots-Tag.
- HSTS provisional: `max-age=86400` (24 horas), sin `includeSubDomains` ni `preload`. Revisar y ampliar solo tras validar su funcionamiento.
- Javascript sin `eval`, `innerHTML` ni interpolación de datos externos como HTML.
- El carrito está únicamente en `localStorage`; no introducir información personal en él.
- Pruebas automáticas con `node scripts/security-check.cjs`, sin paquetes npm ni scripts remotos.
- GitHub Actions con permisos mínimos de lectura, checkout fijado a un SHA y credenciales no persistentes.

## Controles pendientes en la cuenta (revisión manual)
1. **MFA:** activar autenticación multifactor en GitHub y Cloudflare. Preferir passkeys o claves FIDO2 cuando estén disponibles.
2. **GitHub → Settings → Rules → Rulesets:** crear un branch ruleset activo para `main`. Requerir Pull Request, bloquear force pushes y eliminación de rama. Una vez completada una primera ejecución de GitHub Actions, exigir el status check `Static security checks` antes de fusionar.
3. **GitHub → Settings → Security:** habilitar las alertas disponibles de análisis de dependencias, secret scanning / push protection cuando estén disponibles para este repositorio, y revisar avisos. La ausencia de dependencias externas hace que no haya paquetes npm que actualizar.
4. **Cloudflare:** evaluar protección con Access para las URLs de previsualización si contienen trabajo no publicado. `noindex` no evita el acceso público.
5. **Dominio propio (etapa futura):** revisar WAF, reglas contra bots y configuración de protección del dominio correspondiente. No dar por verificado el WAF sobre `*.pages.dev` solo por ver encabezados Cloudflare.
6. **Gestión de accesos:** limitar permisos del conector GitHub y de la aplicación Cloudflare en GitHub a los repositorios necesarios; revisar accesos periódicamente.
7. **Secretos:** nunca incluir tokens o credenciales en HTML, JS, repositorio ni variables públicas. Si se filtra un secreto, revocarlo y reemplazarlo inmediatamente.
8. **Recuperación:** conservar historial Git y conocer la función de rollback en Cloudflare Pages.

## Pruebas tras aprobar el Pull Request
Ejecutar en PowerShell:

```powershell
curl.exe -I https://redcastle-marketplace.pages.dev/
curl.exe -I http://redcastle-marketplace.pages.dev/
```

Comprobar `200 OK` en HTTPS, redirección `301` desde HTTP, y las cabeceras `strict-transport-security: max-age=86400`, `cross-origin-opener-policy: same-origin`, `x-robots-tag: noindex, nofollow` y `content-security-policy`.

En GitHub, comprobar que el check automático está en verde antes de fusionar. En Cloudflare, confirmar que el despliegue de `main` corresponde al commit fusionado.

**Limitación:** un check estático no equivale a una auditoría externa, pentest ni revisión de infraestructura. Cada nueva función puede exigir políticas adicionales.

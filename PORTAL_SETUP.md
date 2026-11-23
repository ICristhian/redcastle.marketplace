# Redcastle Marketplace — Portal de reservas (arquitectura v2)

## Estado actual

Este cambio está **solo en la rama `feature/reservation-portal`**. Producción continúa siendo la tienda de demostración v1. Las nuevas pantallas están deshabilitadas hasta que se configure un proyecto propio de Supabase y OAuth. **No integrar a main antes de las pruebas de base de datos y autenticación.**

### Componentes

- Cloudflare Pages: frontend estático (`/portal.html` y `/admin.html`).
- Supabase Auth: iniciar sesión con Google (provider `google`) o Microsoft (provider `azure`), con PKCE.
- Supabase PostgreSQL: perfiles, productos, inventario, carritos y reservas.
- Supabase RLS: cada usuario ve su información; rol administrador definido exclusivamente en PostgreSQL.
- Supabase RPC: reserva atómica que valida y bloquea stock; transiciones administrativas de estados.
- WhatsApp: enlace `wa.me` con código de reserva y resumen; **el cliente debe enviar el mensaje**.
- Sin pagos online, sin almacenamiento de tarjetas y sin contraseñas propias.

## 1. Crear Supabase

1. Crear proyecto en https://supabase.com/ y conservar a salvo credenciales administrativas.
2. Usar un proyecto de **desarrollo** inicialmente.
3. En Supabase → SQL Editor, ejecutar `supabase/migrations/202611230001_portal.sql`.
4. Revisar que las seis tablas tengan RLS habilitado y que las políticas coincidan con las definidas.
5. En Authentication → Providers, habilitar **Google** y **Azure (Microsoft)**.
6. Configurar el enlace de redirección de proveedores:
   - **Redirect URI del proveedor hacia Supabase**: `https://<project-ref>.supabase.co/auth/v1/callback`
   - **Redirect URLs autorizadas en Supabase Auth**: `https://redcastle-marketplace.pages.dev/portal.html` y, en desarrollo, URLs explícitas de preview protegidas, cuando corresponda.
   - Usar OAuth client IDs/secrets del proveedor guardados **solo en Supabase**, nunca en `public/`.
7. En Supabase → Project Settings → API, copiar URL y clave **publishable** al archivo `public/js/config.js`, modificar `enabled: true`, y establecer el teléfono WhatsApp en formato internacional numérico (p. ej., prefijo 51 para Perú, sin + ni espacios).
8. Configurar las URLs permitidas en Authentication → URL Configuration (Site URL y Redirect URLs).
9. Probar autenticación, registro de perfil y permisos desde una cuenta normal y una cuenta administrativa.
10. Asignar el primer administrador **manualmente** desde SQL Editor (sustituye con el UUID real tras su primer login):

```sql
update public.profiles set role='admin' where id='<UUID_REAL_DEL_ADMIN>';
```

Nunca permitir que el navegador, el registro OAuth ni los metadatos editables por usuario asignen roles administrativos.

### Requisitos de OAuth

**Google:** proyecto Google Cloud, pantalla de consentimiento OAuth, OAuth Client ID tipo web, client secret, origen autorizado y callback de Supabase.

**Microsoft:** Microsoft Entra → App registrations, aplicación con audiencia definida (cuentas personales Microsoft, organizacionales o ambas), Client ID, client secret y callback de Supabase. Validar configuración del tenant. La opción `azure` en Supabase es el proveedor para Microsoft.

No existe por ahora integración con Gmail como servicio de correo. Para iniciar sesión con una cuenta Gmail se utiliza **Google Sign-In**.

## 2. Flujo funcional

1. Cliente se autentica. Supabase crea su perfil con rol `customer`.
2. Catálogo se consulta desde `get_catalog()`, que devuelve productos activos y unidades disponibles.
3. Carrito se guarda en `cart_items` por UUID de usuario y se conserva entre dispositivos autenticados.
4. Botón «Solicitar reserva» invoca `reserve_cart()` en PostgreSQL. La transacción:
   - serializa reservas simultáneas del mismo usuario;
   - valida carrito, disponibilidad y estado de cada producto;
   - bloquea existencias (`reserved`) sin reducir el stock físico;
   - genera código de reserva y copia el precio y nombre históricos;
   - vacía el carrito tras crearla;
   - establece vencimiento inicial de 24 horas.
5. El usuario continúa por WhatsApp para atención. La reserva queda registrada aunque no envíe el mensaje.
6. El administrador puede marcar `confirmed`, `cancelled` o `fulfilled`.
   - `cancelled` libera unidades reservadas.
   - `fulfilled` descuenta del stock físico y reservado.
   - `confirmed` conserva la reserva sin expiración automática.
7. Los usuarios solo consultan sus propios datos y reservas; los administradores pueden consultar todos los registros.

**Límite de protección:** cada usuario puede tener como máximo 3 reservas activas (pendientes/confirmadas).

## 3. Expiración automática: configuración obligatoria

La función `private.release_expired()` libera las reservas vencidas cuando se invoca desde una reserva nueva, pero **eso no sustituye un cron**. Para evitar stock retenido durante períodos sin tráfico, configurar el job con `supabase/cron_expiry.sql` una vez verificado que el proyecto tenga habilitado `pg_cron`. Probar que el job se ejecute con los permisos adecuados.

## 4. Reglas de seguridad

- **Nunca publicar** `service_role`, claves secretas, contraseña de base de datos ni OAuth client secret.
- La clave publishable/anon está diseñada para navegador y **no es una credencial administrativa**. La protección real depende de RLS.
- No publicar rutas administrativas sin comprobar rol; ocultar botones **no** sustituye la política SQL.
- No usar precios o stock enviados por el navegador para crear reservas.
- Las solicitudes de `reserve_cart` se ejecutan en el servidor y son atómicas.
- Habilitar MFA/passkeys en GitHub, Cloudflare, Supabase y las cuentas administradoras cuando proceda.
- Mantener las previews restringidas con Cloudflare Access; el código del repositorio público sigue siendo visible.
- Evaluar límites de solicitudes para RPC y protección contra automatizaciones abusivas.
- Revisar políticas de privacidad y datos personales antes de incorporar clientes reales.

## 5. Pruebas de aceptación (obligatorias antes de producción)

- Usuario anónimo: puede consultar catálogo, no puede modificar tablas ni reservar.
- Usuario A: no puede leer ni editar carrito, perfil o reservas del usuario B.
- Usuario A: no puede darse rol `admin`, editar stock ni cambiar reservas.
- Administrador: registra productos, modifica disponibilidad y cambia estados permitidos.
- Dos usuarios reservan simultáneamente la última unidad: solo uno debe conseguirlo.
- Un mismo usuario realiza solicitudes concurrentes: no se duplican reservas del mismo carrito.
- Reserva expira: stock vuelve a disponible; confirmada no expira.
- Cancelación: libera stock; atendida: descuenta stock físico.
- Cerrar sesión y abrir en otro navegador: carrito personal se recupera al autenticarse.
- OAuth Google y Microsoft: inicio, retorno a portal y cierre de sesión.
- WhatsApp: número correcto, código válido, texto correcto; no asumir que un mensaje se envió.
- Verificar CSP de las rutas de portal y administración y que los botones no activen llamadas si `enabled=false`.

## 6. Acciones pendientes

- Conectar Supabase y configurar proveedores OAuth con credenciales de las cuentas del usuario.
- Configurar y probar cron de expiración.
- Ejecutar pruebas funcionales y de seguridad contra una base real.
- Cargar productos e inventario desde administración.
- Definir el número oficial de WhatsApp y la política de conservación de datos.
- Revisar el Pull Request y no fusionar antes de completar todas las verificaciones.

## Aviso operativo

No existe pasarela de pagos en el proyecto. No enviar ni almacenar información bancaria, números de tarjeta o documentos de identidad en el carrito o mensaje de WhatsApp.

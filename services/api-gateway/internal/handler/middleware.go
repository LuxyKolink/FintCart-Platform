package handler

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"time"
)

// Middlewares del borde REST (Principio VII para autenticación y autorización,
// Principio IV para rate limiting).
//
// Todo lo que este archivo hace es lo que el Gateway aporta como BORDE: es el único
// punto donde un token se valida y donde se decide si un rol puede pasar. Los servicios
// internos confían en que aquí ya ocurrió, y por eso no repiten la comprobación — lo
// que a su vez significa que un agujero aquí es un agujero en toda la plataforma.

// Claims es el contenido verificado de un access token.
type Claims struct {
	UserID string
	Roles  []string
	JTI    string
	Scopes []string
}

// TokenVerifier verifica firma y expiración de un access token.
//
// «Verificar» y no «decodificar»: un JWT decodificado sin comprobar la firma es un
// objeto JSON que escribió quien envió la petición. La implementación (T056) usa
// `JWT_PUBLIC_KEY` y debe además fijar el algoritmo esperado — aceptar el `alg` que
// declara el propio token permite el ataque clásico de degradarlo a `none`.
type TokenVerifier interface {
	Verify(raw string) (Claims, error)
}

// BlacklistChecker consulta si un `jti` fue revocado (FR-004).
//
// Va contra Redis directamente y no por `Auth.Introspect`: es una consulta en el camino
// crítico de CADA petición autenticada, y un salto gRPC extra por petición añadiría
// latencia a todo el sistema. La contrapartida es que el Gateway conoce el formato de
// la clave `blacklist:{jti}`, un acoplamiento asumido a cambio de esa latencia.
type BlacklistChecker interface {
	IsBlacklisted(ctx context.Context, jti string) (bool, error)
}

// Roles de la plataforma (FR-006).
const (
	RoleUsuarioFinal        = "usuario_final"
	RoleEditor              = "editor"
	RoleCoordinadorEditoria = "coordinador_editorial"
)

// claimsKey es la clave del contexto donde viajan los claims.
//
// Es un tipo privado y no un `string`: con una clave de tipo string, cualquier otro
// paquete podría sobrescribir los claims de la petición por accidente o a propósito.
type claimsKey struct{}

// ClaimsFrom recupera los claims verificados de la petición.
//
// Devuelve `ok = false` si no hay: los handlers de rutas públicas no deben suponer que
// existen, y los de rutas privadas fallan de forma explícita en lugar de operar con un
// `UserID` vacío —que, sin esta comprobación, se interpretaría como «el usuario cuyo id
// es la cadena vacía» y llegaría hasta el SQL.
func ClaimsFrom(ctx context.Context) (Claims, bool) {
	c, ok := ctx.Value(claimsKey{}).(Claims)
	return c, ok
}

// Authenticate valida el token y deja los claims en el contexto.
func Authenticate(verifier TokenVerifier, blacklist BlacklistChecker, logger *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			raw, err := bearerToken(r)
			if err != nil {
				writeError(w, http.StatusUnauthorized, "unauthenticated", "token ausente o mal formado")
				return
			}

			claims, err := verifier.Verify(raw)
			if err != nil {
				// El motivo del rechazo NO se devuelve al cliente: distinguir «firma
				// inválida» de «expirado» le da a un atacante señal sobre qué parte de su
				// token forjado falló.
				logger.WarnContext(r.Context(), "token rechazado", slog.String("error", err.Error()))
				writeError(w, http.StatusUnauthorized, "unauthenticated", "token inválido")
				return
			}

			revoked, err := blacklist.IsBlacklisted(r.Context(), claims.JTI)
			if err != nil {
				// Si no se puede saber si el token fue revocado, se RECHAZA. Tratar la
				// duda como «no revocado» convertiría una caída de Redis en la
				// reactivación simultánea de todos los tokens revocados, incluidos los de
				// las cuentas anonimizadas.
				logger.ErrorContext(r.Context(), "no se pudo consultar la blacklist",
					slog.String("error", err.Error()))
				writeError(w, http.StatusServiceUnavailable, "unavailable", "no se pudo validar la sesión")
				return
			}
			if revoked {
				writeError(w, http.StatusUnauthorized, "unauthenticated", "sesión revocada")
				return
			}

			next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), claimsKey{}, claims)))
		})
	}
}

// RequireRole exige que el usuario tenga al menos uno de los roles indicados.
//
// Se compone con [Authenticate] y no lo reemplaza: separar «quién eres» de «qué puedes
// hacer» permite que una ruta pida autenticación sin pedir rol, y que el mismo
// middleware de rol sirva para las tres familias de rutas (FR-006).
func RequireRole(roles ...string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			claims, ok := ClaimsFrom(r.Context())
			if !ok {
				// Sin claims aquí significa que la ruta se montó sin `Authenticate`
				// delante: es un error de configuración del router, no del cliente. Se
				// responde 401 y no 500 para no filtrar la existencia de la ruta, pero el
				// caso debe cubrirlo una prueba de rutas.
				writeError(w, http.StatusUnauthorized, "unauthenticated", "no autenticado")
				return
			}
			for _, want := range roles {
				if slices.Contains(claims.Roles, want) {
					next.ServeHTTP(w, r)
					return
				}
			}
			// 403 y no 404: el recurso existe y el usuario está identificado; lo que
			// falta es autorización, y confundir los dos códigos hace imposible depurar
			// un problema de permisos.
			writeError(w, http.StatusForbidden, "forbidden", "rol insuficiente")
		})
	}
}

// RateLimitByIP limita por dirección de origen (Principio IV).
//
// Va como middleware GLOBAL y por delante de [Authenticate]. El orden importa:
// verificar una firma JWT cuesta CPU, así que limitar después dejaría abierta una vía
// de agotamiento con tokens basura, y las rutas públicas —registro, `/oauth/token`—
// quedarían sin ninguna protección, que son justamente las más atacadas.
func RateLimitByIP(limiter Limiter, logger *slog.Logger) func(http.Handler) http.Handler {
	return rateLimit(limiter, logger, func(r *http.Request) (string, bool) {
		return clientIP(r), true
	})
}

// RateLimitByUser limita por identidad autenticada.
//
// Es un SEGUNDO límite y no un sustituto del anterior, y son necesarios los dos: con
// solo el de IP, todos los usuarios detrás de un mismo NAT —una oficina, una
// universidad— comparten cuota y se bloquean entre ellos; con solo el de usuario, no
// hay nada que proteja lo que ocurre antes de tener un token.
//
// DEBE montarse DESPUÉS de [Authenticate]: sin claims en el contexto no hay identidad
// que usar, y en ese caso este middleware no hace nada —el límite por IP ya se aplicó
// más arriba—. Que el orden sea obligatorio y no una preferencia es la razón de que
// esto sean dos funciones con nombre y no un parámetro.
func RateLimitByUser(limiter Limiter, logger *slog.Logger) func(http.Handler) http.Handler {
	return rateLimit(limiter, logger, func(r *http.Request) (string, bool) {
		claims, ok := ClaimsFrom(r.Context())
		if !ok {
			return "", false
		}
		return "user:" + claims.UserID, true
	})
}

// rateLimit es el cuerpo común de los dos anteriores.
func rateLimit(limiter Limiter, logger *slog.Logger, keyOf func(*http.Request) (string, bool)) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			key, ok := keyOf(r)
			if !ok {
				next.ServeHTTP(w, r)
				return
			}

			decision, err := limiter.Allow(r.Context(), key)
			if err != nil {
				logger.ErrorContext(r.Context(), "fallo del rate limiter",
					slog.String("error", err.Error()))
				// El comportamiento ante un fallo del limitador lo decide el propio
				// limitador según su `FailOpen`; si devolvió error, es que decidió
				// rechazar.
				writeError(w, http.StatusServiceUnavailable, "unavailable", "servicio no disponible")
				return
			}
			// Las cabeceras informativas se publican SIEMPRE, no solo al rechazar: un
			// cliente bien escrito frena al ver que le queda poca cuota, y solo puede
			// hacerlo si el dato le llega antes del 429.
			w.Header().Set("X-RateLimit-Remaining", strconv.FormatInt(decision.Remaining, 10))
			if !decision.Allowed {
				w.Header().Set("Retry-After", strconv.Itoa(int(decision.RetryAfter.Seconds())))
				writeError(w, http.StatusTooManyRequests, "rate_limited", "demasiadas peticiones")
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// Limiter es el puerto del rate limiter, declarado en el consumidor.
//
// Evita que `handler` importe `internal/ratelimit` solo por un tipo, y permite probar
// el middleware con un doble de dos líneas.
type Limiter interface {
	Allow(ctx context.Context, key string) (Decision, error)
}

// Decision espeja `ratelimit.Decision`.
type Decision struct {
	Allowed    bool
	Remaining  int64
	RetryAfter time.Duration
}

// AccessLog emite una línea JSON estructurada por petición (D-12).
//
// No registra el cuerpo. `POST /auth/register` transporta una contraseña en claro, así
// que un log de cuerpos convertiría el sistema de logs en un almacén de credenciales.
func AccessLog(logger *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			start := time.Now()
			rec := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
			next.ServeHTTP(rec, r)

			logger.LogAttrs(r.Context(), slog.LevelInfo, "petición atendida",
				slog.String("method", r.Method),
				// `r.URL.Path` y no `RequestURI`: la query string puede llevar tokens o
				// filtros con datos personales.
				slog.String("path", r.URL.Path),
				slog.Int("status", rec.status),
				slog.Duration("duration", time.Since(start)),
			)
		})
	}
}

// statusRecorder captura el código de estado para el log.
//
// `net/http` no lo expone después de escribirlo, así que la única forma de registrarlo
// es interceptar `WriteHeader`.
type statusRecorder struct {
	http.ResponseWriter
	status  int
	written bool
}

func (s *statusRecorder) WriteHeader(status int) {
	if !s.written {
		s.status = status
		s.written = true
	}
	s.ResponseWriter.WriteHeader(status)
}

// bearerToken extrae el token del encabezado `Authorization`.
func bearerToken(r *http.Request) (string, error) {
	const prefix = "Bearer "
	header := r.Header.Get("Authorization")
	if !strings.HasPrefix(header, prefix) {
		return "", fmt.Errorf("%w: se esperaba un encabezado Bearer", errUnauthorized)
	}
	token := strings.TrimSpace(strings.TrimPrefix(header, prefix))
	if token == "" {
		return "", fmt.Errorf("%w: token vacío", errUnauthorized)
	}
	return token, nil
}

// clientIP determina la IP del cliente para el rate limiting.
//
// Confía en `X-Forwarded-For` únicamente porque este servicio corre SIEMPRE detrás de
// un ingress que lo reescribe. Si algún día se expusiera directamente, la cabecera sería
// controlada por el cliente y bastaría cambiarla en cada petición para evadir el límite.
// Se toma la PRIMERA entrada: las siguientes son los proxies intermedios.
func clientIP(r *http.Request) string {
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		if first, _, found := strings.Cut(xff, ","); found {
			return "ip:" + strings.TrimSpace(first)
		}
		return "ip:" + strings.TrimSpace(xff)
	}
	return "ip:" + r.RemoteAddr
}

// writeError responde con el `Error` del contrato.
//
// El mensaje siempre es genérico y escrito a mano; nunca `err.Error()`. Un error interno
// envuelto puede contener nombres de host, de tabla o el detalle del driver, y el borde
// es exactamente el lugar donde eso no debe salir.
func writeError(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, ErrorBody{Code: code, Message: message})
}

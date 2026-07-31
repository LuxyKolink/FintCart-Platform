// Claims de los JWT que emite la plataforma (T048, research D-05).
//
// Este archivo fija la FORMA del token; `jwt_maker.go` lo firma y lo verifica.
// Están separados porque el conjunto de claims es un contrato con todos los
// consumidores —el API Gateway lee `roles` para autorizar y `jti` para consultar la
// blacklist—, mientras que la firma es un detalle interno de este servicio.
package token

import (
	"github.com/golang-jwt/jwt/v5"
)

// Claims son los claims de un access token de Fintcart.
//
// Embebe `jwt.RegisteredClaims` para heredar `exp`, `iat`, `sub`, `iss` y `jti` con
// los nombres del RFC 7519 en lugar de inventarlos: un `expires_at` propio no lo
// valida ninguna librería, y un token sin expiración efectiva es un token eterno.
type Claims struct {
	jwt.RegisteredClaims

	// Roles autoriza en el borde (FR-006). Va DENTRO del token —y no se consulta a
	// Usuarios en cada petición— para que autorizar no cueste un salto gRPC por
	// request. La contrapartida es real y hay que asumirla: un cambio de rol no surte
	// efecto hasta que el token expira o se revoca, y por eso la vida del access
	// token es corta (ver `accessTokenTTL`).
	Roles []string `json:"roles,omitempty"`

	// Scopes acota lo que el token puede hacer; lo usan sobre todo los tokens de
	// Client Credentials (M2M, Principio VII).
	Scopes []string `json:"scopes,omitempty"`
}

// Emisor y audiencia declarados en cada token.
//
// `iss` y `aud` no son decorativos: sin `aud`, un token emitido para un cliente M2M
// sería aceptable en el borde de usuario final, y sin `iss` no habría forma de
// rechazar un token firmado por otro despliegue que compartiera clave por accidente.
const (
	Issuer   = "fintcart-auth"
	Audience = "fintcart-api"
)

// Vidas de los tokens (D-05).
//
// El access token dura poco PRECISAMENTE porque los roles viajan dentro: es el
// plazo máximo durante el cual un permiso retirado sigue siendo válido. El refresh
// token dura mucho más, pero se ROTA en cada uso —cada renovación invalida el
// anterior—, de modo que reutilizar uno ya canjeado delata el robo y permite cortar
// toda la cadena.
const (
	AccessTokenTTL  = 15 * 60           // segundos
	RefreshTokenTTL = 30 * 24 * 60 * 60 // segundos
)

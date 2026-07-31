// Claims de los JWT que emite la plataforma (T048, research D-05).
//
// Este archivo fija la FORMA del token; `jwt_maker.go` lo firma y lo verifica.
// Están separados porque el conjunto de claims es un contrato con todos los
// consumidores —el API Gateway lee `roles` para autorizar y `jti` para consultar la
// blacklist—, mientras que la firma es un detalle interno de este servicio.
package token

import (
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// Claims son los claims de un access token de Fintcart.
//
// Embebe `jwt.RegisteredClaims` para heredar `exp`, `iat`, `sub`, `iss`, `aud` y
// `jti` con los nombres del RFC 7519 en lugar de inventarlos. No es cosmético: las
// librerías validan `exp` y `nbf` automáticamente porque conocen esos nombres, y un
// `expires_at` propio no lo valida nadie — el resultado sería un token eterno que
// parece tener caducidad.
type Claims struct {
	jwt.RegisteredClaims

	// Roles autoriza en el borde (FR-006). Va DENTRO del token —y no se consulta a
	// Usuarios en cada petición— para que autorizar no cueste un salto gRPC por
	// request. La contrapartida es real y hay que asumirla: un cambio de rol no surte
	// efecto hasta que el token expira o se revoca, y por eso [AccessTokenTTL] es
	// corto.
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

// AccessTokenTTL es la vida de un access token (D-05).
//
// Dura poco PRECISAMENTE porque los roles viajan dentro: es el plazo máximo durante
// el cual un permiso retirado sigue siendo válido.
//
// La vida del refresh token es `server.RefreshTokenTTL` y no está aquí porque este
// paquete solo firma access tokens; el refresh es opaco y lo gestiona la capa de
// aplicación. (Además, `token` importa `server`, así que la constante no podría
// vivir en los dos sitios sin un ciclo.)
const AccessTokenTTL = 15 * time.Minute

// SigningMethod es el único algoritmo que este servicio emite y acepta.
//
// Se declara como constante y se usa TANTO al firmar como al verificar. La
// alternativa —leer el `alg` que trae el token— es el fallo clásico de los JWT:
// permite degradarlo a `none` (sin firma) o, con claves asimétricas, firmar con la
// clave pública tratándola como secreto HMAC.
const SigningMethod = "HS256"

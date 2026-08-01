// Capa de aplicación del Servidor de Autenticación (Principio IX).
//
// Aquí viven los flujos OAuth2 y las reglas de identidad; no hay SQL, ni comandos
// de Redis, ni códigos de estado gRPC. Todo lo externo entra por una interfaz
// declarada en este paquete: la persistencia ([storer.Storer], [storer.TokenStore]),
// el hash de contraseñas ([PasswordHasher]), la firma de tokens ([TokenMaker]) y
// los roles del usuario ([AuthContextProvider]).
//
// Que las cuatro sean interfaces no es ceremonia: es lo que permite probar el
// flujo Authorization Code + PKCE —incluida la verificación del `code_verifier`—
// sin Redis, sin PostgreSQL y sin una clave de firma real.
package server

import (
	"errors"
	"fmt"

	"github.com/google/uuid"

	"github.com/fintcart/platform/services/auth-server/internal/storer"
)

// Errores de dominio de esta capa.
var (
	// ErrInvalidArgument: entrada inutilizable (UUID mal formado, campo vacío,
	// método PKCE distinto de S256).
	ErrInvalidArgument = errors.New("server: argumento inválido")

	// ErrUnauthenticated: las credenciales o el token no son válidos.
	//
	// Es un ÚNICO error para «el correo no existe», «la contraseña no coincide» y
	// «la cuenta no está activa», y esa indistinción es deliberada: tres errores
	// distintos convertirían el login en un oráculo que confirma qué correos están
	// registrados y cuáles están pendientes de verificar.
	ErrUnauthenticated = errors.New("server: credenciales inválidas")

	// ErrNotImplemented marca los métodos del esqueleto (T025). En un servicio de
	// autenticación un stub no puede devolver un cero silencioso: «válido: false»
	// se confundiría con una respuesta legítima y «válido: true» sería un agujero.
	ErrNotImplemented = errors.New("server: no implementado")
)

// Centinelas de persistencia que forman parte del contrato de esta capa, para que
// `handler` no necesite importar `storer` (saltarse una capa acoplaría el
// transporte a la persistencia). Son alias para que `errors.Is` recorra la cadena.
var (
	ErrNotFound = storer.ErrNotFound
	ErrConflict = storer.ErrConflict
	// ErrTokenReuse sube tal cual desde `storer`: el hecho de que un refresh token
	// se haya reutilizado —y que por eso se haya invalidado la familia entera— es
	// información que el transporte necesita para elegir el código de estado.
	ErrTokenReuse = storer.ErrTokenReuse
)

// Server implementa los flujos de `AuthService`.
type Server struct {
	store   storer.Storer
	tokens  storer.TokenStore
	hasher  PasswordHasher
	maker   TokenMaker
	authctx AuthContextProvider
	events  EventPublisher
}

// New ensambla la capa de aplicación. No abre conexiones ni lee entorno: recibe
// todo construido desde `cmd/auth/main.go` (Principio X).
//
// `events` es OBLIGATORIO y no admite `nil`: un `nil` haría que la primera
// revocación entrara en pánico, y el punto de exigirlo en la firma es que ningún
// sitio de construcción pueda olvidarlo en silencio y quedarse sin auditoría.
func New(
	store storer.Storer,
	tokens storer.TokenStore,
	hasher PasswordHasher,
	maker TokenMaker,
	authctx AuthContextProvider,
	events EventPublisher,
) *Server {
	return &Server{
		store:   store,
		tokens:  tokens,
		hasher:  hasher,
		maker:   maker,
		authctx: authctx,
		events:  events,
	}
}

// parseUserID valida el identificador opaco antes de que llegue al SQL.
func parseUserID(raw string) (uuid.UUID, error) {
	id, err := uuid.Parse(raw)
	if err != nil {
		return uuid.Nil, fmt.Errorf("%w: user_id %q no es un UUID", ErrInvalidArgument, raw)
	}
	return id, nil
}

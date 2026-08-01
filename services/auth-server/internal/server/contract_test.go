// Pruebas de CONTRATO de `AuthService` (T054): productor ↔ consumidor.
//
// Qué son y por qué van aquí. Estas pruebas atraviesan la pila real de transporte —un
// servidor gRPC de verdad sobre `bufconn`, con los interceptores y el cliente
// GENERADO desde `contracts/proto`— y sustituyen únicamente lo que hay por debajo de
// la capa de aplicación (persistencia, hasher, firma de tokens). El resultado es que
// comprueban justo lo que un test de unidad no puede: que los campos del `.proto`
// llegan donde deben, que los errores de dominio salen con el código de estado
// correcto y que un cambio en `contracts/` rompe aquí en lugar de en producción.
//
// `bufconn` en lugar de un puerto TCP: la conexión vive en memoria, así que no hay
// puertos que reservar ni carreras entre pruebas paralelas.
//
// El paquete es `server_test` (externo) a propósito: si fuera `server`, importar
// `handler` —que importa `server`— sería un ciclo.
package server_test

import (
	"context"
	"errors"
	"net"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/status"
	"google.golang.org/grpc/test/bufconn"

	authv1 "github.com/fintcart/platform/services/auth-server/gen/fintcart/auth/v1"
	"github.com/fintcart/platform/services/auth-server/internal/handler"
	"github.com/fintcart/platform/services/auth-server/internal/server"
	"github.com/fintcart/platform/services/auth-server/internal/storer"
)

const (
	testUserID   = "3f0f8b2e-2c53-4a2c-9f0a-1d2e3f4a5b6c"
	testClientID = "fintcart-spa"
	testRedirect = "https://app.fintcart.co/callback"
	// Verificador y challenge PKCE que se corresponden entre sí, según el RFC 7636
	// §4.2: challenge = BASE64URL-SIN-RELLENO(SHA256(ASCII(verifier))).
	//
	// El challenge va escrito a mano y NO calculado en el test. Calcularlo con el
	// mismo `sha256`+`base64.RawURLEncoding` que usa la implementación haría que la
	// prueba pasara aunque los dos estuvieran mal —por ejemplo, con relleno `=`, que
	// es el error clásico y rompe la interoperabilidad con cualquier cliente OAuth2
	// real—. Un valor fijo obliga a que la implementación coincida con el RFC.
	testVerifier  = "verificador-pkce-de-prueba-suficientemente-largo"
	testChallenge = "NaV4YBHhoAGzazTI7KKVMNgKJjYFZ_Q8SjJPKgwmcOY"
)

// ── dobles de las dependencias de `server` ──────────────────────────────────
//
// Son dobles a mano y no generados: cada uno tiene dos o tres métodos con
// comportamiento configurable, y un generador añadiría una herramienta al proyecto
// para ahorrar menos código del que ocupa su configuración.

type fakeStore struct {
	storer.Storer

	client     storer.OAuthClientRow
	clientErr  error
	authCode   storer.AuthCodeRow
	consumeErr error
	credential storer.CredentialRow
	credErr    error
	inserted   *storer.AuthCodeRow
}

func (f *fakeStore) GetOAuthClient(context.Context, string) (storer.OAuthClientRow, error) {
	return f.client, f.clientErr
}

func (f *fakeStore) InsertAuthCode(_ context.Context, c storer.AuthCodeRow) error {
	f.inserted = &c
	return nil
}

func (f *fakeStore) ConsumeAuthCode(context.Context, string) (storer.AuthCodeRow, error) {
	return f.authCode, f.consumeErr
}

func (f *fakeStore) GetCredential(context.Context, uuid.UUID) (storer.CredentialRow, error) {
	return f.credential, f.credErr
}

func (f *fakeStore) GetCredentialByEmail(context.Context, string) (storer.CredentialRow, error) {
	return f.credential, f.credErr
}

type fakeTokens struct {
	storer.TokenStore

	blacklisted map[string]bool
	saved       map[string]uuid.UUID
	// used son los tokens ya rotados: la marca que hace detectable una reutilización.
	used        map[string]uuid.UUID
	invalidated []uuid.UUID
	lookupErr   error
}

func newFakeTokens() *fakeTokens {
	return &fakeTokens{
		blacklisted: map[string]bool{},
		saved:       map[string]uuid.UUID{},
		used:        map[string]uuid.UUID{},
	}
}

func (f *fakeTokens) BlacklistJTI(_ context.Context, jti string, _ time.Duration) error {
	f.blacklisted[jti] = true
	return nil
}

func (f *fakeTokens) IsBlacklisted(_ context.Context, jti string) (bool, error) {
	return f.blacklisted[jti], nil
}

func (f *fakeTokens) SaveRefreshToken(_ context.Context, id string, userID uuid.UUID, _ time.Duration) error {
	f.saved[id] = userID
	return nil
}

// LookupRefreshToken reproduce los TRES resultados del contrato, incluido el que
// devuelve usuario Y error a la vez: sin él, la prueba de detección de robo no
// podría distinguirse de un token simplemente caducado.
func (f *fakeTokens) LookupRefreshToken(_ context.Context, id string) (uuid.UUID, error) {
	if f.lookupErr != nil {
		return uuid.Nil, f.lookupErr
	}
	if userID, ok := f.used[id]; ok {
		return userID, storer.ErrTokenReuse
	}
	userID, ok := f.saved[id]
	if !ok {
		return uuid.Nil, storer.ErrNotFound
	}
	return userID, nil
}

// RotateRefreshToken MARCA el token viejo en lugar de borrarlo, igual que el script
// Lua de producción. Borrarlo aquí haría que la prueba de reutilización pasara con
// una implementación que no detecta nada.
func (f *fakeTokens) RotateRefreshToken(_ context.Context, oldID, newID string, userID uuid.UUID, _ time.Duration) error {
	if _, ok := f.used[oldID]; ok {
		return storer.ErrTokenReuse
	}
	owner, ok := f.saved[oldID]
	if !ok {
		return storer.ErrNotFound
	}
	if owner != userID {
		return storer.ErrConflict
	}
	delete(f.saved, oldID)
	f.used[oldID] = owner
	f.saved[newID] = userID
	return nil
}

func (f *fakeTokens) InvalidateFamily(_ context.Context, userID uuid.UUID) error {
	f.invalidated = append(f.invalidated, userID)
	for id, owner := range f.saved {
		if owner == userID {
			delete(f.saved, id)
		}
	}
	return nil
}

func (f *fakeTokens) DeleteRefreshToken(_ context.Context, id string) error {
	delete(f.saved, id)
	return nil
}

// fakeHasher acepta la contraseña cuyo «hash» es `hash:<contraseña>`.
//
// No usa Argon2id a propósito: derivar 64 MiB por caso haría estas pruebas
// inaceptablemente lentas, y lo que se comprueba aquí es el contrato de transporte,
// no la criptografía (eso es `internal/util/password_test.go`).
type fakeHasher struct{}

func (fakeHasher) Hash(plain string) (string, error) { return "hash:" + plain, nil }

func (fakeHasher) Verify(hash, plain string) (bool, error) { return hash == "hash:"+plain, nil }

type fakeMaker struct {
	issued  server.AccessToken
	claims  server.AccessClaims
	parseOK bool
}

func (f *fakeMaker) Issue(string, []string, []string) (server.AccessToken, error) {
	return f.issued, nil
}

func (f *fakeMaker) Parse(string) (server.AccessClaims, error) {
	if !f.parseOK {
		return server.AccessClaims{}, errors.New("token inválido")
	}
	return f.claims, nil
}

type fakeRoles struct{ roles []string }

func (f fakeRoles) Roles(context.Context, string) ([]string, error) { return f.roles, nil }

// fakePublisher registra lo publicado.
//
// No tiene forma de fallar, y no la necesita: el puerto [server.EventPublisher] no
// devuelve error a propósito, así que «el bus está caído» es indistinguible de «el
// bus funciona» desde la capa de aplicación —que es justo la propiedad que se quiere,
// y la que comprueba `TestRevokeSucceedsEvenIfNobodyPublishes` con un publicador que
// no hace nada—.
type fakePublisher struct {
	published []server.Event
}

func (f *fakePublisher) Publish(_ context.Context, event server.Event) {
	f.published = append(f.published, event)
}

// deafPublisher es un bus que se traga todo: reproduce a RabbitMQ caído.
type deafPublisher struct{}

func (deafPublisher) Publish(context.Context, server.Event) {}

// ── arranque de la pila real ────────────────────────────────────────────────

// startServer levanta el servidor gRPC completo sobre `bufconn` y devuelve el
// cliente GENERADO.
//
// Se usa el cliente generado y no una llamada directa al handler porque solo así se
// ejercita la serialización protobuf: un campo renombrado en el `.proto` rompe aquí,
// que es exactamente el fallo que estas pruebas existen para atrapar.
func startServer(t *testing.T, store storer.Storer, tokens storer.TokenStore, maker server.TokenMaker) authv1.AuthServiceClient {
	t.Helper()
	return startServerWithEvents(t, store, tokens, maker, &fakePublisher{})
}

// startServerWithEvents es la variante para las pruebas que observan lo publicado.
func startServerWithEvents(
	t *testing.T,
	store storer.Storer,
	tokens storer.TokenStore,
	maker server.TokenMaker,
	publisher server.EventPublisher,
) authv1.AuthServiceClient {
	t.Helper()

	svc := server.New(store, tokens, fakeHasher{}, maker, fakeRoles{roles: []string{"usuario_final"}}, publisher)
	grpcServer := grpc.NewServer()
	handler.New(svc).Register(grpcServer)

	lis := bufconn.Listen(1024 * 1024)
	go func() { _ = grpcServer.Serve(lis) }()

	conn, err := grpc.NewClient("passthrough:///bufnet",
		grpc.WithContextDialer(func(ctx context.Context, _ string) (net.Conn, error) {
			return lis.DialContext(ctx)
		}),
		grpc.WithTransportCredentials(insecure.NewCredentials()),
	)
	require.NoError(t, err)

	t.Cleanup(func() {
		_ = conn.Close()
		grpcServer.Stop()
		_ = lis.Close()
	})

	return authv1.NewAuthServiceClient(conn)
}

// activeCredentialRow es la cuenta verificada y en uso.
//
// Existe como ayudante porque desde T091 el estado de la cuenta se comprueba en los
// TRES puntos de emisión, y una fila con `login_status` vacío ya no emite nada. El
// valor cero de `CredentialRow` es, por tanto, una cuenta que no puede entrar — que
// es el lado correcto en el que equivocarse.
func activeCredentialRow() storer.CredentialRow {
	return storer.CredentialRow{ID: uuid.MustParse(testUserID), LoginStatus: storer.StatusActive}
}

func publicClientRow() storer.OAuthClientRow {
	return storer.OAuthClientRow{
		ClientID:     testClientID,
		GrantTypes:   []string{"authorization_code", "refresh_token"},
		RedirectURIs: []string{testRedirect},
		Scopes:       []string{"catalog:read"},
		IsPublic:     true,
	}
}

// ── pruebas ─────────────────────────────────────────────────────────────────

func TestIssueAuthorizationCodeContract(t *testing.T) {
	t.Parallel()
	store := &fakeStore{client: publicClientRow(), credential: activeCredentialRow()}
	client := startServer(t, store, newFakeTokens(), &fakeMaker{})

	resp, err := client.IssueAuthorizationCode(context.Background(), &authv1.IssueAuthCodeRequest{
		UserId:              testUserID,
		ClientId:            testClientID,
		RedirectUri:         testRedirect,
		CodeChallenge:       testChallenge,
		CodeChallengeMethod: "S256",
		Scopes:              []string{"catalog:read"},
	})
	require.NoError(t, err)
	require.NotEmpty(t, resp.GetCode())

	// El código persistido lleva el challenge del cliente, no uno recalculado: es lo
	// único que atará el canje posterior a quien inició el flujo.
	require.NotNil(t, store.inserted)
	require.Equal(t, testChallenge, store.inserted.CodeChallenge)
	require.Equal(t, "S256", store.inserted.CodeChallengeMethod)
}

// TestIssueAuthorizationCodeRejectsPlainPKCE: `plain` envía el verificador tal cual,
// así que quien intercepte la petición de autorización puede canjear el código igual
// que si PKCE no existiera. El CHECK del esquema lo prohíbe y la capa de aplicación
// también.
func TestIssueAuthorizationCodeRejectsPlainPKCE(t *testing.T) {
	t.Parallel()
	client := startServer(t, &fakeStore{client: publicClientRow()}, newFakeTokens(), &fakeMaker{})

	_, err := client.IssueAuthorizationCode(context.Background(), &authv1.IssueAuthCodeRequest{
		UserId:              testUserID,
		ClientId:            testClientID,
		RedirectUri:         testRedirect,
		CodeChallenge:       testChallenge,
		CodeChallengeMethod: "plain",
	})
	require.Equal(t, codes.InvalidArgument, status.Code(err))
}

// TestIssueAuthorizationCodeRejectsUnregisteredRedirect: la comparación es EXACTA.
// Por prefijo, un cliente que registre `.../callback` aceptaría
// `.../callback.atacante.com` y el código se entregaría a otro sitio.
func TestIssueAuthorizationCodeRejectsUnregisteredRedirect(t *testing.T) {
	t.Parallel()
	store := &fakeStore{client: publicClientRow(), credential: activeCredentialRow()}
	client := startServer(t, store, newFakeTokens(), &fakeMaker{})

	_, err := client.IssueAuthorizationCode(context.Background(), &authv1.IssueAuthCodeRequest{
		UserId:              testUserID,
		ClientId:            testClientID,
		RedirectUri:         testRedirect + ".atacante.co",
		CodeChallenge:       testChallenge,
		CodeChallengeMethod: "S256",
	})
	require.Equal(t, codes.InvalidArgument, status.Code(err))
}

func TestIssueAuthorizationCodeRejectsUngrantedScope(t *testing.T) {
	t.Parallel()
	store := &fakeStore{client: publicClientRow(), credential: activeCredentialRow()}
	client := startServer(t, store, newFakeTokens(), &fakeMaker{})

	_, err := client.IssueAuthorizationCode(context.Background(), &authv1.IssueAuthCodeRequest{
		UserId:              testUserID,
		ClientId:            testClientID,
		RedirectUri:         testRedirect,
		CodeChallenge:       testChallenge,
		CodeChallengeMethod: "S256",
		Scopes:              []string{"editorial:publish"},
	})
	require.Equal(t, codes.InvalidArgument, status.Code(err))
}

func TestExchangeCodeContract(t *testing.T) {
	t.Parallel()
	userID := uuid.MustParse(testUserID)
	store := &fakeStore{
		client: publicClientRow(),
		authCode: storer.AuthCodeRow{
			Code: "codigo", ClientID: testClientID, UserID: userID,
			CodeChallenge: testChallenge, CodeChallengeMethod: "S256",
			RedirectURI: testRedirect, Scopes: []string{"catalog:read"},
		},
		credential: storer.CredentialRow{ID: userID, LoginStatus: storer.StatusActive},
	}
	maker := &fakeMaker{issued: server.AccessToken{
		Raw: "access", JTI: "jti-1", ExpiresAt: time.Now().Add(15 * time.Minute),
	}}
	tokens := newFakeTokens()
	client := startServer(t, store, tokens, maker)

	resp, err := client.ExchangeCode(context.Background(), &authv1.ExchangeCodeRequest{
		Code: "codigo", CodeVerifier: testVerifier, ClientId: testClientID, RedirectUri: testRedirect,
	})
	require.NoError(t, err)
	require.Equal(t, "access", resp.GetAccessToken())
	require.NotEmpty(t, resp.GetRefreshToken())
	require.Equal(t, "Bearer", resp.GetTokenType())
	require.Positive(t, resp.GetExpiresIn())

	// El refresh se guarda ANTES de devolverlo, y bajo su hash: en Redis nunca está
	// el valor que el cliente presenta.
	require.Len(t, tokens.saved, 1)
	for id := range tokens.saved {
		require.NotEqual(t, resp.GetRefreshToken(), id)
	}
}

// TestExchangeCodeRejectsWrongVerifier es la prueba central de PKCE: sin secreto de
// cliente, el verificador es lo ÚNICO que ata el canje a quien inició el flujo.
func TestExchangeCodeRejectsWrongVerifier(t *testing.T) {
	t.Parallel()
	store := &fakeStore{
		authCode: storer.AuthCodeRow{
			Code: "codigo", ClientID: testClientID, UserID: uuid.MustParse(testUserID),
			CodeChallenge: testChallenge, RedirectURI: testRedirect,
		},
	}
	client := startServer(t, store, newFakeTokens(), &fakeMaker{})

	_, err := client.ExchangeCode(context.Background(), &authv1.ExchangeCodeRequest{
		Code: "codigo", CodeVerifier: "verificador-equivocado", ClientId: testClientID, RedirectUri: testRedirect,
	})
	require.Equal(t, codes.Unauthenticated, status.Code(err))
}

// TestExchangeCodeRejectsAnotherClient: PKCE protege el canje pero no dice a QUIÉN se
// entrega. Sin esta comprobación, otro cliente podría canjear un código ajeno.
func TestExchangeCodeRejectsAnotherClient(t *testing.T) {
	t.Parallel()
	store := &fakeStore{
		authCode: storer.AuthCodeRow{
			Code: "codigo", ClientID: testClientID, UserID: uuid.MustParse(testUserID),
			CodeChallenge: testChallenge, RedirectURI: testRedirect,
		},
		credential: storer.CredentialRow{LoginStatus: storer.StatusActive},
	}
	client := startServer(t, store, newFakeTokens(), &fakeMaker{})

	_, err := client.ExchangeCode(context.Background(), &authv1.ExchangeCodeRequest{
		Code: "codigo", CodeVerifier: testVerifier, ClientId: "otro-cliente", RedirectUri: testRedirect,
	})
	require.Equal(t, codes.InvalidArgument, status.Code(err))
}

// TestExchangeCodeRejectsAnonymizedAccount: entre emitir el código y canjearlo caben
// 45 segundos, y una anonimización en ese hueco no puede acabar en un token válido
// (FR-030).
func TestExchangeCodeRejectsAnonymizedAccount(t *testing.T) {
	t.Parallel()
	userID := uuid.MustParse(testUserID)
	store := &fakeStore{
		authCode: storer.AuthCodeRow{
			Code: "codigo", ClientID: testClientID, UserID: userID,
			CodeChallenge: testChallenge, RedirectURI: testRedirect,
		},
		credential: storer.CredentialRow{ID: userID, LoginStatus: storer.StatusAnonymized},
	}
	client := startServer(t, store, newFakeTokens(), &fakeMaker{})

	_, err := client.ExchangeCode(context.Background(), &authv1.ExchangeCodeRequest{
		Code: "codigo", CodeVerifier: testVerifier, ClientId: testClientID, RedirectUri: testRedirect,
	})
	require.Equal(t, codes.Unauthenticated, status.Code(err))
}

func TestExchangeCodeRejectsConsumedCode(t *testing.T) {
	t.Parallel()
	store := &fakeStore{consumeErr: storer.ErrConflict}
	client := startServer(t, store, newFakeTokens(), &fakeMaker{})

	_, err := client.ExchangeCode(context.Background(), &authv1.ExchangeCodeRequest{
		Code: "codigo", CodeVerifier: testVerifier, ClientId: testClientID, RedirectUri: testRedirect,
	})
	require.Equal(t, codes.FailedPrecondition, status.Code(err))
}

func TestValidateCredentialsContract(t *testing.T) {
	t.Parallel()
	userID := uuid.MustParse(testUserID)
	store := &fakeStore{credential: storer.CredentialRow{
		ID: userID, Email: "ana@fintcart.co", PasswordHash: "hash:contraseña-valida-123",
		LoginStatus: storer.StatusActive,
	}}
	client := startServer(t, store, newFakeTokens(), &fakeMaker{})

	resp, err := client.ValidateCredentials(context.Background(), &authv1.ValidateCredentialsRequest{
		Email: "ana@fintcart.co", Password: "contraseña-valida-123",
	})
	require.NoError(t, err)
	require.True(t, resp.GetValid())
	require.Equal(t, testUserID, resp.GetUserId())
	require.True(t, resp.GetEmailVerified())
}

// TestValidateCredentialsIsNotAnOracle: correo inexistente y contraseña incorrecta
// dan EXACTAMENTE la misma respuesta. Distinguirlos convertiría el login en un
// oráculo de qué correos están registrados.
func TestValidateCredentialsIsNotAnOracle(t *testing.T) {
	t.Parallel()

	unknownEmail := startServer(t, &fakeStore{credErr: storer.ErrNotFound}, newFakeTokens(), &fakeMaker{})
	respUnknown, err := unknownEmail.ValidateCredentials(context.Background(), &authv1.ValidateCredentialsRequest{
		Email: "nadie@fintcart.co", Password: "lo-que-sea-12345",
	})
	require.NoError(t, err)

	wrongPassword := startServer(t, &fakeStore{credential: storer.CredentialRow{
		PasswordHash: "hash:la-buena-12345", LoginStatus: storer.StatusActive,
	}}, newFakeTokens(), &fakeMaker{})
	respWrong, err := wrongPassword.ValidateCredentials(context.Background(), &authv1.ValidateCredentialsRequest{
		Email: "ana@fintcart.co", Password: "la-mala-123456",
	})
	require.NoError(t, err)

	require.False(t, respUnknown.GetValid())
	require.False(t, respWrong.GetValid())
	require.Equal(t, respUnknown.GetUserId(), respWrong.GetUserId())
	require.Equal(t, respUnknown.GetLoginStatus(), respWrong.GetLoginStatus())
}

// ── FR-002: el acceso pleno espera a la verificación del correo (T091) ──────
//
// Las cuatro pruebas siguientes recorren los CUATRO sitios donde una cuenta sin
// verificar podría colarse. No son una sola comprobación repetida: cada punto abre
// una ventana temporal distinta —el login, la emisión del código, el canje 45 s
// después y la renovación treinta días después—, y basta con que uno solo no mire el
// estado para que la verificación de correo pase a ser opcional.

// TestValidateCredentialsRejectsUnverifiedAccount: la contraseña es CORRECTA y aun
// así no autentica. El estado sí sale, y el `user_id` no: quien llama necesita poder
// decir «revisa tu correo», y no necesita un identificador con el que seguir.
func TestValidateCredentialsRejectsUnverifiedAccount(t *testing.T) {
	t.Parallel()
	store := &fakeStore{credential: storer.CredentialRow{
		ID: uuid.MustParse(testUserID), Email: "ana@fintcart.co",
		PasswordHash: "hash:contraseña-valida-123",
		LoginStatus:  storer.StatusPendingVerification,
	}}
	client := startServer(t, store, newFakeTokens(), &fakeMaker{})

	resp, err := client.ValidateCredentials(context.Background(), &authv1.ValidateCredentialsRequest{
		Email: "ana@fintcart.co", Password: "contraseña-valida-123",
	})
	require.NoError(t, err)
	require.False(t, resp.GetValid())
	require.False(t, resp.GetEmailVerified())
	require.Equal(t, storer.StatusPendingVerification, resp.GetLoginStatus())
	require.Empty(t, resp.GetUserId())
}

// TestValidateCredentialsUsesAWhitelistOfStatuses: un estado que el código no conoce
// —uno añadido al esquema después— NO autentica. Es la prueba de que la comprobación
// es una lista blanca; con una lista negra, este caso pasaría y una cuenta suspendida
// entraría con normalidad hasta que alguien lo notara.
func TestValidateCredentialsUsesAWhitelistOfStatuses(t *testing.T) {
	t.Parallel()
	store := &fakeStore{credential: storer.CredentialRow{
		ID: uuid.MustParse(testUserID), PasswordHash: "hash:contraseña-valida-123",
		LoginStatus: "suspended",
	}}
	client := startServer(t, store, newFakeTokens(), &fakeMaker{})

	resp, err := client.ValidateCredentials(context.Background(), &authv1.ValidateCredentialsRequest{
		Email: "ana@fintcart.co", Password: "contraseña-valida-123",
	})
	require.NoError(t, err)
	require.False(t, resp.GetValid())
	require.Empty(t, resp.GetUserId())
}

// TestIssueAuthorizationCodeRejectsUnverifiedAccount: el código de autorización es un
// token en todo lo que importa —quien lo tiene obtiene una sesión—, así que emitirlo
// para una cuenta sin verificar convertiría FR-002 en un trámite saltable.
func TestIssueAuthorizationCodeRejectsUnverifiedAccount(t *testing.T) {
	t.Parallel()
	store := &fakeStore{
		client: publicClientRow(),
		credential: storer.CredentialRow{
			ID: uuid.MustParse(testUserID), LoginStatus: storer.StatusPendingVerification,
		},
	}
	client := startServer(t, store, newFakeTokens(), &fakeMaker{})

	_, err := client.IssueAuthorizationCode(context.Background(), &authv1.IssueAuthCodeRequest{
		UserId:              testUserID,
		ClientId:            testClientID,
		RedirectUri:         testRedirect,
		CodeChallenge:       testChallenge,
		CodeChallengeMethod: "S256",
	})
	require.Equal(t, codes.Unauthenticated, status.Code(err))

	// Y no llegó a persistirse ningún código: la cuenta se comprueba ANTES de emitir,
	// no después. Un código guardado y luego rechazado seguiría siendo canjeable si
	// alguna otra ruta lo consumiera.
	require.Nil(t, store.inserted)
}

// TestExchangeCodeRejectsUnverifiedAccount cubre la ventana de 45 segundos entre
// emitir el código y canjearlo.
func TestExchangeCodeRejectsUnverifiedAccount(t *testing.T) {
	t.Parallel()
	userID := uuid.MustParse(testUserID)
	store := &fakeStore{
		authCode: storer.AuthCodeRow{
			Code: "codigo", ClientID: testClientID, UserID: userID,
			CodeChallenge: testChallenge, RedirectURI: testRedirect,
		},
		credential: storer.CredentialRow{ID: userID, LoginStatus: storer.StatusPendingVerification},
	}
	client := startServer(t, store, newFakeTokens(), &fakeMaker{})

	_, err := client.ExchangeCode(context.Background(), &authv1.ExchangeCodeRequest{
		Code: "codigo", CodeVerifier: testVerifier, ClientId: testClientID, RedirectUri: testRedirect,
	})
	require.Equal(t, codes.Unauthenticated, status.Code(err))
}

// TestRefreshTokenRejectsAnonymizedAccount es el caso que hace que la comprobación en
// la renovación no sea redundante: la sesión era legítima cuando empezó. Un refresh
// token vive treinta días, así que sin esta comprobación una cuenta anonimizada el
// martes seguiría produciendo access tokens válidos durante casi un mes, y FR-030
// sería una promesa a plazo en lugar de un efecto.
func TestRefreshTokenRejectsAnonymizedAccount(t *testing.T) {
	t.Parallel()
	userID := uuid.MustParse(testUserID)
	tokens := newFakeTokens()
	store := &fakeStore{
		client: publicClientRow(),
		authCode: storer.AuthCodeRow{
			Code: "codigo", ClientID: testClientID, UserID: userID,
			CodeChallenge: testChallenge, RedirectURI: testRedirect,
		},
		credential: activeCredentialRow(),
	}
	maker := &fakeMaker{issued: server.AccessToken{
		Raw: "access", JTI: "jti-1", ExpiresAt: time.Now().Add(15 * time.Minute),
	}}
	client := startServer(t, store, tokens, maker)

	// La sesión se abre con la cuenta activa.
	pair, err := client.ExchangeCode(context.Background(), &authv1.ExchangeCodeRequest{
		Code: "codigo", CodeVerifier: testVerifier, ClientId: testClientID, RedirectUri: testRedirect,
	})
	require.NoError(t, err)

	// Y se anonimiza mientras está viva.
	store.credential = storer.CredentialRow{ID: userID, LoginStatus: storer.StatusAnonymized}

	_, err = client.RefreshToken(context.Background(), &authv1.RefreshTokenRequest{
		RefreshToken: pair.GetRefreshToken(),
	})
	require.Equal(t, codes.Unauthenticated, status.Code(err))
}

func TestRefreshTokenRotatesContract(t *testing.T) {
	t.Parallel()
	userID := uuid.MustParse(testUserID)
	tokens := newFakeTokens()
	maker := &fakeMaker{issued: server.AccessToken{
		Raw: "access-2", JTI: "jti-2", ExpiresAt: time.Now().Add(15 * time.Minute),
	}}
	store := &fakeStore{
		client: publicClientRow(),
		authCode: storer.AuthCodeRow{
			Code: "codigo", ClientID: testClientID, UserID: userID,
			CodeChallenge: testChallenge, RedirectURI: testRedirect,
		},
		credential: storer.CredentialRow{ID: userID, LoginStatus: storer.StatusActive},
	}
	client := startServer(t, store, tokens, maker)

	// Se obtiene un refresh real a través del canje, en lugar de fabricarlo: así la
	// prueba recorre la misma derivación de identificador que usa producción.
	pair, err := client.ExchangeCode(context.Background(), &authv1.ExchangeCodeRequest{
		Code: "codigo", CodeVerifier: testVerifier, ClientId: testClientID, RedirectUri: testRedirect,
	})
	require.NoError(t, err)

	refreshed, err := client.RefreshToken(context.Background(), &authv1.RefreshTokenRequest{
		RefreshToken: pair.GetRefreshToken(),
	})
	require.NoError(t, err)
	require.Equal(t, "access-2", refreshed.GetAccessToken())
	// El refresh devuelto es NUEVO: la rotación es obligatoria (D-05).
	require.NotEqual(t, pair.GetRefreshToken(), refreshed.GetRefreshToken())

	// Y el anterior ya no vale. Sin esto, un refresh filtrado sería una sesión
	// perpetua que nadie puede cerrar.
	_, err = client.RefreshToken(context.Background(), &authv1.RefreshTokenRequest{
		RefreshToken: pair.GetRefreshToken(),
	})
	require.Equal(t, codes.Unauthenticated, status.Code(err))

	// Presentar el token ya rotado NO es solo un rechazo: dispara el corte de la
	// familia entera (D-05). Es la diferencia entre detectar un robo y limitarse a
	// ignorar un token caducado, y es lo que deja al ladrón sin nada.
	require.Equal(t, []uuid.UUID{userID}, tokens.invalidated)

	// El refresh que el usuario legítimo tenía en la mano también cae. Es el precio
	// de la detección: los dos vuelven a autenticarse, y el ladrón no puede.
	_, err = client.RefreshToken(context.Background(), &authv1.RefreshTokenRequest{
		RefreshToken: refreshed.GetRefreshToken(),
	})
	require.Equal(t, codes.Unauthenticated, status.Code(err))
}

func TestIntrospectContract(t *testing.T) {
	t.Parallel()
	expiry := time.Now().Add(10 * time.Minute).Truncate(time.Second)
	maker := &fakeMaker{parseOK: true, claims: server.AccessClaims{
		UserID: testUserID, JTI: "jti-1", ExpiresAt: expiry,
	}}
	client := startServer(t, &fakeStore{}, newFakeTokens(), maker)

	resp, err := client.Introspect(context.Background(), &authv1.IntrospectRequest{AccessToken: "access"})
	require.NoError(t, err)
	require.True(t, resp.GetActive())
	require.Equal(t, testUserID, resp.GetUserId())
	require.Equal(t, []string{"usuario_final"}, resp.GetRoles())
	require.Equal(t, expiry.Unix(), resp.GetExp())
}

// TestIntrospectHidesDetailsOfInactiveTokens: la respuesta de un token revocado no
// debe filtrar a quién pertenecía ni qué roles tenía.
func TestIntrospectHidesDetailsOfInactiveTokens(t *testing.T) {
	t.Parallel()
	tokens := newFakeTokens()
	tokens.blacklisted["jti-1"] = true
	maker := &fakeMaker{parseOK: true, claims: server.AccessClaims{
		UserID: testUserID, JTI: "jti-1", ExpiresAt: time.Now().Add(time.Minute),
	}}
	client := startServer(t, &fakeStore{}, tokens, maker)

	resp, err := client.Introspect(context.Background(), &authv1.IntrospectRequest{AccessToken: "access"})
	require.NoError(t, err)
	require.False(t, resp.GetActive())
	require.Empty(t, resp.GetUserId())
	require.Empty(t, resp.GetRoles())
	require.Zero(t, resp.GetExp())
}

// TestRevokeBlacklistsAccessToken comprueba el efecto INMEDIATO de FR-004: un JWT es
// autovalidable, así que sin la blacklist seguiría siendo aceptado hasta expirar.
func TestRevokeBlacklistsAccessToken(t *testing.T) {
	t.Parallel()
	tokens := newFakeTokens()
	maker := &fakeMaker{parseOK: true, claims: server.AccessClaims{
		UserID: testUserID, JTI: "jti-1", ExpiresAt: time.Now().Add(10 * time.Minute),
	}}
	client := startServer(t, &fakeStore{}, tokens, maker)

	_, err := client.Revoke(context.Background(), &authv1.RevokeRequest{Token: "access"})
	require.NoError(t, err)
	require.True(t, tokens.blacklisted["jti-1"])
}

// TestRevokeIsIdempotent: el RFC 7009 §2.2 exige que revocar algo que ya no vale no
// sea un error — el efecto buscado ya se cumplió.
func TestRevokeIsIdempotent(t *testing.T) {
	t.Parallel()
	client := startServer(t, &fakeStore{}, newFakeTokens(), &fakeMaker{parseOK: false})

	_, err := client.Revoke(context.Background(), &authv1.RevokeRequest{Token: "refresh-que-ya-no-existe"})
	require.NoError(t, err)
}

func TestRevokeRejectsEmptyToken(t *testing.T) {
	t.Parallel()
	client := startServer(t, &fakeStore{}, newFakeTokens(), &fakeMaker{})

	_, err := client.Revoke(context.Background(), &authv1.RevokeRequest{Token: ""})
	require.Equal(t, codes.InvalidArgument, status.Code(err))
}

// ── FR-004: la revocación queda auditada (T092) ─────────────────────────────

// TestRevokePublishesSessionRevoked comprueba el evento del catálogo: el titular
// viaja como referencia OPACA y el payload distingue qué tipo de token se cerró.
func TestRevokePublishesSessionRevoked(t *testing.T) {
	t.Parallel()
	events := &fakePublisher{}
	maker := &fakeMaker{parseOK: true, claims: server.AccessClaims{
		UserID: testUserID, JTI: "jti-1", ExpiresAt: time.Now().Add(10 * time.Minute),
	}}
	client := startServerWithEvents(t, &fakeStore{}, newFakeTokens(), maker, events)

	_, err := client.Revoke(context.Background(), &authv1.RevokeRequest{Token: "access"})
	require.NoError(t, err)

	require.Len(t, events.published, 1)
	got := events.published[0]
	require.Equal(t, server.EventAuthSessionRevoked, got.Type)
	require.Equal(t, testUserID, got.ActorRef)
	require.Equal(t, "access_token", got.Payload["token_type"])
	require.Equal(t, "jti-1", got.Payload["jti"])
}

// TestRevokePublishesTheOwnerOfARefreshToken: un refresh token no es un JWT y no
// lleva dentro a su dueño, así que hay que consultarlo ANTES de borrarlo. Si el
// orden se invirtiera, el evento saldría sin actor y la traza no serviría para nada.
func TestRevokePublishesTheOwnerOfARefreshToken(t *testing.T) {
	t.Parallel()
	userID := uuid.MustParse(testUserID)
	events := &fakePublisher{}
	tokens := newFakeTokens()
	store := &fakeStore{
		client: publicClientRow(),
		authCode: storer.AuthCodeRow{
			Code: "codigo", ClientID: testClientID, UserID: userID,
			CodeChallenge: testChallenge, RedirectURI: testRedirect,
		},
		credential: activeCredentialRow(),
	}
	maker := &fakeMaker{issued: server.AccessToken{
		Raw: "access", JTI: "jti-1", ExpiresAt: time.Now().Add(15 * time.Minute),
	}}
	client := startServerWithEvents(t, store, tokens, maker, events)

	pair, err := client.ExchangeCode(context.Background(), &authv1.ExchangeCodeRequest{
		Code: "codigo", CodeVerifier: testVerifier, ClientId: testClientID, RedirectUri: testRedirect,
	})
	require.NoError(t, err)

	// El `fakeMaker` no parsea, así que el token entra por la rama de refresh, igual
	// que un refresh real —que no es un JWT—.
	_, err = client.Revoke(context.Background(), &authv1.RevokeRequest{Token: pair.GetRefreshToken()})
	require.NoError(t, err)

	require.Len(t, events.published, 1)
	require.Equal(t, testUserID, events.published[0].ActorRef)
	require.Equal(t, "refresh_token", events.published[0].Payload["token_type"])
	// Sin `jti`: un refresh token no tiene identificador de JWT, y anotar una clave
	// vacía haría creer a Auditoría que se revocó un access token sin identificar.
	require.NotContains(t, events.published[0].Payload, "jti")
}

// TestRevokeAuditsOnlyWhatItRevoked: presentar un token que ya no existe es un caso
// LEGÍTIMO (RFC 7009 §2.2) y no cierra ninguna sesión. Auditarlo llenaría el registro
// de revocaciones que nunca ocurrieron, que es lo que hace inservible una traza.
func TestRevokeAuditsOnlyWhatItRevoked(t *testing.T) {
	t.Parallel()
	events := &fakePublisher{}
	client := startServerWithEvents(t, &fakeStore{}, newFakeTokens(), &fakeMaker{parseOK: false}, events)

	_, err := client.Revoke(context.Background(), &authv1.RevokeRequest{Token: "refresh-que-ya-no-existe"})
	require.NoError(t, err)
	require.Empty(t, events.published)
}

// TestRevokeDoesNotAuditAnExpiredAccessToken: un token caducado ya no vale por sí
// solo, así que no se añade a la blacklist y no hay revocación que anotar.
func TestRevokeDoesNotAuditAnExpiredAccessToken(t *testing.T) {
	t.Parallel()
	events := &fakePublisher{}
	tokens := newFakeTokens()
	maker := &fakeMaker{parseOK: true, claims: server.AccessClaims{
		UserID: testUserID, JTI: "jti-viejo", ExpiresAt: time.Now().Add(-time.Minute),
	}}
	client := startServerWithEvents(t, &fakeStore{}, tokens, maker, events)

	_, err := client.Revoke(context.Background(), &authv1.RevokeRequest{Token: "access-caducado"})
	require.NoError(t, err)
	require.Empty(t, events.published)
	require.Empty(t, tokens.blacklisted)
}

// TestRevokeSucceedsEvenIfNobodyPublishes es la prueba de la decisión de diseño del
// puerto: el cierre de sesión NO depende del bus. Un logout que fallara porque
// RabbitMQ está caído le diría al usuario que sigue dentro de una sesión que ya está
// cerrada, y volvería a intentarlo creyéndoselo.
func TestRevokeSucceedsEvenIfNobodyPublishes(t *testing.T) {
	t.Parallel()
	tokens := newFakeTokens()
	maker := &fakeMaker{parseOK: true, claims: server.AccessClaims{
		UserID: testUserID, JTI: "jti-1", ExpiresAt: time.Now().Add(10 * time.Minute),
	}}
	client := startServerWithEvents(t, &fakeStore{}, tokens, maker, deafPublisher{})

	_, err := client.Revoke(context.Background(), &authv1.RevokeRequest{Token: "access"})
	require.NoError(t, err)
	require.True(t, tokens.blacklisted["jti-1"])
}

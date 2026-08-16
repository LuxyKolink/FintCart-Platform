//go:build integration

// Pruebas de integración contra un PostgreSQL 16 REAL, en un contenedor efímero de
// `testcontainers-go` (no el `dev/up` compartido: aísla el ciclo de vida del
// contenedor y no interfiere con una instancia de desarrollo que ya esté corriendo).
//
// §Calidad: separadas del resto de la suite tras el build tag `integration`
// (`go test -tags=integration ./...`) porque lo que se verifica aquí —el REVOKE, el
// trigger, el enrutado real de una partición— no lo puede comprobar `go-sqlmock`, que
// no ejecuta SQL de verdad (ver la nota de `storer_postgres_test.go`/`consumer_test.go`
// en Usuarios y Auditoría). `go test ./...` sin el tag sigue siendo rápido y no toca
// Docker.
package storer

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/require"
	tc "github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/modules/postgres"
	"github.com/testcontainers/testcontainers-go/wait"
)

// migrationScripts localiza los `.up.sql` de `services/audit/migrations`, en orden.
//
// Se leen del disco en vez de incrustarse a mano en el test porque son el mismo
// archivo que aplica `dev/migrate` en desarrollo real: una copia divergente
// verificaría un esquema que el servicio nunca corre.
func migrationScripts(t *testing.T) []string {
	t.Helper()

	dir := filepath.Join("..", "..", "migrations")
	entries, err := os.ReadDir(dir)
	require.NoError(t, err)

	var names []string
	for _, e := range entries {
		if !e.IsDir() && filepath.Ext(e.Name()) == ".sql" && filepath.Base(e.Name()) != "" {
			if len(e.Name()) > 7 && e.Name()[len(e.Name())-7:] == ".up.sql" {
				names = append(names, e.Name())
			}
		}
	}
	sort.Strings(names) // el prefijo `<YYYYMMDDHHMMSS>_` ordena cronológicamente.
	require.NotEmpty(t, names, "no se encontraron migraciones .up.sql en %s", dir)

	paths := make([]string, len(names))
	for i, n := range names {
		paths[i] = filepath.Join(dir, n)
	}
	return paths
}

// newRealDB levanta un PostgreSQL 16 efímero con las migraciones YA aplicadas.
func newRealDB(t *testing.T) *pgxpool.Pool {
	t.Helper()
	ctx := context.Background()

	scripts := migrationScripts(t)
	container, err := postgres.Run(ctx, "postgres:16-alpine",
		postgres.WithDatabase("audit_db"),
		postgres.WithUsername("fintcart"),
		postgres.WithPassword("dev_only_password"),
		postgres.WithInitScripts(scripts...),
		tc.WithWaitStrategy(
			wait.ForLog("database system is ready to accept connections").
				WithOccurrence(2).
				WithStartupTimeout(60*time.Second),
		),
	)
	require.NoError(t, err)
	t.Cleanup(func() {
		require.NoError(t, container.Terminate(context.Background()))
	})

	connStr, err := container.ConnectionString(ctx, "sslmode=disable")
	require.NoError(t, err)

	pool, err := pgxpool.New(ctx, connStr)
	require.NoError(t, err)
	t.Cleanup(pool.Close)

	return pool
}

func insertSampleEntry(t *testing.T, pool *pgxpool.Pool, id, occurredAt string) {
	t.Helper()
	_, err := pool.Exec(context.Background(),
		`INSERT INTO audit_log (id, actor_ref, operation, context, result, occurred_at)
		 VALUES ($1, gen_random_uuid(), 'user.registered', '{}'::jsonb, 'success', $2)`,
		id, occurredAt,
	)
	require.NoError(t, err)
}

// ── T173 — inmutabilidad (FR-025) ───────────────────────────────────────────────

func TestAuditLogRejectsUpdate(t *testing.T) {
	pool := newRealDB(t)
	insertSampleEntry(t, pool, "11111111-1111-1111-1111-111111111111", "2026-08-15T10:00:00Z")

	_, err := pool.Exec(context.Background(),
		`UPDATE audit_log SET result = 'failure' WHERE id = '11111111-1111-1111-1111-111111111111'`)

	require.Error(t, err, "audit_log debe rechazar UPDATE (FR-025): append-only")
	require.Contains(t, err.Error(), "append-only")
}

func TestAuditLogRejectsDelete(t *testing.T) {
	pool := newRealDB(t)
	insertSampleEntry(t, pool, "22222222-2222-2222-2222-222222222222", "2026-08-15T10:00:00Z")

	_, err := pool.Exec(context.Background(),
		`DELETE FROM audit_log WHERE id = '22222222-2222-2222-2222-222222222222'`)

	require.Error(t, err, "audit_log debe rechazar DELETE (FR-025): append-only")
	require.Contains(t, err.Error(), "append-only")
}

func TestAuditLogRejectsUpdateAndDeleteDirectlyOnAPartition(t *testing.T) {
	// El REVOKE y el trigger se repiten por partición (ver la migración de T174):
	// esto prueba que la protección no depende de pasar por la tabla raíz, que es
	// justo la vía que alguien con acceso directo a `audit_log_2026` intentaría.
	pool := newRealDB(t)
	insertSampleEntry(t, pool, "33333333-3333-3333-3333-333333333333", "2026-08-15T10:00:00Z")

	_, updateErr := pool.Exec(context.Background(),
		`UPDATE audit_log_2026 SET result = 'failure' WHERE id = '33333333-3333-3333-3333-333333333333'`)
	require.Error(t, updateErr)

	_, deleteErr := pool.Exec(context.Background(),
		`DELETE FROM audit_log_2026 WHERE id = '33333333-3333-3333-3333-333333333333'`)
	require.Error(t, deleteErr)
}

// ── T174 — particionado anual, retención ≥ 5 años (FR-031) ─────────────────────

func TestAuditLogHasFiveYearsOfPartitions(t *testing.T) {
	pool := newRealDB(t)

	rows, err := pool.Query(context.Background(),
		`SELECT c.relname
		 FROM pg_inherits i
		 JOIN pg_class c ON c.oid = i.inhrelid
		 JOIN pg_class p ON p.oid = i.inhparent
		 WHERE p.relname = 'audit_log'`)
	require.NoError(t, err)
	defer rows.Close()

	found := map[string]bool{}
	for rows.Next() {
		var name string
		require.NoError(t, rows.Scan(&name))
		found[name] = true
	}
	require.NoError(t, rows.Err())

	// 2026 (hoy) hasta 2030 cubre los ≥ 5 años de retención exigidos por FR-031.
	for _, year := range []int{2026, 2027, 2028, 2029, 2030} {
		name := fmt.Sprintf("audit_log_%d", year)
		require.True(t, found[name], "falta la partición %s (retención mínima de 5 años, FR-031)", name)
	}
	require.True(t, found["audit_log_default"], "falta la partición default de resguardo")
}

func TestAuditLogRowRoutesToItsYearPartition(t *testing.T) {
	pool := newRealDB(t)
	insertSampleEntry(t, pool, "44444444-4444-4444-4444-444444444444", "2029-03-10T12:00:00Z")

	var partition string
	err := pool.QueryRow(context.Background(),
		`SELECT tableoid::regclass::text FROM audit_log WHERE id = '44444444-4444-4444-4444-444444444444'`,
	).Scan(&partition)
	require.NoError(t, err)
	require.Equal(t, "audit_log_2029", partition)
}

func TestAuditLogEnsurePartitionIsIdempotent(t *testing.T) {
	pool := newRealDB(t)

	_, err := pool.Exec(context.Background(), `SELECT audit_log_ensure_partition(2028)`)
	require.NoError(t, err, "invocar la función sobre un año que ya existe no debe fallar")

	insertSampleEntry(t, pool, "55555555-5555-5555-5555-555555555555", "2028-06-01T00:00:00Z")

	// La partición reutilizada conserva su REVOKE (no se recreó desde cero).
	_, updateErr := pool.Exec(context.Background(),
		`UPDATE audit_log_2028 SET result = 'failure' WHERE id = '55555555-5555-5555-5555-555555555555'`)
	require.Error(t, updateErr)
}

// Package decimalstr implementa el tipo lógico `DecimalString` de los contratos
// (research D-10): la representación canónica con la que TODO monto, tasa o
// porcentaje cruza una frontera —gRPC, JSON o JSONB— en la plataforma.
//
// Principio VIII (NON-NEGOTIABLE) prohíbe `float`/`double` y los números JSON
// para dinero. El transporte es por tanto `string`, y este paquete es el único
// lugar del servicio donde esa `string` se convierte a `decimal.Decimal` y
// vuelta (Principio IX: la conversión vive en la frontera de mapeo).
//
// El formato canónico es EXACTAMENTE `^-?\d+(\.\d+)?$`:
//
//	"1500000.00"   válido
//	"-0.5"         válido
//	"1.5e3"        RECHAZADO — notación científica
//	"1,500.00"     RECHAZADO — separador de miles
//	"+1.5"         RECHAZADO — signo positivo explícito
//	".5" / "5."    RECHAZADO — falta un lado del punto
//	" 1.5"         RECHAZADO — espacios
//
// Rechazar en lugar de normalizar es deliberado: si dos servicios discrepan en
// la escala o en el formato de un monto, queremos un error en la frontera y no
// un valor silenciosamente distinto en la base de datos.
package decimalstr

import (
	"errors"
	"fmt"
	"regexp"
	"strings"

	"github.com/shopspring/decimal"
)

// canonical es la única sintaxis aceptada. Se comprueba ANTES de entregar la
// cadena a la librería decimal: `decimal.NewFromString` acepta de buen grado
// notación científica ("1e5") y signo positivo, que aquí no son canónicos.
var canonical = regexp.MustCompile(`^-?\d+(\.\d+)?$`)

// Límites de las columnas `NUMERIC` declaradas en data-model.md §Convenciones.
// Validar contra ellos en la frontera evita que un valor viable en memoria
// falle recién al hacer INSERT, cuando ya se perdió el contexto de la petición.
const (
	// MoneyPrecision/MoneyScale corresponden a `NUMERIC(19,2)` — montos (COP).
	MoneyPrecision, MoneyScale = 19, 2
	// RatePrecision/RateScale corresponden a `NUMERIC(9,6)` — tasas y porcentajes.
	RatePrecision, RateScale = 9, 6
	// ScorePrecision/ScoreScale corresponden a `NUMERIC(6,2)` — calificaciones.
	ScorePrecision, ScoreScale = 6, 2
)

// Errores sentinela: el llamador puede distinguir con errors.Is un problema de
// formato (dato mal construido por el emisor) de uno de rango (dato bien
// formado pero que no cabe en la columna), que ameritan respuestas distintas.
var (
	// ErrEmpty indica una cadena vacía.
	ErrEmpty = errors.New("decimalstr: cadena vacía")
	// ErrSyntax indica que la cadena no respeta `^-?\d+(\.\d+)?$`.
	ErrSyntax = errors.New("decimalstr: formato no canónico")
	// ErrScale indica más decimales de los que admite la columna destino.
	ErrScale = errors.New("decimalstr: escala excedida")
	// ErrRange indica que la parte entera no cabe en la columna destino.
	ErrRange = errors.New("decimalstr: valor fuera de rango")
)

// Parse convierte una cadena decimal canónica en decimal.Decimal.
//
// No aplica ningún límite de precisión: para validar contra una columna
// concreta usar ParseMoney, ParseRate, ParseScore o ParseNumeric.
func Parse(s string) (decimal.Decimal, error) {
	if s == "" {
		return decimal.Decimal{}, ErrEmpty
	}
	if !canonical.MatchString(s) {
		return decimal.Decimal{}, fmt.Errorf("%w: %q", ErrSyntax, s)
	}
	d, err := decimal.NewFromString(s)
	if err != nil {
		// Sintaxis ya validada; llegar aquí significa desbordar la
		// representación interna (una parte entera de miles de dígitos).
		return decimal.Decimal{}, fmt.Errorf("%w: %q: %w", ErrRange, s, err)
	}
	return d, nil
}

// ParseNumeric hace lo de Parse y además exige que el valor quepa en una
// columna `NUMERIC(precision, scale)` de PostgreSQL.
//
// La escala se mide sobre los decimales SIGNIFICATIVOS: "1.500" cuenta como
// escala 1, no 3, porque los ceros a la derecha no aportan precisión y
// rechazarlos solo castigaría a un emisor que rellena a un ancho fijo.
func ParseNumeric(s string, precision, scale int32) (decimal.Decimal, error) {
	d, err := Parse(s)
	if err != nil {
		return decimal.Decimal{}, err
	}
	if got := significantScale(s); got > int(scale) {
		return decimal.Decimal{}, fmt.Errorf(
			"%w: %q tiene %d decimales, el máximo es %d", ErrScale, s, got, scale)
	}
	// Cota exacta de PostgreSQL: |valor| < 10^(precision-scale).
	maxAbs := decimal.New(1, precision-scale)
	if d.Abs().GreaterThanOrEqual(maxAbs) {
		return decimal.Decimal{}, fmt.Errorf(
			"%w: %q excede NUMERIC(%d,%d)", ErrRange, s, precision, scale)
	}
	return d, nil
}

// ParseMoney valida un monto contra `NUMERIC(19,2)`.
func ParseMoney(s string) (decimal.Decimal, error) {
	return ParseNumeric(s, MoneyPrecision, MoneyScale)
}

// ParseRate valida una tasa o porcentaje contra `NUMERIC(9,6)`.
func ParseRate(s string) (decimal.Decimal, error) {
	return ParseNumeric(s, RatePrecision, RateScale)
}

// ParseScore valida una calificación contra `NUMERIC(6,2)`.
func ParseScore(s string) (decimal.Decimal, error) {
	return ParseNumeric(s, ScorePrecision, ScoreScale)
}

// Format serializa un decimal a la forma canónica.
//
// Nunca produce notación científica y no deja ceros significativos a la
// derecha, de modo que Format(Parse(s)) es estable: aplicarlo dos veces da el
// mismo resultado.
func Format(d decimal.Decimal) string {
	return trimTrailingZeros(d.String())
}

// FormatFixed serializa con exactamente `scale` decimales, rellenando con
// ceros. Útil para escribir montos con la escala de su columna.
//
// Devuelve error si el valor tiene MÁS decimales significativos que `scale`:
// redondear aquí, en la capa de serialización, escondería una pérdida de
// precisión que el llamador no pidió. Para redondear hay que hacerlo explícito
// con RoundHalfEven (Principio VIII, D-14).
func FormatFixed(d decimal.Decimal, scale int32) (string, error) {
	if got := significantScale(d.String()); got > int(scale) {
		return "", fmt.Errorf(
			"%w: el valor tiene %d decimales, se pidieron %d; usar RoundHalfEven",
			ErrScale, got, scale)
	}
	return d.StringFixed(scale), nil
}

// RoundHalfEven redondea a `scale` decimales con redondeo bancario
// (half-even), el único modo permitido para conversiones y cálculos monetarios
// (research D-14). Es explícito a propósito: ninguna función de este paquete
// redondea por su cuenta.
func RoundHalfEven(d decimal.Decimal, scale int32) decimal.Decimal {
	return d.RoundBank(scale)
}

// significantScale cuenta los decimales de una representación canónica
// ignorando los ceros finales.
//
// Se calcula sobre la cadena y no sobre el exponente interno del decimal
// porque ese exponente conserva los ceros de relleno del emisor: "1.500" se
// almacena como 1500×10⁻³ y su exponente diría 3 decimales cuando solo hay 1.
//
// Devuelve `int` y no `int32` a propósito: `len` es `int`, y estrechar el
// resultado sería una conversión con desbordamiento posible (gosec G115). Los
// llamadores comparan ensanchando la escala, que siempre es seguro.
func significantScale(s string) int {
	dot := strings.IndexByte(s, '.')
	if dot < 0 {
		return 0
	}
	return len(strings.TrimRight(s[dot+1:], "0"))
}

// trimTrailingZeros quita los ceros finales de la parte decimal y el punto si
// queda huérfano, sin tocar nunca la parte entera ("100" no se convierte en "1").
func trimTrailingZeros(s string) string {
	if !strings.ContainsRune(s, '.') {
		return s
	}
	s = strings.TrimRight(s, "0")
	return strings.TrimSuffix(s, ".")
}

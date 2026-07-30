package decimalstr

import (
	"errors"
	"strings"
	"testing"

	"github.com/shopspring/decimal"
)

func TestParseAceptaFormaCanonica(t *testing.T) {
	t.Parallel()
	for _, in := range []string{
		"0",
		"-0",
		"5",
		"123",
		"0.5",
		"-0.5",
		"1500000.00",
		"-1500000.00",
		"0.000000000000000001",
		// Parte entera larguísima: Parse no impone precisión, solo sintaxis.
		strings.Repeat("9", 40),
	} {
		if _, err := Parse(in); err != nil {
			t.Errorf("Parse(%q) devolvió error %v; se esperaba éxito", in, err)
		}
	}
}

func TestParseRechazaNoCanonico(t *testing.T) {
	t.Parallel()
	casos := map[string]struct {
		in   string
		want error
	}{
		"vacío":                  {"", ErrEmpty},
		"científica minúscula":   {"1.5e3", ErrSyntax},
		"científica mayúscula":   {"1.5E3", ErrSyntax},
		"científica sin punto":   {"1e5", ErrSyntax},
		"exponente negativo":     {"1.5e-3", ErrSyntax},
		"separador de miles":     {"1,500.00", ErrSyntax},
		"separador europeo":      {"1.500,00", ErrSyntax},
		"signo positivo":         {"+1.5", ErrSyntax},
		"sin parte entera":       {".5", ErrSyntax},
		"sin parte decimal":      {"5.", ErrSyntax},
		"espacio inicial":        {" 1.5", ErrSyntax},
		"espacio final":          {"1.5 ", ErrSyntax},
		"espacio interno":        {"1 500", ErrSyntax},
		"doble signo":            {"--1", ErrSyntax},
		"doble punto":            {"1.2.3", ErrSyntax},
		"hexadecimal":            {"0x10", ErrSyntax},
		"texto":                  {"abc", ErrSyntax},
		"infinito":               {"Infinity", ErrSyntax},
		"NaN":                    {"NaN", ErrSyntax},
		"solo signo":             {"-", ErrSyntax},
		"guion bajo":             {"1_000", ErrSyntax},
		"moneda":                 {"$1500", ErrSyntax},
		"porcentaje":             {"5%", ErrSyntax},
		"signo al final":         {"1.5-", ErrSyntax},
		"punto y coma decimales": {"1,5", ErrSyntax},
	}
	for nombre, c := range casos {
		t.Run(nombre, func(t *testing.T) {
			t.Parallel()
			_, err := Parse(c.in)
			if !errors.Is(err, c.want) {
				t.Errorf("Parse(%q) devolvió %v; se esperaba %v", c.in, err, c.want)
			}
		})
	}
}

func TestParseMoneyLimitesDeNumeric19_2(t *testing.T) {
	t.Parallel()
	casos := []struct {
		nombre string
		in     string
		want   error // nil = debe aceptarse
	}{
		{"cero", "0", nil},
		{"monto típico COP", "1500000.00", nil},
		{"máximo representable", "99999999999999999.99", nil}, // 17 enteros + 2
		{"máximo negativo", "-99999999999999999.99", nil},
		{"ceros de relleno no cuentan como escala", "1.500", nil},
		{"un entero más que el máximo", "100000000000000000.00", ErrRange},
		{"negativo fuera de rango", "-100000000000000000.00", ErrRange},
		{"tres decimales significativos", "1.001", ErrScale},
		{"escala absurda", "0.000000000000000001", ErrScale},
	}
	for _, c := range casos {
		t.Run(c.nombre, func(t *testing.T) {
			t.Parallel()
			_, err := ParseMoney(c.in)
			switch {
			case c.want == nil && err != nil:
				t.Errorf("ParseMoney(%q) devolvió %v; se esperaba éxito", c.in, err)
			case c.want != nil && !errors.Is(err, c.want):
				t.Errorf("ParseMoney(%q) devolvió %v; se esperaba %v", c.in, err, c.want)
			}
		})
	}
}

func TestParseRateYScoreRespetanSusColumnas(t *testing.T) {
	t.Parallel()
	// Tasas: NUMERIC(9,6) → 3 enteros y 6 decimales.
	if _, err := ParseRate("999.999999"); err != nil {
		t.Errorf("ParseRate(máximo) devolvió %v", err)
	}
	if _, err := ParseRate("1000.0"); !errors.Is(err, ErrRange) {
		t.Errorf("ParseRate(1000.0) devolvió %v; se esperaba ErrRange", err)
	}
	if _, err := ParseRate("0.0000001"); !errors.Is(err, ErrScale) {
		t.Errorf("ParseRate(7 decimales) devolvió %v; se esperaba ErrScale", err)
	}
	// Calificaciones: NUMERIC(6,2) → 4 enteros y 2 decimales.
	if _, err := ParseScore("100.00"); err != nil {
		t.Errorf("ParseScore(100.00) devolvió %v", err)
	}
	if _, err := ParseScore("10000.00"); !errors.Is(err, ErrRange) {
		t.Errorf("ParseScore(10000.00) devolvió %v; se esperaba ErrRange", err)
	}
}

func TestFormatEsCanonicoYEstable(t *testing.T) {
	t.Parallel()
	casos := map[string]string{
		"0":          "0",
		"-0":         "0", // el cero negativo no es canónico en la salida
		"5":          "5",
		"1500000.00": "1500000",
		"1.500":      "1.5",
		"-0.50":      "-0.5",
		"100":        "100", // no se tocan los ceros de la parte entera
		"0.010":      "0.01",
	}
	for in, want := range casos {
		t.Run(in, func(t *testing.T) {
			t.Parallel()
			d, err := Parse(in)
			if err != nil {
				t.Fatalf("Parse(%q): %v", in, err)
			}
			got := Format(d)
			if got != want {
				t.Errorf("Format(Parse(%q)) = %q; se esperaba %q", in, got, want)
			}
			// Idempotencia: la salida canónica vuelve a parsearse igual.
			d2, err := Parse(got)
			if err != nil {
				t.Fatalf("Parse(Format(...)) = Parse(%q): %v", got, err)
			}
			if again := Format(d2); again != got {
				t.Errorf("Format no es idempotente: %q → %q", got, again)
			}
		})
	}
}

func TestFormatNuncaUsaNotacionCientifica(t *testing.T) {
	t.Parallel()
	// Un valor con exponente interno grande es el caso donde una serialización
	// ingenua emitiría "1E+18" y rompería a cualquier consumidor del contrato.
	for _, in := range []string{
		"1000000000000000000",
		"0.000000000000000001",
		"-1000000000000000000",
	} {
		out := Format(mustParse(t, in))
		if strings.ContainsAny(out, "eE") {
			t.Errorf("Format(%q) = %q: contiene notación científica", in, out)
		}
		if _, err := Parse(out); err != nil {
			t.Errorf("Format(%q) = %q no es canónico: %v", in, out, err)
		}
	}
}

func TestFormatFixedRellenaPeroNoRedondeaEnSilencio(t *testing.T) {
	t.Parallel()
	got, err := FormatFixed(mustParse(t, "1.5"), 2)
	if err != nil {
		t.Fatalf("FormatFixed(1.5, 2): %v", err)
	}
	if got != "1.50" {
		t.Errorf("FormatFixed(1.5, 2) = %q; se esperaba \"1.50\"", got)
	}

	// Pedir menos decimales de los que el valor tiene debe fallar, no redondear:
	// una pérdida de precisión silenciosa es exactamente lo que el Principio VIII
	// pretende evitar.
	if _, err := FormatFixed(mustParse(t, "1.005"), 2); !errors.Is(err, ErrScale) {
		t.Errorf("FormatFixed(1.005, 2) devolvió %v; se esperaba ErrScale", err)
	}
}

func TestRoundHalfEvenEsBancario(t *testing.T) {
	t.Parallel()
	casos := []struct {
		in    string
		scale int32
		want  string
	}{
		// El empate se resuelve hacia el dígito par, no siempre hacia arriba.
		{"0.125", 2, "0.12"},
		{"0.135", 2, "0.14"},
		{"2.5", 0, "2"},
		{"3.5", 0, "4"},
		{"-2.5", 0, "-2"},
		{"-0.125", 2, "-0.12"},
		// Sin empate se redondea normalmente.
		{"0.126", 2, "0.13"},
		{"0.124", 2, "0.12"},
	}
	for _, c := range casos {
		t.Run(c.in, func(t *testing.T) {
			t.Parallel()
			got := Format(RoundHalfEven(mustParse(t, c.in), c.scale))
			if got != c.want {
				t.Errorf("RoundHalfEven(%s, %d) = %s; se esperaba %s",
					c.in, c.scale, got, c.want)
			}
		})
	}
}

// TestAritmeticaExactaDondeElFloatFalla es la prueba del Principio VIII: los
// casos clásicos en los que `float64` produce un resultado incorrecto deben dar
// el resultado exacto por esta vía.
func TestAritmeticaExactaDondeElFloatFalla(t *testing.T) {
	t.Parallel()
	// 0.1 + 0.2 != 0.3 en binario.
	suma := mustParse(t, "0.1").Add(mustParse(t, "0.2"))
	if got := Format(suma); got != "0.3" {
		t.Errorf("0.1 + 0.2 = %s; se esperaba 0.3", got)
	}

	// Un monto grande en COP más un centavo: con float64 el centavo se pierde
	// por falta de dígitos significativos.
	total := mustParse(t, "99999999999999.99").Add(mustParse(t, "0.01"))
	if got := Format(total); got != "100000000000000" {
		t.Errorf("99999999999999.99 + 0.01 = %s; se esperaba 100000000000000", got)
	}

	// Diez veces 0.1 debe ser exactamente 1.
	acc := decimal.Zero
	for range 10 {
		acc = acc.Add(mustParse(t, "0.1"))
	}
	if got := Format(acc); got != "1" {
		t.Errorf("0.1 sumado diez veces = %s; se esperaba 1", got)
	}
}

func mustParse(t *testing.T, s string) decimal.Decimal {
	t.Helper()
	d, err := Parse(s)
	if err != nil {
		t.Fatalf("Parse(%q): %v", s, err)
	}
	return d
}

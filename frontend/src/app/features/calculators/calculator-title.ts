/**
 * Título legible de una calculadora a partir del nombre que viaja por el borde.
 *
 * ── EL DEFECTO ───────────────────────────────────────────────────────────────
 * El catálogo y el ejecutor imprimían `calculator.name` TAL CUAL, y ese campo no es un
 * nombre: en las diez definiciones semilla es el identificador de la máquina —`ahorro`,
 * `cdt_dias`, `mv_a_ea`, `fondo_emergencia`—, así que la pantalla titulaba «ahorro» en
 * minúsculas y con guiones bajos, y a un lector eso no le dice qué calculadora está
 * abriendo. Un identificador presentado como título no es texto incompleto: es un dato
 * equivocado en el sitio equivocado.
 *
 * ── QUÉ SE HACE Y QUÉ NO ────────────────────────────────────────────────────
 * NO se inventa contenido financiero: no se traduce «cdt» a «certificado de depósito a
 * término», ni se escribe «CDT» en mayúsculas para que parezca un acrónimo del dominio.
 * Eso sería redactar la calculadora, y la descripción que la acompaña ya dice qué hace. Lo
 * que se hace es exactamente lo que el identificador permite: guiones bajos a espacios y la
 * primera letra en mayúscula (frase, no mayúsculas sostenidas). `ahorro` → «Ahorro»,
 * `cdt_dias` → «Cdt dias».
 *
 * LOS NOMBRES QUE YA SE ESCRIBEN A MANO NO SE TOCAN MÁS ALLÁ DE ESO: una calculadora de
 * usuario lleva un nombre redactado por su autor (`ZZE2E doble 1759…`) y solo se le
 * capitaliza la primera letra si venía en minúscula; el resto del texto se deja idéntico,
 * porque bajar a minúsculas lo que alguien escribió en mayúsculas sería corregirle la
 * redacción. Es lo que comparan las pruebas de curaduría
 * (`getByRole('heading', { name: nombre })`), y esa igualdad se conserva.
 */
export function calculatorTitle(name: string): string {
  const conEspacios = name.trim().replace(/_/gu, ' ');
  if (conEspacios === '') {
    return conEspacios;
  }
  return conEspacios.charAt(0).toUpperCase() + conEspacios.slice(1);
}

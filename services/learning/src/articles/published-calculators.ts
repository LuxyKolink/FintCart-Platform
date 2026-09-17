/**
 * Puerto «¿sigue publicada esta calculadora?» (T151, FR-070 y FR-072).
 *
 * ## Por qué es un puerto y no una llamada
 *
 * La pregunta se responde en OTRO servicio: la calculadora vive en `simulator_db`, y Aprendizaje
 * no puede leerla (Principio III: sin acceso cruzado a base de datos). Se pregunta por gRPC
 * (research D-25), y la llamada se declara aquí como interfaz para que la regla de negocio —«un
 * artículo no puede incrustar una calculadora que el lector no podría ejecutar»— se pueda probar
 * sin levantar un Simulador. Es el mismo corte que hizo `ImagesService.findMissing` (T128): el
 * dominio pregunta, y quién contesta es un detalle de infraestructura.
 *
 * ## Qué se pregunta exactamente
 *
 * «¿Está publicada?», y NO «¿existe?». La diferencia es la que hace útil la comprobación: una
 * calculadora privada de otra persona **existe**, y un artículo que la incrustara dejaría a todo
 * el que lo lea con un bloque que no puede ejecutar. Y el Simulador contesta lo mismo para «no
 * existe» y «no la puedes ver» —no es un oráculo de existencia (`repo/calculators.rs::read_one`)—,
 * así que aquí las dos cosas se tratan igual, que es lo correcto: en los dos casos el lector se
 * encontraría un bloque muerto.
 *
 * ## Y por qué se pregunta por lista
 *
 * Un documento puede incrustar varias calculadoras, y preguntar de una en una sería una ida y
 * vuelta por cada bloque. El puerto recibe la lista y devuelve **las que faltan**, no un booleano:
 * un rechazo tiene que decir CUÁL, o quien escribe el artículo recibe un «hay una calculadora mal»
 * sin saber cuál de las tres que incrustó es.
 *
 * ## Por qué es una clase abstracta y no una interfaz
 *
 * Porque además de describir el puerto tiene que poder **inyectarse**, y una interfaz de
 * TypeScript no existe en tiempo de ejecución: `provide: PublishedCalculators` con una interfaz
 * es un error que solo se ve al compilar, y arreglarlo con un token de cadena metería una constante
 * de Nest en el constructor del servicio de aplicación. Una clase abstracta es las dos cosas —tipo
 * y valor— y no añade nada más: no se instancia, solo se implementa.
 */
export abstract class PublishedCalculators {
  /**
   * Los identificadores de `ids` que NO están publicados, sin repetir y en el orden en que se
   * preguntaron.
   *
   * Un identificador repetido se pregunta una sola vez: el documento puede incrustar la misma
   * calculadora en dos secciones y eso es legítimo.
   */
  public abstract missing(ids: readonly string[]): Promise<readonly string[]>;
}

/**
 * El mensaje con el que se rechaza un documento que incrusta calculadoras no publicadas.
 *
 * Vive aquí y no en el servicio para que el texto sea uno solo: el editor lo enseña tal cual, y
 * dos redacciones del mismo rechazo en dos sitios acaban diciendo cosas distintas de lo mismo.
 */
export function unpublishedCalculatorsError(missing: readonly string[]): string {
  const cuantas =
    missing.length === 1
      ? 'una calculadora que no está publicada'
      : `${missing.length} calculadoras que no están publicadas`;
  return (
    `el documento incrusta ${cuantas}: ${missing.join(', ')}. ` +
    'Un artículo solo puede incrustar calculadoras del catálogo: si la calculadora es un borrador, ' +
    'el lector no podría ejecutarla y el bloque quedaría muerto. Publícala primero, o quita el bloque'
  );
}

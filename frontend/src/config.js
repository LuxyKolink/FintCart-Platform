/**
 * Configuración de TIEMPO DE EJECUCIÓN — valor de DESARROLLO.
 *
 * El paquete se compila una vez y se despliega en sitios distintos, así que la URL del API
 * no puede venir compilada: daría una imagen distinta por entorno, y entonces lo que se
 * despliega no es lo que se probó (Principio X, regla 2).
 *
 * Este fichero lo sirve el servidor de desarrollo tal cual. En el despliegue, el mismo
 * nombre lo escribe `frontend/Dockerfile` al arrancar el contenedor y nginx le da prioridad
 * (`location = /config.js`, ver ahí por qué vive fuera del árbol estático). El SPA lee
 * siempre `window.__FINTCART_CONFIG__`, sea cual sea el entorno.
 *
 * ESTE FICHERO ES LA PIEZA QUE FALTABA (hallazgo 39): antes solo existía la mitad del
 * servidor —nginx escribía y servía `config.js`— y nadie lo leía, así que el bundle usaba
 * el valor compilado (`/v1`, un marcador) y cada llamada al API acababa en nginx, que
 * responde `405 Not Allowed` a un POST sobre un fichero estático. Se descubrió al intentar
 * registrarse en el despliegue del colegio.
 *
 * JavaScript y no TypeScript a propósito: es un recurso que se sirve sin compilar.
 */
window.__FINTCART_CONFIG__ = {
  apiBaseUrl: 'http://localhost:8080',
  oauth: {
    clientId: 'fintcart-spa',
    // El SPA no NAVEGA a esta dirección —pide el código por `POST /oauth/authorize` y lo
    // canjea acto seguido—, pero el flujo OAuth2 la exige y el servidor la compara con las
    // registradas para el cliente: tiene que coincidir con la de la base de datos.
    redirectUri: 'http://localhost:4200/auth/callback',
  },
};

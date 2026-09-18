import { bootstrapApplication } from '@angular/platform-browser';

import { AppComponent } from './app/app.component';
import { appConfig } from './app/app.config';
import { environment } from './environments/environment';

/**
 * Configuración de TIEMPO DE EJECUCIÓN (Principio X, regla 2).
 *
 * El paquete se compila una vez y se despliega en sitios distintos, así que la URL del API y
 * el cliente OAuth no pueden venir compilados: darían una imagen distinta por entorno, y lo
 * desplegado no sería lo probado. Lo escribe `frontend/Dockerfile` al arrancar el contenedor
 * y lo sirve `/config.js`.
 *
 * ESTA MITAD FALTABA (hallazgo 39). El fichero se servía y **nadie lo leía**: el bundle usaba
 * el valor compilado —`/v1`, un marcador— y cada llamada al API acababa en nginx, que
 * responde `405 Not Allowed` a un POST sobre un fichero estático. El síntoma que se vio fue
 * ese «405 de nginx» al intentar registrarse en el despliegue del colegio, y su causa no
 * estaba en el registro sino aquí.
 *
 * Si el fichero no está —un entorno sin él, o una ejecución sin navegador— se conservan los
 * valores compilados: la aplicación no depende de que exista.
 */
interface ConfiguracionDeTiempoDeEjecucion {
  apiBaseUrl?: string;
  oauth?: { clientId?: string; redirectUri?: string };
}

declare global {
  interface Window {
    __FINTCART_CONFIG__?: ConfiguracionDeTiempoDeEjecucion;
  }
}

function aplicarConfiguracionDeTiempoDeEjecucion(): void {
  const config = window.__FINTCART_CONFIG__;
  if (!config) {
    return;
  }
  if (config.apiBaseUrl) {
    environment.apiBaseUrl = config.apiBaseUrl;
  }
  if (config.oauth?.clientId) {
    environment.oauth.clientId = config.oauth.clientId;
  }
  if (config.oauth?.redirectUri) {
    environment.oauth.redirectUri = config.oauth.redirectUri;
  }
}

// Antes de arrancar, y no dentro de un `APP_INITIALIZER`: así ningún servicio puede
// construirse antes de que la configuración esté aplicada, ni por accidente.
aplicarConfiguracionDeTiempoDeEjecucion();

bootstrapApplication(AppComponent, appConfig).catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error(err);
});

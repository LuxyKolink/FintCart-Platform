export const environment = {
  production: false,
  apiBaseUrl: 'http://localhost:8080',
  oauth: {
    clientId: 'fintcart-spa',
    redirectUri: 'http://localhost:4200/auth/callback',
    scopes: ['perfil', 'catalogo', 'simulador', 'progreso'],
  },
};

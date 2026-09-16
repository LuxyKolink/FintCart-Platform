import { TestBed } from '@angular/core/testing';

import { TokenStorageService } from './token-storage.service';

/**
 * La opción «Recordarme» (FR-099) es la única lectura en la que mantener la sesión
 * es real: elige el almacén. Se prueba aquí porque es el punto donde una regresión
 * de privacidad (dejar el token en `localStorage` sin pedirlo) pasaría inadvertida.
 */
describe('TokenStorageService', () => {
  let service: TokenStorageService;

  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    TestBed.configureTestingModule({});
    service = TestBed.inject(TokenStorageService);
  });

  afterEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });

  it('keeps the session in sessionStorage when the user did not ask to be remembered', () => {
    service.save({ accessToken: 'a', refreshToken: 'r' });

    expect(service.getAccessToken()).toBe('a');
    expect(sessionStorage.getItem('fc_access_token')).toBe('a');
    expect(localStorage.getItem('fc_access_token')).toBeNull();
    expect(service.isPersistent()).toBe(false);
  });

  it('persists in localStorage when the user asked to be remembered', () => {
    service.save({ accessToken: 'a', refreshToken: 'r' }, true);

    expect(localStorage.getItem('fc_access_token')).toBe('a');
    expect(service.getAccessToken()).toBe('a');
    expect(service.isPersistent()).toBe(true);
  });

  it('does not leave the previous token behind when the choice changes', () => {
    service.save({ accessToken: 'a', refreshToken: 'r' }, true);
    service.save({ accessToken: 'b', refreshToken: 's' });

    expect(localStorage.getItem('fc_access_token')).toBeNull();
    expect(sessionStorage.getItem('fc_access_token')).toBe('b');
  });

  it('clears both stores on logout, whichever held the session', () => {
    service.save({ accessToken: 'a', refreshToken: 'r' }, true);
    service.clear();

    expect(service.getAccessToken()).toBeNull();
    expect(service.getRefreshToken()).toBeNull();
    expect(localStorage.getItem('fc_refresh_token')).toBeNull();
  });
});

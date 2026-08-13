import { Routes } from '@angular/router';

import { authGuard } from './core/auth/auth.guard';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'catalogo' },
  {
    path: 'iniciar-sesion',
    loadComponent: () => import('./features/auth/login/login.component').then((m) => m.LoginComponent),
  },
  {
    path: 'crear-cuenta',
    loadComponent: () => import('./features/auth/register/register.component').then((m) => m.RegisterComponent),
  },
  {
    // Ruta y nombre de query param ('token', no 'verification_token') fijados por
    // `services/notification/src/email/templates.ts::verificationLink` — es lo que
    // el correo real envía (`${APP_BASE_URL}/auth/verify-email?user_id=...&token=...`);
    // cambiarlos aquí sin tocar allá rompe todo enlace de verificación ya enviado.
    path: 'auth/verify-email',
    loadComponent: () =>
      import('./features/auth/verify-email/verify-email.component').then((m) => m.VerifyEmailComponent),
  },
  {
    path: 'catalogo',
    canActivate: [authGuard],
    loadComponent: () => import('./features/learning/catalog/catalog.component').then((m) => m.CatalogComponent),
  },
  {
    path: 'articulos/:articleId',
    canActivate: [authGuard],
    loadComponent: () => import('./features/learning/article/article.component').then((m) => m.ArticleComponent),
  },
  {
    path: 'cuestionarios/:quizId',
    canActivate: [authGuard],
    loadComponent: () => import('./features/learning/quiz/quiz.component').then((m) => m.QuizComponent),
  },
  {
    path: 'progreso',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/learning/progress/progress.component').then((m) => m.ProgressComponent),
  },
  {
    path: 'simuladores',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/simulators/selector/selector.component').then((m) => m.SelectorComponent),
  },
  {
    // Antes de ':calcType': una ruta estática pierde contra un segmento dinámico si
    // el orden se invierte, y 'historial' quedaría interpretado como un calcType.
    path: 'simuladores/historial',
    canActivate: [authGuard],
    loadComponent: () => import('./features/simulators/history/history.component').then((m) => m.HistoryComponent),
  },
  {
    path: 'simuladores/:calcType',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/simulators/forms/simulator-form.component').then((m) => m.SimulatorFormComponent),
  },
  { path: '**', redirectTo: 'catalogo' },
];

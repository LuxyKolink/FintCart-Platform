import { Routes } from '@angular/router';

import { authGuard } from './core/auth/auth.guard';
import { roleGuard } from './core/auth/role.guard';

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
  {
    // Catálogo de calculadoras publicadas (FR-052, T119). AUTENTICADA, igual que el
    // catálogo de artículos: aunque el borde la deje abierta, la navegación de la SPA
    // empieza después del acceso y no hay enlace público hacia ella.
    path: 'calculadoras',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/calculators/catalog/catalog.component').then((m) => m.CalculatorsCatalogComponent),
  },
  {
    // Las propias, con su estado de curaduría (FR-051, T118). Antes de ':calculatorId':
    // 'mis' es un segmento literal y perdería contra el dinámico si se declarara después.
    path: 'calculadoras/mis',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/calculators/mine/mine.component').then((m) => m.MyCalculatorsComponent),
  },
  {
    // El constructor visual (T097, FR-043). DOS rutas y no una con un parámetro opcional:
    // `/nueva` no existe todavía como recurso —se está creando— y `:calculatorId/editar` sí, así
    // que confundirlas obligaría al componente a adivinar si tiene que guardar o crear.
    path: 'calculadoras/nueva',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/calculators/builder/builder.component').then((m) => m.CalculatorBuilderComponent),
  },
  {
    path: 'calculadoras/:calculatorId/editar',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/calculators/builder/builder.component').then((m) => m.CalculatorBuilderComponent),
  },
  {
    path: 'calculadoras/:calculatorId',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/calculators/runner/runner.component').then((m) => m.CalculatorRunnerComponent),
  },
  {
    path: 'perfil',
    canActivate: [authGuard],
    loadComponent: () => import('./features/profile/profile.component').then((m) => m.ProfileComponent),
  },
  {
    path: 'perfil/reporte',
    canActivate: [authGuard],
    loadComponent: () => import('./features/profile/report/report.component').then((m) => m.ReportComponent),
  },
  {
    path: 'perfil/contrasena',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/profile/password/password.component').then((m) => m.PasswordComponent),
  },
  {
    path: 'perfil/eliminar-cuenta',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/profile/delete-account/delete-account.component').then((m) => m.DeleteAccountComponent),
  },
  {
    path: 'notificaciones',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/notifications/notifications.component').then((m) => m.NotificationsComponent),
  },
  {
    // `roleGuard` ya comprueba autenticación (FR-006): un usuario final que llegue
    // aquí sin sesión se redirige a login, y con sesión pero sin rol editorial se
    // redirige al catálogo — el guard nombrado en T170 (`editorial.guard.ts`) no se
    // crea aparte porque `role.guard.ts` ya es genérico y reutilizable; ver la nota de
    // T167–T170 en `tasks.md`.
    path: 'editorial',
    canActivate: [roleGuard('editor', 'coordinador_editorial')],
    loadComponent: () => import('./features/editorial/editor/editor.component').then((m) => m.EditorComponent),
  },
  {
    path: 'editorial/versiones/:versionId',
    canActivate: [roleGuard('editor', 'coordinador_editorial')],
    loadComponent: () => import('./features/editorial/editor/editor.component').then((m) => m.EditorComponent),
  },
  {
    path: 'editorial/borradores',
    canActivate: [roleGuard('editor', 'coordinador_editorial')],
    loadComponent: () => import('./features/editorial/versions/versions.component').then((m) => m.VersionsComponent),
  },
  {
    path: 'editorial/articulos/:articleId/versiones',
    canActivate: [roleGuard('editor', 'coordinador_editorial')],
    loadComponent: () => import('./features/editorial/versions/versions.component').then((m) => m.VersionsComponent),
  },
  {
    path: 'editorial/revision',
    canActivate: [roleGuard('coordinador_editorial')],
    loadComponent: () => import('./features/editorial/review/review.component').then((m) => m.ReviewComponent),
  },
  {
    // Bandeja de curaduría de CALCULADORAS (FR-052…FR-054, T117). Es una ruta propia y no
    // una sección de `/editorial/revision` —que es la de versiones de artículos—: son dos
    // colas distintas y unirlas obligaría a cada coordinador a distinguir en qué mitad está.
    path: 'editorial/calculadoras',
    canActivate: [roleGuard('coordinador_editorial')],
    loadComponent: () =>
      import('./features/editorial/review/review-calculators.component').then(
        (m) => m.ReviewCalculatorsComponent,
      ),
  },
  {
    // Cuarto rol (FR-081, US1): el administrador NO hereda atribuciones del
    // coordinador editorial (FR-082), así que la ruta es propia y exclusiva.
    path: 'admin/categorias',
    canActivate: [roleGuard('administrador')],
    loadComponent: () => import('./features/admin/categories/categories.component').then((m) => m.CategoriesComponent),
  },
  {
    // Procedimiento anual de indicadores (FR-055…FR-062, T108). Es la otra mitad del
    // trabajo del administrador: el catálogo de categorías ordena el contenido, y las
    // vigencias mantienen al día las cifras con las que calculan las calculadoras.
    path: 'admin/indicadores',
    canActivate: [roleGuard('administrador')],
    loadComponent: () => import('./features/admin/indicators/indicators.component').then((m) => m.IndicatorsComponent),
  },
  {
    // Galería interna de verificación visual de shared/ui (T048, quickstart §0).
    // No es una pantalla de producto: no tiene enlace de navegación ni guard,
    // solo sirve para contrastar los componentes migrados contra los UI kits.
    path: 'interno/galeria',
    loadComponent: () => import('./shared/ui/gallery/gallery.component').then((m) => m.GalleryComponent),
  },
  { path: '**', redirectTo: 'catalogo' },
];

import { Component, OnInit, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';

import { ProfileError, ProfileService } from './profile.service';
import { PREF_LOCALE, PREF_NOTIF_EMAIL, PREF_NOTIF_INAPP, Profile } from './profile.types';

type LoadState = 'loading' | 'ready' | 'error';

/** Pantalla de perfil y preferencias, con confirmación de cambios (T147, FR-017). */
@Component({
  selector: 'fc-profile',
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './profile.component.html',
})
export class ProfileComponent implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly api = inject(ProfileService);

  protected readonly state = signal<LoadState>('loading');
  protected readonly profile = signal<Profile | null>(null);
  protected readonly saving = signal(false);
  protected readonly saved = signal(false);
  protected readonly errorMessage = signal<string | null>(null);

  protected readonly form = this.fb.nonNullable.group({
    displayName: ['', [Validators.required, Validators.minLength(2)]],
    locale: ['es-CO', [Validators.required]],
    notifInApp: [true],
    notifEmail: [true],
  });

  public ngOnInit(): void {
    this.api.getProfile().subscribe({
      next: (profile) => {
        this.profile.set(profile);
        this.form.patchValue({
          displayName: profile.display_name,
          locale: profile.preferences[PREF_LOCALE] ?? 'es-CO',
          notifInApp: profile.preferences[PREF_NOTIF_INAPP] !== 'false',
          notifEmail: profile.preferences[PREF_NOTIF_EMAIL] !== 'false',
        });
        this.state.set('ready');
      },
      error: () => this.state.set('error'),
    });
  }

  protected onSubmit(): void {
    if (this.form.invalid || this.saving()) {
      this.form.markAllAsTouched();
      return;
    }
    this.saving.set(true);
    this.saved.set(false);
    this.errorMessage.set(null);

    const { displayName, locale, notifInApp, notifEmail } = this.form.getRawValue();
    this.api
      .updateProfile({
        display_name: displayName,
        preferences: {
          [PREF_LOCALE]: locale,
          [PREF_NOTIF_INAPP]: String(notifInApp),
          [PREF_NOTIF_EMAIL]: String(notifEmail),
        },
      })
      .subscribe({
        next: () => {
          this.saving.set(false);
          // La confirmación es la razón de ser de T147: sin ella, el usuario no
          // tiene forma de saber si el PATCH se guardó o si el clic no llegó.
          this.saved.set(true);
        },
        error: (err: unknown) => {
          this.saving.set(false);
          // El formulario NUNCA se limpia ante un error (Edge Cases, T152): lo
          // que el usuario escribió sigue en pantalla para reintentar.
          this.errorMessage.set(err instanceof ProfileError ? err.message : 'No pudimos guardar los cambios.');
        },
      });
  }
}

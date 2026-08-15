import { Component, OnInit, inject, signal } from '@angular/core';
import { FormArray, FormBuilder, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';

import { scoreValidator } from '../decimal-validators';
import { EditorialApiService, EditorialError } from '../editorial-api.service';
import { ArticleVersion, Quiz } from '../editorial.types';

type LoadState = 'ready' | 'loading' | 'not-found';
type SaveState = 'idle' | 'saving' | 'saved';

/** Grupo de una pregunta del formulario de cuestionario. Escrito a mano (no inferido)
 * para poder tipar la `FormArray` en `questions` sin un `ReturnType` autorreferente. */
type QuestionGroup = FormGroup<{
  prompt: FormControl<string>;
  optionA: FormControl<string>;
  optionB: FormControl<string>;
  optionC: FormControl<string>;
  optionD: FormControl<string>;
  correctKey: FormControl<string>;
  weight: FormControl<string>;
}>;

function newQuestionGroup(fb: FormBuilder): QuestionGroup {
  return fb.nonNullable.group({
    prompt: ['', [Validators.required]],
    optionA: ['', [Validators.required]],
    optionB: ['', [Validators.required]],
    optionC: [''],
    optionD: [''],
    correctKey: ['a', [Validators.required]],
    weight: ['1', [scoreValidator({ required: true })]],
  });
}

/**
 * Editor de artículos y cuestionarios (T167, FR-007/FR-009).
 *
 * Dos modos en el MISMO componente, distinguidos por la presencia de `:versionId` en la
 * ruta: crear (`/editorial`) arranca con un formulario de artículo nuevo; editar
 * (`/editorial/versiones/:versionId?articleId=...`) carga el cuerpo del borrador
 * existente. El gestor de cuestionario es idéntico en los dos casos — un cuestionario
 * cuelga del ARTÍCULO, no de la versión — y aparece en cuanto se conoce `articleId`.
 *
 * `articleId` viaja en la QUERY, no se deriva del `versionId`: no existe ningún RPC que
 * responda «¿de qué artículo es esta versión?» sin conocerlo ya (ver el comentario de
 * `ListVersionsRequest` en `learning.proto`), así que el enlace que trae aquí desde la
 * lista de borradores lo incluye.
 */
@Component({
  selector: 'fc-editor',
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './editor.component.html',
})
export class EditorComponent implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly api = inject(EditorialApiService);
  private readonly route = inject(ActivatedRoute);

  protected readonly loadState = signal<LoadState>('ready');
  protected readonly version = signal<ArticleVersion | null>(null);
  protected readonly articleId = signal<string | null>(null);
  protected readonly quiz = signal<Quiz | null>(null);

  protected readonly articleSaveState = signal<SaveState>('idle');
  protected readonly quizSaveState = signal<SaveState>('idle');
  protected readonly submitState = signal<SaveState>('idle');
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly quizErrorMessage = signal<string | null>(null);

  protected readonly articleForm = this.fb.nonNullable.group({
    title: ['', [Validators.required, Validators.minLength(3)]],
    category: ['', [Validators.required]],
    body: ['', [Validators.required, Validators.minLength(10)]],
  });

  protected readonly bodyForm = this.fb.nonNullable.group({
    body: ['', [Validators.required, Validators.minLength(10)]],
  });

  protected readonly quizForm = this.fb.nonNullable.group({
    title: ['', [Validators.required]],
    passThreshold: ['70', [scoreValidator({ required: true })]],
    questions: this.fb.array([newQuestionGroup(this.fb)]),
  });

  public ngOnInit(): void {
    const versionId = this.route.snapshot.paramMap.get('versionId');
    if (versionId === null) {
      // Modo crear: no hay nada que cargar.
      return;
    }

    const fromQuery = this.route.snapshot.queryParamMap.get('articleId');
    if (fromQuery === null) {
      this.loadState.set('not-found');
      return;
    }

    this.loadState.set('loading');
    this.api.listVersions({ article_id: fromQuery }).subscribe({
      next: (page) => {
        const found = page.items.find((v) => v.version_id === versionId);
        if (found === undefined) {
          this.loadState.set('not-found');
          return;
        }
        this.version.set(found);
        this.articleId.set(found.article_id);
        this.bodyForm.patchValue({ body: found.body ?? '' });
        this.loadState.set('ready');
      },
      error: () => this.loadState.set('not-found'),
    });
  }

  protected get questions(): FormArray<QuestionGroup> {
    return this.quizForm.controls.questions;
  }

  protected addQuestion(): void {
    this.questions.push(newQuestionGroup(this.fb));
  }

  protected removeQuestion(index: number): void {
    if (this.questions.length > 1) {
      this.questions.removeAt(index);
    }
  }

  /** Modo crear: crea el artículo con su versión 1 (FR-007). */
  protected onCreateArticle(): void {
    if (this.articleForm.invalid || this.articleSaveState() === 'saving') {
      this.articleForm.markAllAsTouched();
      return;
    }
    this.articleSaveState.set('saving');
    this.errorMessage.set(null);

    this.api.createArticle(this.articleForm.getRawValue()).subscribe({
      next: (version) => {
        this.articleSaveState.set('saved');
        this.version.set(version);
        this.articleId.set(version.article_id);
        this.bodyForm.patchValue({ body: version.body ?? this.articleForm.getRawValue().body });
      },
      error: (err: unknown) => {
        this.articleSaveState.set('idle');
        this.errorMessage.set(err instanceof EditorialError ? err.message : 'No pudimos crear el artículo.');
      },
    });
  }

  /** Modo editar: guarda el cuerpo del borrador propio (FR-007). */
  protected onSaveBody(): void {
    const v = this.version();
    if (this.bodyForm.invalid || v === null || this.articleSaveState() === 'saving') {
      this.bodyForm.markAllAsTouched();
      return;
    }
    this.articleSaveState.set('saving');
    this.errorMessage.set(null);

    this.api.updateDraft(v.version_id, this.bodyForm.getRawValue()).subscribe({
      next: (version) => {
        this.articleSaveState.set('saved');
        this.version.set(version);
      },
      error: (err: unknown) => {
        this.articleSaveState.set('idle');
        this.errorMessage.set(err instanceof EditorialError ? err.message : 'No pudimos guardar los cambios.');
      },
    });
  }

  /** Crea o reemplaza completo el cuestionario del artículo (FR-009, T162). */
  protected onSaveQuiz(): void {
    const artId = this.articleId();
    if (this.quizForm.invalid || artId === null || this.quizSaveState() === 'saving') {
      this.quizForm.markAllAsTouched();
      return;
    }
    this.quizSaveState.set('saving');
    this.quizErrorMessage.set(null);

    const raw = this.quizForm.getRawValue();
    const body = {
      article_id: artId,
      title: raw.title,
      pass_threshold: raw.passThreshold,
      questions: raw.questions.map((q) => ({
        prompt: q.prompt,
        options: this.optionsOf(q),
        correct_key: q.correctKey,
        weight: q.weight,
      })),
    };

    const existing = this.quiz();
    const call = existing === null ? this.api.createQuiz(body) : this.api.updateQuiz(existing.quiz_id, body);
    call.subscribe({
      next: (quiz) => {
        this.quizSaveState.set('saved');
        this.quiz.set(quiz);
      },
      error: (err: unknown) => {
        this.quizSaveState.set('idle');
        this.quizErrorMessage.set(err instanceof EditorialError ? err.message : 'No pudimos guardar el cuestionario.');
      },
    });
  }

  /** `borrador → en_revision` (FR-008). */
  protected onSubmitForReview(): void {
    const v = this.version();
    if (v === null || this.submitState() === 'saving') {
      return;
    }
    this.submitState.set('saving');
    this.errorMessage.set(null);

    this.api.submitForReview(v.version_id).subscribe({
      next: () => {
        this.submitState.set('saved');
        this.version.set({ ...v, state: 'en_revision' });
      },
      error: (err: unknown) => {
        this.submitState.set('idle');
        this.errorMessage.set(err instanceof EditorialError ? err.message : 'No pudimos enviar a revisión.');
      },
    });
  }

  private optionsOf(q: { optionA: string; optionB: string; optionC: string; optionD: string }): Record<string, string> {
    const options: Record<string, string> = { a: q.optionA, b: q.optionB };
    if (q.optionC.trim() !== '') {
      options['c'] = q.optionC;
    }
    if (q.optionD.trim() !== '') {
      options['d'] = q.optionD;
    }
    return options;
  }
}

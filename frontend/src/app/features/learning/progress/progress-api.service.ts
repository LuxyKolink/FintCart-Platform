import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { environment } from '../../../../environments/environment';
import { Progress } from './progress.types';

@Injectable({ providedIn: 'root' })
export class ProgressApiService {
  private readonly http = inject(HttpClient);

  public getProgress(): Observable<Progress> {
    return this.http.get<Progress>(`${environment.apiBaseUrl}/me/progress`);
  }
}

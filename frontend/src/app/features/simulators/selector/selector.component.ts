import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

import { CALCULATORS } from '../calculators.config';

/** Selector de las cinco calculadoras (T124, FR-019). */
@Component({
  selector: 'fc-simulator-selector',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './selector.component.html',
})
export class SelectorComponent {
  protected readonly calculators = CALCULATORS;
}

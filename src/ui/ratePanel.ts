// The rating panel: two verdict buttons, a one-line note, and a live count of
// the regions flagged by tapping the board behind it.
//
// The panel is built once per open and mutated in place. Re-rendering it would
// blow away the note field mid-typing, and the board behind it re-renders on
// every flag toggle.

import type { Verdict } from './ratings';

export interface RatePanel {
  el: HTMLElement;
  /** Reflect the chosen verdict; enables Save. */
  setVerdict(verdict: Verdict | null): void;
  /** Update the "n flagged" hint after a board tap. */
  setFlagCount(n: number): void;
  note(): string;
}

export interface RatePanelHandlers {
  onVerdict(verdict: Verdict): void;
  onSave(): void;
  onCancel(): void;
}

function verdictButton(label: string, verdict: Verdict, onPick: () => void): HTMLButtonElement {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = `btn verdict verdict-${verdict}`;
  el.textContent = label;
  el.setAttribute('aria-pressed', 'false');
  el.addEventListener('click', onPick);
  return el;
}

export function createRatePanel(
  initial: { verdict: Verdict | null; note: string; flagged: number },
  handlers: RatePanelHandlers,
): RatePanel {
  const el = document.createElement('section');
  el.className = 'ratepanel';
  el.setAttribute('aria-label', 'Rate this puzzle');

  const verdicts = document.createElement('div');
  verdicts.className = 'verdicts';
  const good = verdictButton('Good', 'good', () => handlers.onVerdict('good'));
  const bad = verdictButton('Bad', 'bad', () => handlers.onVerdict('bad'));
  verdicts.append(good, bad);

  const note = document.createElement('input');
  note.type = 'text';
  note.className = 'note';
  note.placeholder = 'why?';
  note.setAttribute('aria-label', 'Why');
  note.maxLength = 300;
  note.value = initial.note;
  // Enter saves, so a phone keyboard's "go" key finishes the rating.
  note.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handlers.onSave();
    }
  });

  const foot = document.createElement('div');
  foot.className = 'ratefoot';
  const hint = document.createElement('span');
  hint.className = 'ratehint';
  const save = document.createElement('button');
  save.type = 'button';
  save.className = 'btn btn-save';
  save.textContent = 'Save';
  save.addEventListener('click', handlers.onSave);
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'btn';
  cancel.textContent = 'Cancel';
  cancel.addEventListener('click', handlers.onCancel);
  foot.append(hint, cancel, save);

  el.append(verdicts, note, foot);

  const panel: RatePanel = {
    el,
    setVerdict(verdict) {
      good.setAttribute('aria-pressed', String(verdict === 'good'));
      bad.setAttribute('aria-pressed', String(verdict === 'bad'));
      good.classList.toggle('on', verdict === 'good');
      bad.classList.toggle('on', verdict === 'bad');
      save.disabled = verdict === null;
      save.title = verdict === null ? 'Pick Good or Bad first' : '';
    },
    setFlagCount(n) {
      hint.textContent = n === 0 ? 'tap regions to flag them' : `${n} region${n === 1 ? '' : 's'} flagged`;
    },
    note: () => note.value.trim(),
  };

  panel.setVerdict(initial.verdict);
  panel.setFlagCount(initial.flagged);
  return panel;
}

/** A short-lived confirmation, e.g. "Saved". */
export function toast(message: string): void {
  const el = document.createElement('div');
  el.className = 'toast';
  el.setAttribute('role', 'status');
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1600);
}

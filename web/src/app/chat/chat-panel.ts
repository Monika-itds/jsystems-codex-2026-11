import { Component, effect, input, signal } from '@angular/core';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import type { AssessmentRevision } from '../assessment.types';
import type { UIMessage } from 'ai';
import { RevisionChat } from './revision-chat';

@Component({
  selector: 'app-chat-panel',
  imports: [ReactiveFormsModule, MatButtonModule, MatFormFieldModule, MatInputModule],
  templateUrl: './chat-panel.html',
  styleUrl: './chat-panel.scss',
})
export class ChatPanel {
  readonly result = input.required<AssessmentRevision>();
  readonly session = signal<RevisionChat | null>(null);
  readonly draft = new FormControl('', {
    nonNullable: true,
    validators: [Validators.required, Validators.maxLength(4000)],
  });

  constructor() {
    effect((onCleanup) => {
      const result = this.result();
      const session = new RevisionChat({
        caseId: result.caseId,
        revision: result.revision,
        firstMessage: result.firstMessage,
      });
      this.session.set(session);
      onCleanup(() => {
        void session.dispose();
      });
    });
  }

  messages(): UIMessage[] {
    return this.session()?.messages ?? [];
  }

  onSubmit(event: Event): void {
    event.preventDefault();
    this.send();
  }

  send(): void {
    const session = this.session();
    const text = this.draft.value.trim();
    if (!session || !text || session.busy) {
      return;
    }
    this.draft.setValue('');
    void session.send(text);
  }

  stop(): void {
    void this.session()?.stop();
  }

  retry(): void {
    void this.session()?.retry();
  }
}

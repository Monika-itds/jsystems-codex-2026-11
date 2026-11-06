import { Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatExpansionModule } from '@angular/material/expansion';
import { AssessmentClient, stageLabels } from './assessment-client/assessment-client';
import { AssessmentView } from './assessment-view/assessment-view';
import { ChatPanel } from './chat/chat-panel';
import { IntakeForm } from './intake/intake-form';
import type { Intake } from './assessment.types';

@Component({
  selector: 'app-root',
  imports: [MatCardModule, MatButtonModule, MatExpansionModule, IntakeForm, AssessmentView, ChatPanel],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  readonly client = inject(AssessmentClient);

  submit(submission: { intake: Intake; image: File }): void {
    void this.client.submit(submission);
  }

  editIntake(): void {
    this.client.editIntake();
  }

  startNewCase(): void {
    void this.client.startNewCase();
  }

  stageLabel(): string {
    const stage = this.client.stage();
    return stage ? stageLabels[stage] : '';
  }
}

import { Component } from '@angular/core'
import { Router } from '@angular/router'

@Component({
  selector: 'app-settings',
  standalone: true,
  template: `
    <h1>Settings</h1>
    <button (click)="back()">Back to dashboard</button>
  `,
})
export class SettingsComponent {
  constructor(private router: Router) {}

  back(): void {
    this.router.navigateByUrl('/dashboard')
  }
}

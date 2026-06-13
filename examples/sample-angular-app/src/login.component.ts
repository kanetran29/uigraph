import { Component } from '@angular/core'
import { Router } from '@angular/router'

@Component({
  selector: 'app-login',
  standalone: true,
  template: `
    <h1>Login</h1>
    <form (submit)="submit()">
      <input type="email" name="email" required (input)="onEmail($event)" />
      <button data-testid="login-submit" (click)="submit()">Sign in</button>
    </form>
  `,
})
export class LoginComponent {
  constructor(private router: Router) {}

  onEmail(_event: Event): void {}

  submit(): void {
    this.router.navigate(['/dashboard'])
  }
}

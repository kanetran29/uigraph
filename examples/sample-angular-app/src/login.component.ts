import { Component } from '@angular/core'
import { Router } from '@angular/router'

@Component({
  selector: 'app-login',
  standalone: true,
  template: `
    <h1>Login</h1>
    <button (click)="submit()">Sign in</button>
  `,
})
export class LoginComponent {
  constructor(private router: Router) {}

  submit(): void {
    this.router.navigate(['/dashboard'])
  }
}

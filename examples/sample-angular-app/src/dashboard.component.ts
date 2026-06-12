import { Component } from '@angular/core'
import { Router, RouterLink } from '@angular/router'

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [RouterLink],
  template: `
    <h1>Dashboard</h1>
    <nav>
      <a routerLink="/dashboard/settings">Settings</a>
      <a routerLink="/products">Products</a>
    </nav>
    <button (click)="logout()">Log out</button>
  `,
})
export class DashboardComponent {
  constructor(private router: Router) {}

  logout(): void {
    this.router.navigate(['/'])
  }
}

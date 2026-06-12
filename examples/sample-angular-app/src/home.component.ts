import { Component } from '@angular/core'
import { RouterLink } from '@angular/router'

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [RouterLink],
  template: `
    <h1>Home</h1>
    <nav>
      <a routerLink="/login">Login</a>
      <a routerLink="/products">Products</a>
    </nav>
  `,
})
export class HomeComponent {}

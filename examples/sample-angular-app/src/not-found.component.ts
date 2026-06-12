import { Component } from '@angular/core'
import { RouterLink } from '@angular/router'

@Component({
  selector: 'app-not-found',
  standalone: true,
  imports: [RouterLink],
  template: `
    <h1>Not Found</h1>
    <a routerLink="/">Go home</a>
  `,
})
export class NotFoundComponent {}

import { Component } from '@angular/core'
import { RouterLink } from '@angular/router'

@Component({
  selector: 'app-products',
  standalone: true,
  imports: [RouterLink],
  template: `
    <h1>Products</h1>
    <ul>
      <li><a [routerLink]="'/products/' + id">View product</a></li>
    </ul>
  `,
})
export class ProductsComponent {
  id = '1'
}

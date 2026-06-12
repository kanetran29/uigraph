import { Component } from '@angular/core'
import { Router } from '@angular/router'

@Component({
  selector: 'app-product-detail',
  standalone: true,
  template: `
    <h1>Product Detail</h1>
    <button (click)="buy()">Buy now</button>
  `,
})
export class ProductDetailComponent {
  constructor(private router: Router) {}

  buy(): void {
    this.router.navigate(['/checkout'])
  }
}

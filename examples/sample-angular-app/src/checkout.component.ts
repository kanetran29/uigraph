import { Component } from '@angular/core'
import { Router } from '@angular/router'

@Component({
  selector: 'app-checkout',
  standalone: true,
  template: `
    <h1>Checkout</h1>
    <button (click)="complete()">Complete order</button>
  `,
})
export class CheckoutComponent {
  constructor(private router: Router) {}

  complete(): void {
    this.router.navigate(['/'])
  }
}

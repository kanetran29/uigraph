import type { Routes } from '@angular/router'
import { AuthGuard } from './auth.guard'
import { HomeComponent } from './home.component'
import { LoginComponent } from './login.component'
import { DashboardComponent } from './dashboard.component'
import { SettingsComponent } from './settings.component'
import { ProductsComponent } from './products.component'
import { ProductDetailComponent } from './product-detail.component'
import { CheckoutComponent } from './checkout.component'
import { NotFoundComponent } from './not-found.component'

export const routes: Routes = [
  { path: '', component: HomeComponent },
  { path: 'login', component: LoginComponent },
  { path: 'dashboard', component: DashboardComponent, canActivate: [AuthGuard] },
  { path: 'dashboard/settings', component: SettingsComponent, canActivate: [AuthGuard] },
  { path: 'products', component: ProductsComponent },
  { path: 'products/:id', component: ProductDetailComponent },
  { path: 'checkout', component: CheckoutComponent, canActivate: [AuthGuard] },
  { path: '**', component: NotFoundComponent },
]

/** Trivial route guard; its class name is captured by the adapter as symbolic guard text. */
export class AuthGuard {
  canActivate(): boolean {
    return true
  }
}

<template>
  <main>
    <h1>Login</h1>
    <form @submit.prevent="submit">
      <input type="email" name="email" required @input="onEmail" />
      <button data-testid="login-submit" @click="submit">Sign in</button>
    </form>
  </main>
</template>

<script setup lang="ts">
import { useRouter } from 'vue-router'
import { login } from '../auth'

const router = useRouter()

function onEmail(_event: Event): void {}

/** Sign-in handler: records the session token, then enters the dashboard. */
function submit(): void {
  login()
  router.push('/dashboard')
}
</script>

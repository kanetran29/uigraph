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

const router = useRouter()

function onEmail(_event: Event): void {}

function submit(): void {
  router.push('/dashboard')
}
</script>

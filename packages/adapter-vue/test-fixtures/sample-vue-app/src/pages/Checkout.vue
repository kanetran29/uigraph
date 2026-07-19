<template>
  <main>
    <h1>Checkout</h1>
    <button @click="complete">Complete order</button>
  </main>
</template>

<script setup lang="ts">
import { useRouter } from 'vue-router'

const router = useRouter()

function complete(): void {
  router.push('/')
}
</script>

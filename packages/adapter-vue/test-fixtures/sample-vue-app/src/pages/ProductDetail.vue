<template>
  <main>
    <h1>Product Detail</h1>
    <button @click="buy">Buy now</button>
  </main>
</template>

<script setup lang="ts">
import { useRouter } from 'vue-router'

const router = useRouter()

function buy(): void {
  router.push('/checkout')
}
</script>

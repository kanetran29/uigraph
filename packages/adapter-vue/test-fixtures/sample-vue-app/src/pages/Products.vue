<template>
  <main>
    <h1>Products</h1>
    <ul>
      <li v-for="p in products" :key="p.id">
        <router-link :to="`/products/${p.id}`">{{ p.name }}</router-link>
      </li>
    </ul>
  </main>
</template>

<script setup lang="ts">
const products = [
  { id: '1', name: 'Widget' },
  { id: '2', name: 'Gadget' },
]
</script>

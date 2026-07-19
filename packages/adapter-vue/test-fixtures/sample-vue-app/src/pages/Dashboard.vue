<template>
  <main>
    <h1>Dashboard</h1>
    <router-link to="/products">Products</router-link>
    <button @click="goSettings">Settings</button>
  </main>
</template>

<script lang="ts">
import { defineComponent } from 'vue'

export default defineComponent({
  name: 'Dashboard',
  methods: {
    goSettings(): void {
      this.$router.push('/dashboard/settings')
    },
  },
})
</script>

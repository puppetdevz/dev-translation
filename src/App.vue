<script lang="ts" setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'

const router = useRouter()
const enterAction = ref({})

onMounted(() => {
  if (!window.utools) return

  window.utools.onPluginEnter((action) => {
    enterAction.value = action
    router.push({ name: action.code })
  })

  window.utools.onPluginOut(() => {
    enterAction.value = {}
  })
})
</script>

<template>
  <router-view :enterAction="enterAction" />
</template>

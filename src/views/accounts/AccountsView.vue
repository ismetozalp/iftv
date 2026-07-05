<script setup lang="ts">
import { reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useWorkspaceStore } from '@/stores/workspace'

const ws = useWorkspaceStore()
const router = useRouter()
const form = reactive({ name: '', url: '', username: '', password: '' })
const busy = ref(false)
const error = ref('')

async function submit() {
  busy.value = true; error.value = ''
  try {
    await ws.add({ ...form }, true)
    form.name = form.url = form.username = form.password = ''
    router.push('/')
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    busy.value = false
  }
}

async function openAccount(id: string) {
  await ws.open(id)
  router.push('/')
}
</script>

<template>
  <div class="row g-4">
    <div class="col-md-5">
      <h5>Add account</h5>
      <form @submit.prevent="submit">
        <input v-model="form.name" class="form-control mb-2" placeholder="Name" required />
        <input v-model="form.url" class="form-control mb-2" placeholder="http://host:port" required />
        <input v-model="form.username" class="form-control mb-2" placeholder="Username" required />
        <input v-model="form.password" type="password" class="form-control mb-2" placeholder="Password" required />
        <button class="btn btn-primary" :disabled="busy">{{ busy ? 'Verifying…' : 'Add & verify' }}</button>
      </form>
      <div v-if="error" class="alert alert-danger mt-2">{{ error }}</div>
    </div>
    <div class="col-md-7">
      <h5>Accounts</h5>
      <p v-if="!ws.allAccounts.length" class="text-muted">None yet.</p>
      <ul class="list-group">
        <li v-for="a in ws.allAccounts" :key="a.id" class="list-group-item d-flex justify-content-between align-items-center">
          <span>
            {{ a.name }} <small class="text-muted">{{ a.url }}</small>
            <span v-if="ws.tabs.openTabIds.includes(a.id)" class="badge bg-secondary ms-2">open</span>
          </span>
          <span class="btn-group btn-group-sm">
            <button class="btn btn-outline-primary" @click="openAccount(a.id)">Open</button>
            <button class="btn btn-outline-danger" @click="ws.remove(a.id)">Remove</button>
          </span>
        </li>
      </ul>
    </div>
  </div>
</template>

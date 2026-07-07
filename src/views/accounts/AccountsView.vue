<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useWorkspaceStore } from '@/stores/workspace'
import AccountForm from '@/components/AccountForm.vue'
import type { Account, NewAccount } from '@/core/accounts/accounts'

const ws = useWorkspaceStore()
const router = useRouter()
const busy = ref(false)
const error = ref('')
const editing = ref<Account | null>(null)
const editBusy = ref(false)
const editError = ref('')

async function onAdd(payload: NewAccount) {
  busy.value = true; error.value = ''
  try {
    await ws.add(payload, true)
    router.push('/')
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    busy.value = false
  }
}

async function onSaveEdit(payload: NewAccount) {
  if (!editing.value) return
  editBusy.value = true; editError.value = ''
  try {
    await ws.update(editing.value.id, payload)
    editing.value = null
  } catch (e) {
    editError.value = e instanceof Error ? e.message : String(e)
  } finally {
    editBusy.value = false
  }
}

async function openAccount(id: string) {
  await ws.open(id)
  router.push('/')
}
</script>

<template>
  <div>
    <div class="d-flex align-items-center gap-3 mb-3">
      <button class="btn btn-sm btn-outline-secondary" @click="router.push('/')">&larr; Back to watching</button>
      <h4 class="mb-0">Manage accounts</h4>
    </div>
    <div class="row g-4">
    <div class="col-md-5">
      <h5>Add account</h5>
      <AccountForm :busy="busy" :error="error" @submit="onAdd" />
    </div>
    <div class="col-md-7">
      <h5>Accounts</h5>
      <p v-if="!ws.allAccounts.length" class="text-muted">None yet.</p>
      <ul class="list-group">
        <template v-for="a in ws.allAccounts" :key="a.id">
          <li class="list-group-item d-flex justify-content-between align-items-center">
            <span>
              <span class="badge bg-info text-dark me-2">{{ a.type }}</span>
              {{ a.name }} <small class="text-muted">{{ a.url }}</small>
              <span v-if="ws.tabs.openTabIds.includes(a.id)" class="badge bg-secondary ms-2">open</span>
            </span>
            <span class="btn-group btn-group-sm">
              <button class="btn btn-outline-primary" @click="openAccount(a.id)">Open</button>
              <button class="btn btn-outline-secondary" @click="editing = a">Edit</button>
              <button class="btn btn-outline-danger" @click="ws.remove(a.id)">Remove</button>
            </span>
          </li>
          <li v-if="editing && editing.id === a.id" class="list-group-item bg-body-secondary">
            <AccountForm :model-value="editing" :busy="editBusy" :error="editError"
                         @submit="onSaveEdit" @cancel="editing = null" />
          </li>
        </template>
      </ul>
    </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { reactive, watch } from 'vue'
import type { Account, NewAccount, AccountType } from '@/core/accounts/accounts'

const props = defineProps<{ modelValue?: Account | null; busy?: boolean; error?: string }>()
const emit = defineEmits<{ submit: [NewAccount]; cancel: [] }>()

const form = reactive<NewAccount>({ type: 'xtream', name: '', url: '', username: '', password: '', epgUrl: '' })

function load(a: Account | null | undefined) {
  form.type = a?.type ?? 'xtream'
  form.name = a?.name ?? ''
  form.url = a?.url ?? ''
  form.username = a?.username ?? ''
  form.password = a?.password ?? ''
  form.epgUrl = a?.epgUrl ?? ''
}
watch(() => props.modelValue, load, { immediate: true })

function setType(t: AccountType) {
  form.type = t
  if (t === 'm3u') { form.username = ''; form.password = '' }
}

function submit() {
  const payload: NewAccount = {
    type: form.type, name: form.name.trim(), url: form.url.trim(),
    username: form.type === 'xtream' ? form.username : '',
    password: form.type === 'xtream' ? form.password : '',
    epgUrl: (form.epgUrl ?? '').trim(),
  }
  emit('submit', payload)
}
</script>

<template>
  <form @submit.prevent="submit">
    <div class="btn-group btn-group-sm mb-2" role="group">
      <button type="button" class="btn" :class="form.type === 'xtream' ? 'btn-primary' : 'btn-outline-primary'" @click="setType('xtream')">Xtream Codes</button>
      <button type="button" class="btn" :class="form.type === 'm3u' ? 'btn-primary' : 'btn-outline-primary'" @click="setType('m3u')">M3U playlist (no login)</button>
    </div>
    <input v-model="form.name" class="form-control mb-2" placeholder="Name" required />
    <input v-model="form.url" class="form-control mb-2" :placeholder="form.type === 'm3u' ? 'Playlist URL (http://…/list.m3u)' : 'Server URL (http://host:port)'" required />
    <template v-if="form.type === 'xtream'">
      <input v-model="form.username" class="form-control mb-2" placeholder="Username" required />
      <input v-model="form.password" type="password" class="form-control mb-2" placeholder="Password" required />
    </template>
    <input v-model="form.epgUrl" class="form-control mb-2" placeholder="EPG URL (XMLTV) — optional" />
    <div class="d-flex gap-2">
      <button class="btn btn-primary btn-sm" :disabled="busy">{{ busy ? 'Verifying…' : (modelValue ? 'Save' : 'Add & verify') }}</button>
      <button v-if="modelValue" type="button" class="btn btn-outline-secondary btn-sm" @click="emit('cancel')">Cancel</button>
    </div>
    <div v-if="error" class="alert alert-danger mt-2 py-1">{{ error }}</div>
  </form>
</template>

// Extracts the top navigation, workspace toggles, and network controls

<template>
  <header class="sleek-top-bar">
    <div class="workspace-controls">
      <div class="segmented-control">
        <button :class="{ active: !isDraftMode }" @click="$emit('switchMode', false)">Staging</button>
        <button :class="{ active: isDraftMode }" @click="$emit('switchMode', true)">Draft</button>
      </div>
      <button v-if="isDraftMode" class="sleek-btn primary commit-btn" @click="$emit('commitChanges')">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"></path><path d="M12 5l7 7-7 7"></path></svg>
        Merge to Staging
      </button>
    </div>

    <div class="network-controls">
      <div v-if="netState.status === 'disconnected'" class="auth-row">
        <input v-model="localUsername" @input="updateUsername" placeholder="Your Name" class="sleek-input" />
        <div class="divider"></div>
        <button @click="$emit('initHost')" class="sleek-btn primary">Host Room</button>
        <span class="or-text">or</span>
        <input v-model="localJoinId" placeholder="Host ID" class="sleek-input" />
        <button @click="$emit('joinHost', localJoinId)" class="sleek-btn outline">Join</button>
      </div>

      <div v-else class="connected-row">
        <div class="user-badge" :title="netState.lastMessage">
          <span class="status-dot"></span>
          <span class="username">{{ netState.username }}</span>
          <span class="role-badge">{{ netState.isHost ? 'Host' : 'Client' }}</span>
        </div>

        <button v-if="netState.peerId" @click="copyRoomId" class="sleek-btn outline" style="padding: 4px 10px;" :title="copyBtnText">
          <svg v-if="copyBtnText === 'Copy ID'" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
          <svg v-else width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#0f9d58" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
          <span :style="{ color: copyBtnText === 'Copied!' ? '#0f9d58' : 'inherit' }">{{ copyBtnText }}</span>
        </button>
        
        <div class="peer-count" title="Connected Peers">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>
          {{ netState.isHost ? netState.connectedPeers.length : netState.connectedPeers.length + 1 }}
        </div>
      </div>
    </div>
  </header>
</template>

<script setup>
import { ref, watch } from 'vue';

const props = defineProps({
  isDraftMode: Boolean,
  netState: Object
});

const emit = defineEmits(['switchMode', 'commitChanges', 'initHost', 'joinHost', 'updateUsername']);

const localJoinId = ref('');
const localUsername = ref(props.netState.username);
const copyBtnText = ref('Copy ID');

watch(() => props.netState.username, (newVal) => { localUsername.value = newVal; });

function updateUsername() {
  emit('updateUsername', localUsername.value);
}

function copyRoomId() {
  if (props.netState.peerId) {
    navigator.clipboard.writeText(props.netState.peerId).then(() => {
      copyBtnText.value = 'Copied!';
      setTimeout(() => { copyBtnText.value = 'Copy ID'; }, 2000);
    }).catch(err => {
      console.error('Failed to copy text: ', err);
      alert('Failed to copy ID to clipboard.');
    });
  }
}
</script>
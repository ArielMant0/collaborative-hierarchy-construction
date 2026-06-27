<template>
  <div v-if="show" class="modal-overlay" @click.self="$emit('close')">
    <div class="modal-content logs-modal">
      <div class="logs-header">
        <h3>Session Action Logs</h3>
        <button class="close-btn" @click="$emit('close')">✕</button>
      </div>
      
      <div class="logs-list">
        <div v-if="!logs || logs.length === 0" class="empty-logs">
          No actions have been recorded yet.
        </div>
        <div v-else v-for="(log, index) in sortedLogs" :key="index" class="log-entry">
          <div class="log-meta">
            <span class="log-time">{{ formatTime(log.timestamp) }}</span>
            <span class="log-user">{{ log.by }}</span>
          </div>
          <div class="log-action-badge">{{ log.action }}</div>
          <div v-if="log.details" class="log-details">{{ log.details }}</div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';

const props = defineProps({
  show: Boolean,
  logs: Array
});

defineEmits(['close']);

// Show newest logs at the top
const sortedLogs = computed(() => {
  if (!props.logs) return [];
  return [...props.logs].sort((a, b) => b.timestamp - a.timestamp);
});

function formatTime(ts) {
  if (!ts) return '';
  const date = new Date(ts);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
</script>

<style scoped>
.logs-modal {
  width: 500px;
  max-width: 90vw;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
}
.logs-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid #e5e5e5;
  padding-bottom: 12px;
  margin-bottom: 12px;
}
.close-btn {
  background: transparent;
  border: none;
  font-size: 16px;
  cursor: pointer;
  color: #5f6368;
}
.logs-list {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding-right: 8px;
}
.empty-logs {
  color: #888;
  text-align: center;
  font-size: 14px;
  padding: 20px;
}
.log-entry {
  background: #f8f9fa;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  padding: 12px;
  font-size: 13px;
}
.log-meta {
  display: flex;
  justify-content: space-between;
  margin-bottom: 6px;
  color: #5f6368;
  font-size: 12px;
}
.log-user {
  font-weight: 600;
  color: #202124;
}
.log-action-badge {
  display: inline-block;
  background: #e8f0fe;
  color: #1a73e8;
  padding: 2px 8px;
  border-radius: 4px;
  font-weight: 700;
  font-size: 11px;
  text-transform: uppercase;
  margin-bottom: 4px;
}
.log-details {
  color: #202124;
  line-height: 1.4;
}
</style>
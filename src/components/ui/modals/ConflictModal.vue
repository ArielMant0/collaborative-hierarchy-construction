<template>
  <div v-if="show" class="modal-overlay" @click.self="close">
    <div class="modal-content">
      <h3>Resolve Conflict</h3>
      <p style="font-size: 13px; color: #5f6368; margin-top: -8px;">
        Choose how to resolve the <strong>{{ conflict?.type }}</strong> on "{{ nodeName }}".
      </p>
      
      <div style="display: flex; flex-direction: column; gap: 8px;">
        <button 
          v-for="option in options" 
          :key="option.action"
          class="sleek-btn outline"
          style="justify-content: flex-start; text-align: left;"
          @click="$emit('execute', option)">
          {{ option.label }}
        </button>
      </div>

      <div class="modal-actions" style="margin-top: 12px;">
        <button @click="close" class="sleek-btn outline">Cancel</button>
      </div>
    </div>
  </div>
</template>

<script setup>
defineProps({
  show: Boolean,
  conflict: Object,
  nodeName: String,
  options: Array
});

defineEmits(['close', 'execute']);
</script>
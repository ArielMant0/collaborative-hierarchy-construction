<template>
  <div v-if="show" class="modal-overlay" @click.self="close">
    <div class="modal-content">
      <h3>Delete Node</h3>
      <p style="font-size: 13px; color: #5f6368; margin-top: -8px;">
        You are about to delete <strong>{{ nodeName }}</strong>.
      </p>

      <label style="font-size: 13px; display: flex; align-items: center; gap: 8px; margin-top: 4px;">
        <input type="checkbox" v-model="cascade" />
        Delete entire subtree (cascade)
      </label>

      <div class="modal-actions" style="margin-top: 8px;">
        <button @click="close" class="sleek-btn outline">Cancel</button>
        <button @click="submit" class="sleek-btn primary" style="background: #f44336;">Propose Deletion</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, watch } from 'vue';

const props = defineProps({ show: Boolean, nodeName: String });
const emit = defineEmits(['close', 'submit']);

const cascade = ref(false);

watch(() => props.show, (isOpen) => {
  if (!isOpen) {
    cascade.value = false;
  }
});

function close() { emit('close'); }
function submit() { 
  emit('submit', { cascade: cascade.value }); 
}
</script>
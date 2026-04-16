<template>
  <div v-if="show" class="modal-overlay" @click.self="close">
    <div class="modal-content">
      <h3>Split Category</h3>
      <p style="font-size: 13px; color: #5f6368; margin-top: -8px;">
        Splitting <strong>{{ nodeName }}</strong>. Enter new categories separated by commas.
      </p>
      <input 
        v-model="newNames" 
        class="sleek-input full-width" 
        placeholder="e.g. Frontend, Backend, DevOps"
        @keyup.enter="submit"
      />
      <div class="modal-actions">
        <button @click="close" class="sleek-btn outline">Cancel</button>
        <button @click="submit" class="sleek-btn primary" style="background: #e91e63;">Propose Split</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, watch } from 'vue';

const props = defineProps({ show: Boolean, nodeName: String });
const emit = defineEmits(['close', 'submit']);

const newNames = ref('');

watch(() => props.show, (isOpen) => {
  if (!isOpen) newNames.value = '';
});

function close() { emit('close'); }
function submit() { emit('submit', newNames.value); }
</script>
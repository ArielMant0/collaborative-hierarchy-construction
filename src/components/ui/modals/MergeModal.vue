<template>
  <div v-if="show" class="modal-overlay" @click.self="close">
    <div class="modal-content">
      <h3>Consolidate Multiple Categories</h3>
      <p style="font-size: 13px; color: #5f6368;">Merging {{ count }} categories into a new parent node.</p>
      <input 
        v-model="newName" 
        class="sleek-input full-width" 
        placeholder="New Consolidated Name..."
        @keyup.enter="submit"
      />
      <div class="modal-actions">
        <button @click="close" class="sleek-btn outline">Cancel</button>
        <button @click="submit" class="sleek-btn primary" style="background: #9c27b0;">Merge Nodes</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, watch } from 'vue';

const props = defineProps({ show: Boolean, count: Number });
const emit = defineEmits(['close', 'submit']);

const newName = ref('');

watch(() => props.show, (isOpen) => {
  if (!isOpen) newName.value = '';
});

function close() { emit('close'); }
function submit() { emit('submit', newName.value); }
</script>
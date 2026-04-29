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

      <div v-if="parentOptions && parentOptions.length > 0" style="display: flex; flex-direction: column; gap: 8px;">
        <label style="font-size: 13px; font-weight: 600; color: #202124;">Select Target Parent:</label>
        <select v-model="selectedTargetId" class="sleek-input full-width">
          <option v-for="opt in parentOptions" :key="opt.id" :value="opt.id">
            {{ opt.name }}
          </option>
        </select>
      </div>

      <div class="modal-actions">
        <button @click="close" class="sleek-btn outline">Cancel</button>
        <button @click="submit" :disabled="!selectedTargetId && parentOptions?.length > 0" class="sleek-btn primary" style="background: #9c27b0;">Merge Nodes</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, watch } from 'vue';

const props = defineProps({ 
  show: Boolean, 
  count: Number,
  parentOptions: { type: Array, default: () => [] }
});

const emit = defineEmits(['close', 'submit']);

const newName = ref('');
const selectedTargetId = ref('');

watch(() => props.show, (isOpen) => {
  if (!isOpen) {
    newName.value = '';
    selectedTargetId.value = '';
  } else if (props.parentOptions && props.parentOptions.length > 0) {
    // Default to the first available parent option to prevent null submissions
    selectedTargetId.value = props.parentOptions[0].id;
  }
});

function close() { emit('close'); }

function submit() { 
  if (props.parentOptions?.length > 0 && !selectedTargetId.value) return;
  
  emit('submit', { 
    newName: newName.value, 
    targetParentId: selectedTargetId.value 
  }); 
}
</script>
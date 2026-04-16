<template>
  <div v-if="show" class="modal-overlay" @click.self="close">
    <div class="modal-content">
      <h3>Rename Node</h3>
      <input 
        v-model="localName" 
        class="sleek-input full-width" 
        @keyup.enter="submit" 
        ref="renameInput"
      />
      <div class="modal-actions">
        <button @click="close" class="sleek-btn outline">Cancel</button>
        <button @click="submit" class="sleek-btn primary">Save</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, watch, nextTick } from 'vue';

const props = defineProps({ show: Boolean, initialName: String });
const emit = defineEmits(['close', 'submit']);

const localName = ref('');
const renameInput = ref(null);

watch(() => props.show, (isOpen) => {
  if (isOpen) {
    localName.value = props.initialName || '';
    nextTick(() => renameInput.value?.focus());
  }
});

function close() { emit('close'); }
function submit() { emit('submit', localName.value); }
</script>
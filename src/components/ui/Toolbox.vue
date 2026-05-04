// Extracts the context-aware action menu for selected nodes

<template>
  <div v-if="selectedNodes.length > 0" class="bottom-toolbox">
    <div class="toolbox-header">
      <span class="selection-badge">{{ selectedNodes.length }} Selected</span>
    </div>
    
    <div v-if="selectedNodes.length === 1" class="toolbox-actions">
      <template v-if="selectedNodes[0].data.action !== 'deleted'">
        <button class="sleek-btn outline" :disabled="isLocked" :style="disabledActionStyle" @click="$emit('rename')">Rename</button>
        <button class="sleek-btn outline" :disabled="isLocked" :style="disabledActionStyle" @click="$emit('addChild')">Add Child</button>
        <button v-if="isSingleLeafSelected" class="sleek-btn outline" :disabled="isLocked" :style="disabledActionStyle" @click="$emit('split')">Split</button>
        
        <!-- Unlock is the ONLY button that behaves differently -->
        <button class="sleek-btn outline" :disabled="isLocked && !canUnlock" :style="disabledUnlockStyle" @click="$emit('toggleLock')">{{ selectedNodes[0].data.locked ? 'Unlock' : 'Lock' }}</button>
        
        <button v-if="selectedNodes[0].data.conflicts?.some(c => c.type === 'delete')" class="sleek-btn outline" :disabled="isLocked" :style="disabledActionStyle" @click="$emit('restore')">Restore Node</button>
        <button v-else class="sleek-btn outline" :disabled="isLocked" :style="[disabledActionStyle, !isLocked ? { color: '#f44336', borderColor: '#f44336' } : {}]" @click="$emit('delete')">Delete</button>
        
        <template v-if="selectedNodes[0].data.conflicts?.length">
          <div class="divider"></div>
          
          <button 
            v-if="selectedNodes[0].data.conflicts.filter(c => c.type === 'merge-proposal').length > 1"
            class="sleek-btn primary" 
            :disabled="isLocked"
            :style="[disabledActionStyle, !isLocked ? { background: '#ff9800' } : {}]"
            @click="$emit('acceptAllMerges')">
            Accept All Merges
          </button>

          <template v-for="(conflict, index) in selectedNodes[0].data.conflicts" :key="conflict.id">
            <button 
              v-if="!(conflict.type === 'merge-proposal' && selectedNodes[0].data.conflicts.filter(c => c.type === 'merge-proposal').length > 1)"
              class="sleek-btn primary" 
              :disabled="isLocked"
              :style="[disabledActionStyle, !isLocked ? { background: '#ff9800' } : {}]"
              @click="$emit('acceptConflict', { conflict, index })">
              {{ getConflictButtonLabel(conflict) }}
            </button>
          </template>
        </template>
      </template>

      <template v-else>
        <button class="sleek-btn outline" :disabled="isLocked" :style="disabledActionStyle" @click="$emit('restore')">Restore Node</button>
      </template>
    </div>

    <div v-if="selectedNodes.length > 1" class="toolbox-actions">
      <button class="sleek-btn primary" :disabled="isLocked" :style="[disabledActionStyle, !isLocked ? { background: '#9c27b0' } : {}]" @click="$emit('multiMerge')">Merge Together</button>
      
      <div class="divider"></div>

      <template v-if="selectedNodes.every(n => n.data.action === 'deleted' || n.data.conflicts?.some(c => c.type === 'delete'))">
        <button class="sleek-btn outline" :disabled="isLocked" :style="disabledActionStyle" @click="$emit('restore')">Restore All</button>
      </template>
      <template v-else>
        <button class="sleek-btn outline" :disabled="isLocked" :style="[disabledActionStyle, !isLocked ? { color: '#f44336', borderColor: '#f44336' } : {}]" @click="$emit('delete')">Delete</button>
      </template>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';

const props = defineProps({
  selectedNodes: Array,
  isSingleLeafSelected: Boolean,
  localPeerId: String
});

defineEmits([
  'rename', 'addChild', 'split', 'toggleLock', 'delete', 
  'restore', 'multiMerge', 
  'acceptAllMerges', 'acceptConflict'
]);

// 1. Is ANY selected node locked? 
const isLocked = computed(() => {
  if (!props.selectedNodes || props.selectedNodes.length === 0) return false;
  return props.selectedNodes.some(n => n.data.locked);
});

// 2. Can the current user unlock the selection?
const canUnlock = computed(() => {
  if (!props.selectedNodes || props.selectedNodes.length !== 1) return false;
  const n = props.selectedNodes[0].data;
  return n.locked && n.lockedBy === props.localPeerId;
});

// 3. Styling definitions
const disabledActionStyle = computed(() => {
  return isLocked.value ? { opacity: 0.5, cursor: 'not-allowed', borderColor: '#dadce0', color: '#9aa0a6', background: 'transparent' } : {};
});

const disabledUnlockStyle = computed(() => {
  return (isLocked.value && !canUnlock.value) ? { opacity: 0.5, cursor: 'not-allowed', borderColor: '#dadce0', color: '#9aa0a6', background: 'transparent' } : {};
});

function getConflictButtonLabel(conflict) {
  if (conflict.type === 'split-proposal') return `Accept Split: ${conflict.newNames.join(', ')}`;
  if (conflict.type === 'merge-proposal') return `Accept Merge: ${conflict.proposedName}`;
  if (conflict.type === 'rename') return `Accept Rename: "${conflict.value}"`;
  if (conflict.type === 'move-proposal') return `Accept Move`;
  return `Accept ${conflict.type}`;
}
</script>
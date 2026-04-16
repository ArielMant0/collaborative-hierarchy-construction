// Extracts the context-aware action menu for selected nodes

<template>
  <div v-if="selectedNodes.length > 0" class="bottom-toolbox">
    <div class="toolbox-header">
      <span class="selection-badge">{{ selectedNodes.length }} Selected</span>
    </div>
    
    <div v-if="selectedNodes.length === 1" class="toolbox-actions">
      <template v-if="selectedNodes[0].data.action !== 'deleted'">
        <button class="sleek-btn outline" @click="$emit('rename')">Rename</button>
        <button class="sleek-btn outline" @click="$emit('addChild')">Add Child</button>
        <button v-if="isSingleLeafSelected" class="sleek-btn outline" @click="$emit('split')">Split</button>
        <button class="sleek-btn outline" @click="$emit('toggleLock')">{{ selectedNodes[0].data.locked ? 'Unlock' : 'Lock' }}</button>
        <button class="sleek-btn outline" style="color: #f44336; border-color: #f44336;" @click="$emit('delete')">Delete</button>
        
        <template v-if="selectedNodes[0].data.conflicts?.length">
          <div class="divider"></div>
          
          <button 
            v-if="selectedNodes[0].data.conflicts.filter(c => c.type === 'merge-proposal').length > 1"
            class="sleek-btn primary" 
            style="background: #ff9800;"
            @click="$emit('acceptAllMerges')">
            Accept All Merges
          </button>

          <template v-for="(conflict, index) in selectedNodes[0].data.conflicts" :key="conflict.id">
            <button 
              v-if="!(conflict.type === 'merge-proposal' && selectedNodes[0].data.conflicts.filter(c => c.type === 'merge-proposal').length > 1)"
              class="sleek-btn primary" 
              style="background: #ff9800;"
              @click="$emit('acceptConflict', { conflict, index })">
              {{ getConflictButtonLabel(conflict) }}
            </button>
          </template>
        </template>

        <template v-if="selectedNodes[0].data.action && !selectedNodes[0].data.conflicts?.length">
           <div class="divider"></div>
           <button class="sleek-btn primary" style="background: #4caf50;" @click="$emit('approveBaseChange')">
             Approve Base Change
           </button>
        </template>
      </template>

      <template v-else>
        <button class="sleek-btn outline" @click="$emit('restore')">Restore Node</button>
        <button class="sleek-btn primary" style="background: #f44336;" @click="$emit('permanentlyDelete')">Permanently Delete</button>
      </template>
    </div>

    <div v-if="selectedNodes.length > 1" class="toolbox-actions">
      <button class="sleek-btn primary" style="background: #9c27b0;" @click="$emit('multiMerge')">Merge Together</button>
      
      <div class="divider"></div>

      <template v-if="selectedNodes.every(n => n.data.action === 'deleted')">
        <button class="sleek-btn outline" @click="$emit('restore')">Restore</button>
        <button class="sleek-btn primary" style="background: #f44336;" @click="$emit('permanentlyDelete')">Permanently Delete</button>
      </template>
      <template v-else>
        <button class="sleek-btn outline" style="color: #f44336; border-color: #f44336;" @click="$emit('delete')">Delete</button>
      </template>
    </div>
  </div>
</template>

<script setup>
const props = defineProps({
  selectedNodes: Array,
  isSingleLeafSelected: Boolean
});

defineEmits([
  'rename', 'addChild', 'split', 'toggleLock', 'delete', 
  'restore', 'permanentlyDelete', 'multiMerge', 
  'acceptAllMerges', 'acceptConflict', 'approveBaseChange'
]);

function getConflictButtonLabel(conflict) {
  if (conflict.type === 'split-proposal') return `Accept Split: ${conflict.newNames.join(', ')}`;
  if (conflict.type === 'merge-proposal') return `Accept Merge: ${conflict.proposedName}`;
  if (conflict.type === 'rename') return `Accept Rename: "${conflict.value}"`;
  if (conflict.type === 'move-proposal') return `Accept Move`;
  return `Accept ${conflict.type}`;
}
</script>
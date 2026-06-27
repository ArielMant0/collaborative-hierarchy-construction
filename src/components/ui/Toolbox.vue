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
        <button v-if="canSever" class="sleek-btn outline" :disabled="isLocked" :style="disabledActionStyle" @click="$emit('sever')">Sever</button>
        <button class="sleek-btn outline" @click="$emit('pingAll')">Ping All</button>
        
        <!-- Unlock is the ONLY button that behaves differently -->
        <button class="sleek-btn outline" :disabled="isLocked && !canUnlock" :style="disabledUnlockStyle" @click="$emit('toggleLock')">{{ selectedNodes[0].data.locked ? 'Unlock' : 'Lock' }}</button>
        
        <button v-if="selectedNodes[0].data.conflicts?.some(c => c.type === 'delete')" class="sleek-btn outline" :disabled="isLocked" :style="disabledActionStyle" @click="$emit('restore')">Restore Node</button>
        <button v-else class="sleek-btn outline" :disabled="isLocked" :style="[disabledActionStyle, !isLocked ? { color: '#f44336', borderColor: '#f44336' } : {}]" @click="$emit('delete')">Delete</button>
        
        <!-- Use Context-Aware Conflicts instead of local node conflicts -->
        <template v-if="displayableConflicts.length">
          <div class="divider"></div>
          
          <div v-if="hasLocalMultipleMerges" style="display: flex; gap: 4px;">
            <button 
              class="sleek-btn primary" 
              :disabled="isLocked"
              :style="[disabledActionStyle, !isLocked ? { background: '#ff9800' } : {}]"
              @click="$emit('acceptAllMerges', selectedNodes[0].data.id)">
              Accept All Merges
            </button>
            <button 
              class="sleek-btn outline" 
              :disabled="isLocked"
              :style="[disabledActionStyle, !isLocked ? { color: '#f44336', borderColor: '#f44336' } : {}]"
              @click="$emit('discardAllMerges', selectedNodes[0].data.id)">
              Discard All
            </button>
          </div>

          <template v-for="item in displayableConflicts" :key="item.conflict.id">
            <div v-if="!(item.conflict.type === 'merge-proposal' && item.hostNodeId === selectedNodes[0].data.id && hasLocalMultipleMerges)" style="display: flex; gap: 4px;">
              <button 
                class="sleek-btn primary" 
                :disabled="isLocked"
                :style="[disabledActionStyle, !isLocked ? { background: '#ff9800' } : {}]"
                @click="$emit('acceptConflict', { conflict: item.conflict, hostNodeId: item.hostNodeId })">
                {{ getConflictButtonLabel(item.conflict) }}
              </button>
              <button 
                class="sleek-btn outline" 
                :disabled="isLocked"
                :style="[disabledActionStyle, !isLocked ? { color: '#f44336', borderColor: '#f44336' } : {}]"
                @click="$emit('discardConflict', { conflict: item.conflict, hostNodeId: item.hostNodeId })">
                Discard
              </button>
            </div>
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
  localPeerId: String,
  contextConflicts: { type: Array, default: () => [] } 
});

defineEmits([
  'rename', 'addChild', 'split', 'toggleLock', 'delete', 
  'restore', 'multiMerge', 'sever', 'pingAll',
  'acceptAllMerges', 'acceptConflict',
  'discardAllMerges', 'discardConflict' 
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

// 3. Can the node be severed? (Must have a parent that isn't the system root)
const canSever = computed(() => {
  if (!props.selectedNodes || props.selectedNodes.length !== 1) return false;
  const node = props.selectedNodes[0];
  return node.parent && !node.parent.data.isSystemRoot;
});

// 4. Pass all conflicts through. Deletions MUST remain visible to trigger the resolution matrix.
const displayableConflicts = computed(() => {
  return props.contextConflicts;
});

// 5. Strictly verify that the selected node is the ACTUAL host of the merges
const hasLocalMultipleMerges = computed(() => {
  if (!props.selectedNodes || props.selectedNodes.length !== 1) return false;
  const selectedId = props.selectedNodes[0].data.id;
  return displayableConflicts.value.filter(c => c.conflict.type === 'merge-proposal' && c.hostNodeId === selectedId).length > 1;
});

// 6. Styling definitions
const disabledActionStyle = computed(() => {
  return isLocked.value ? { opacity: 0.5, cursor: 'not-allowed', borderColor: '#dadce0', color: '#9aa0a6', background: 'transparent' } : {};
});

const disabledUnlockStyle = computed(() => {
  return (isLocked.value && !canUnlock.value) ? { opacity: 0.5, cursor: 'not-allowed', borderColor: '#dadce0', color: '#9aa0a6', background: 'transparent' } : {};
});

function getConflictButtonLabel(conflict) {
  // Extract the author safely (fallback just in case)
  const author = conflict.by ? ` by ${conflict.by}` : '';

  if (conflict.type === 'split-proposal') return `Accept Split: ${conflict.newNames.join(', ')}${author}`;
  if (conflict.type === 'merge-proposal') return `Accept Merge: ${conflict.proposedName}${author}`;
  if (conflict.type === 'rename') return `Accept Rename: "${conflict.value}"${author}`;
  
  // Utilize the new targetName metadata for moves
  if (conflict.type === 'move-proposal') {
    const destination = conflict.targetName ? ` to '${conflict.targetName}'` : '';
    return `Accept Move${destination}${author}`;
  }

  if (conflict.type === 'sever-proposal') return `Accept Sever${author}`;
  
  if (conflict.type === 'delete') return `Accept Deletion${author}`;
  
  return `Accept ${conflict.type}${author}`;
}
</script>
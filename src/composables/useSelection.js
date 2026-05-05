// Manages local UI state for selected nodes and context menus

import { ref, computed, onMounted, onUnmounted } from 'vue';
import { getSharedTreeJSON } from '../services/crdt.service.js';
import { flattenTree } from '../utils/helpers.js';

export function useSelection() {
  const selectedNodes = ref([]);

  const isSingleLeafSelected = computed(() => {
    if (selectedNodes.value.length !== 1) return false;
    const n = selectedNodes.value[0];
    return !n.data.children || n.data.children.length === 0;
  });

  const clearSelection = () => {
    selectedNodes.value = [];
  };

  const toggleSelection = (node, multi = false) => {
    if (multi) {
      const idx = selectedNodes.value.findIndex(n => n.data.id === node.data.id);
      if (idx > -1) selectedNodes.value.splice(idx, 1);
      else selectedNodes.value.push(node);
    } else {
      selectedNodes.value = [node];
    }
  };

  const handleTreeUpdate = () => {
    // Skip heavy lifting if nothing is selected
    if (selectedNodes.value.length === 0) return;

    // Grab a clean snapshot of the newly synced Yjs document
    const latestData = getSharedTreeJSON();
    if (!latestData) return;

    // Build a quick lookup map of all currently valid nodes
    const allNodes = flattenTree(latestData);
    const nodeMap = new Map(allNodes.map(n => [n.id, n]));

    // Re-evaluate the current selection array
    selectedNodes.value = selectedNodes.value.filter(n => {
      const latestNodeData = nodeMap.get(n.data.id);
      
      // 1. Ghost Selection Fix: Node was physically deleted by a remote peer
      if (!latestNodeData) return false; 
      
      // 2. Stale Context Fix: Overwrite the reactive data reference to trigger Toolbox UI updates
      n.data = latestNodeData;
      return true;
    });
  };

  // Tie the network listener to the lifecycle of App.vue
  onMounted(() => {
    window.addEventListener('tree-updated', handleTreeUpdate);
  });

  onUnmounted(() => {
    window.removeEventListener('tree-updated', handleTreeUpdate);
  });

  return {
    selectedNodes,
    isSingleLeafSelected,
    clearSelection,
    toggleSelection
  };
}
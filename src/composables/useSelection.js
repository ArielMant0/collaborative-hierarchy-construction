// Manages local UI state for selected nodes and context menus

import { ref, computed } from 'vue';

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

  return {
    selectedNodes,
    isSingleLeafSelected,
    clearSelection,
    toggleSelection
  };
}
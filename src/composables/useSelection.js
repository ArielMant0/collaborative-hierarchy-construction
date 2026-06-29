import { ref, computed, watch } from 'vue';
import { flattenTree } from '../utils/helpers.js';

export function useSelection(activeData) {
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

  watch(activeData, (newData) => {
    if (selectedNodes.value.length === 0 || !newData) return;
    const allNodes = flattenTree(newData);
    const nodeMap = new Map(allNodes.map(n => [n.id, n]));

    selectedNodes.value = selectedNodes.value.filter(n => {
      const latestNodeData = nodeMap.get(n.data.id);
      if (!latestNodeData) return false; 
      n.data = latestNodeData;
      return true;
    });
  }, { deep: true });

  return {
    selectedNodes,
    isSingleLeafSelected,
    clearSelection,
    toggleSelection
  };
}
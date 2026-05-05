// A lightweight wrapper that mounts the d3.renderer.js to a ref and watches for data changes.
// This file bridges the pure D3 logic into the Vue template

<template>
  <div class="canvas-container">
    <div class="canvas-controls">
      <button class="icon-btn" @click="recenter" title="Recenter View">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="4"></circle>
          <path d="M12 2v2"></path><path d="M12 20v2"></path>
          <path d="M2 12h2"></path><path d="M20 12h2"></path>
        </svg>
      </button>
    </div>
    <svg ref="svgRef" width="100%" height="100%" @dblclick.self="handleCanvasDoubleClick"></svg>
    
    <div v-if="mergeTooltip.show" class="merge-tooltip" :style="{ top: mergeTooltip.y + 'px', left: mergeTooltip.x + 'px' }" v-html="mergeTooltip.html"></div>
  </div>
</template>

<script setup>
import { ref, onMounted, watch, onUnmounted } from 'vue';
import { TreeRenderer } from '../../services/d3.renderer.js';

const props = defineProps({
  treeData: Object,
  isDraftMode: Boolean,
  localPeerId: String,
  selectedIds: Set
});

const emit = defineEmits(['node-selected', 'node-moved', 'add-floating-node']);

function handleCanvasDoubleClick() {
  emit('add-floating-node');
}

const svgRef = ref(null);
const mergeTooltip = ref({ show: false, x: 0, y: 0, html: '' });
let renderer = null;

function recenter() {
  if (renderer && props.treeData) {
    renderer.recenter(props.treeData, true);
  }
}

function handleHover({ event, d }) {
  if (d.data.mergedFrom && d.data.mergedStructure) {
    const generateHtml = (node) => {
      let str = `<li>${node.name}</li>`;
      if (node.children && node.children.length) {
        str += `<ul>${node.children.map(generateHtml).join('')}</ul>`;
      }
      return str;
    };
    
    const treeHtml = `
      <div style="color: #9c27b0; font-weight: bold; margin-bottom: 12px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 1px solid #e0e0e0; padding-bottom: 4px;">
        Merge History
      </div>
      <div>
        <div style="font-size: 10px; color: #5f6368; text-transform: uppercase; margin-bottom: 4px;">Original Branches</div>
        <ul>${d.data.mergedStructure.source.children.map(generateHtml).join('')}</ul>
      </div>
    `;
    mergeTooltip.value = { show: true, x: event.pageX + 20, y: event.pageY + 20, html: treeHtml };
  } else if (d.data.splitFrom && d.data.splitStructure) {
    const generateHtml = (node) => {
      const isCurrent = node.name === d.data.name;
      let str = `<li style="${isCurrent ? 'color: #e91e63; font-weight: 800;' : ''}">${node.name}</li>`;
      if (node.children && node.children.length) {
        str += `<ul>${node.children.map(generateHtml).join('')}</ul>`;
      }
      return str;
    };

    const treeHtml = `
      <div style="color: #e91e63; font-weight: bold; margin-bottom: 12px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 1px solid #e0e0e0; padding-bottom: 4px;">
        Split History
      </div>
      <div>
        <div style="font-size: 10px; color: #5f6368; text-transform: uppercase; margin-bottom: 4px;">Original Category</div>
        <ul>${generateHtml(d.data.splitStructure)}</ul>
      </div>
    `;
    mergeTooltip.value = { show: true, x: event.pageX + 20, y: event.pageY + 20, html: treeHtml };
  } else if (d.data.conflicts && d.data.conflicts.length > 0) {
    const renames = d.data.conflicts.filter(c => c.type === 'rename');
    const merges = d.data.conflicts.filter(c => c.type === 'merge-proposal');
    const splits = d.data.conflicts.filter(c => c.type === 'split-proposal');
    const deletes = d.data.conflicts.filter(c => c.type === 'delete');

    let content = '';
    if (renames.length) content += `<div style="margin-bottom:6px;"><strong style="font-size:10px;color:#ff9800;display:block;margin-bottom:2px;">RENAMES</strong>${renames.map(c => `<div style="color:#5f6368;">"${c.value}" <span style="font-size:9px;color:#888;">by ${c.by}</span></div>`).join('')}</div>`;
    if (merges.length) content += `<div style="margin-bottom:6px;"><strong style="font-size:10px;color:#9c27b0;display:block;margin-bottom:2px;">MERGING</strong>${merges.map(c => `<div style="color:#5f6368;">${c.sourceName} <span style="font-size:9px;color:#888;">by ${c.by}</span></div>`).join('')}</div>`;
    if (splits.length) content += `<div style="margin-bottom:6px;"><strong style="font-size:10px;color:#e91e63;display:block;margin-bottom:2px;">SPLITTING TO</strong>${splits.map(c => `<div style="color:#5f6368;">${c.newNames.join(', ')} <span style="font-size:9px;color:#888;">by ${c.by}</span></div>`).join('')}</div>`;
    if (deletes.length) content += `<div style="margin-bottom:6px;"><strong style="font-size:10px;color:#f44336;display:block;margin-bottom:2px;">DELETION</strong>${deletes.map(c => `<div style="color:#5f6368;">Requested <span style="font-size:9px;color:#888;">by ${c.by}</span></div>`).join('')}</div>`;

    const treeHtml = `
      <div style="color: #ff9800; font-weight: bold; margin-bottom: 12px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 1px solid #e0e0e0; padding-bottom: 4px;">
        Pending Proposals (${d.data.conflicts.length})
      </div>
      <div>${content}</div>
    `;
    mergeTooltip.value = { show: true, x: event.pageX + 20, y: event.pageY + 20, html: treeHtml };
  } else if (d.data.deletedChildren && d.data.deletedChildren.length > 0) {
    // Deletion History Tooltip
    const generateHtml = (node) => {
      let str = `<li>${node.name}</li>`;
      if (node.children && node.children.length) {
        str += `<ul>${node.children.map(generateHtml).join('')}</ul>`;
      }
      return str;
    };

    const treeHtml = `
      <div style="color: #f44336; font-weight: bold; margin-bottom: 12px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 1px solid #e0e0e0; padding-bottom: 4px;">
        Deletion History
      </div>
      <div>
        <div style="font-size: 10px; color: #5f6368; text-transform: uppercase; margin-bottom: 4px;">Removed Categories</div>
        <ul>${d.data.deletedChildren.map(generateHtml).join('')}</ul>
      </div>
    `;
    mergeTooltip.value = { show: true, x: event.pageX + 20, y: event.pageY + 20, html: treeHtml };
  }
}

function handleHoverLeave() {
  mergeTooltip.value.show = false;
}

function handleMouseMove(e) {
  if (mergeTooltip.value.show) {
    mergeTooltip.value.x = e.pageX + 20;
    mergeTooltip.value.y = e.pageY + 20;
  }
}

const showDeleted = ref(true);

function toggleDeleted() {
  showDeleted.value = !showDeleted.value;
}

onMounted(() => {
  renderer = new TreeRenderer(svgRef.value, {
    onSelect: (payload) => emit('node-selected', payload),
    onMove: (payload) => emit('node-moved', payload),
    onHover: handleHover,
    onHoverLeave: handleHoverLeave
  });
  
  d3.select(svgRef.value).on("dblclick.zoom", null);

  window.addEventListener('mousemove', handleMouseMove);

  renderer.updateContext({
    isDraftMode: props.isDraftMode,
    localPeerId: props.localPeerId,
    selectedIds: props.selectedIds
  });

  if (props.treeData) renderer.render(props.treeData);
});

// ... (keep the other watch hooks exactly as they are)

watch(() => [props.isDraftMode, props.localPeerId, props.selectedIds], () => {
  if (renderer) {
    renderer.updateContext({
      isDraftMode: props.isDraftMode,
      localPeerId: props.localPeerId,
      selectedIds: props.selectedIds
    });
    renderer.render(props.treeData);
  }
}, { deep: true });

onUnmounted(() => {
  window.removeEventListener('mousemove', handleMouseMove);
});

watch(() => props.treeData, (newData) => {
  if (renderer && newData) renderer.render(newData);
}, { deep: true });

watch(() => [props.isDraftMode, props.localPeerId, props.selectedIds, showDeleted.value], (newVals, oldVals) => {
  if (renderer) {
    renderer.updateContext({
      isDraftMode: props.isDraftMode,
      localPeerId: props.localPeerId,
      selectedIds: props.selectedIds,
      showDeleted: showDeleted.value
    });
    renderer.render(props.treeData);
    
    // Only snap the tree to the center if the 'showDeleted' toggle 
    const showDeletedChanged = oldVals && oldVals[3] !== newVals[3];
    if (showDeletedChanged && !newVals[3]) {
      renderer.recenter(props.treeData, true);
    }
  }
}, { deep: true });
</script>

<style>
.merge-tooltip {
  position: absolute;
  background: rgba(255, 255, 255, 0.98);
  color: #333;
  padding: 12px 16px;
  border-radius: 8px;
  font-family: system-ui, -apple-system, sans-serif;
  font-size: 13px;
  pointer-events: none;
  z-index: 3000;
  box-shadow: 0 4px 12px rgba(0,0,0,0.15);
  border: 1px solid #e0e0e0;
}
.merge-tooltip ul { 
  margin: 6px 0 0 4px; 
  padding-left: 12px; 
  list-style-type: none; 
  border-left: 2px dashed #b0bec5; 
}
.merge-tooltip li { 
  position: relative; 
  margin-bottom: 4px; 
  font-weight: 500;
}
.merge-tooltip li::before { 
  content: ""; 
  position: absolute; 
  left: -14px; 
  top: 7px; 
  width: 10px; 
  height: 2px; 
  background: #b0bec5; 
}
.merge-tooltip > div > ul {
  border-left: none;
  padding-left: 0;
  margin-left: 0;
}
.merge-tooltip > div > ul > li::before {
  display: none;
}
.canvas-controls {
  position: absolute;
  top: 76px;
  right: 24px;
  z-index: 100;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.icon-btn {
  display: flex;
  padding: 8px;
  background: white;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  color: #5f6368;
  cursor: pointer;
  box-shadow: 0 4px 6px rgba(0,0,0,0.05);
  transition: all 0.2s;
}
.icon-btn:hover { background: #f8f9fa; color: #333; }
.icon-btn.active { color: #1a73e8; border-color: #1a73e8; background: #e8f0fe; }
</style>
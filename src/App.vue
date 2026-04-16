<template>
  <div class="dashboard" @click.self="clearSelection">
    <TopBar 
      :isDraftMode="isDraftMode" 
      :netState="netState"
      @switchMode="switchMode"
      @commitChanges="commitChanges"
      @initHost="initHost"
      @joinHost="joinHost"
      @updateUsername="(val) => netState.username = val"
    />

    <TreeCanvas 
      :treeData="activeData"
      :isDraftMode="isDraftMode"
      :localPeerId="netState.peerId"
      :selectedIds="selectedIds"
      @node-selected="(payload) => toggleSelection(payload.d, payload.event.ctrlKey || payload.event.metaKey)"
      @node-moved="handleNodeMoved"
    />

    <Toolbox 
      :selectedNodes="selectedNodes"
      :isSingleLeafSelected="isSingleLeafSelected"
      @rename="openRenameModal"
      @addChild="addChild"
      @split="openSplitModal"
      @toggleLock="toggleLock"
      @delete="deleteNode"
      @restore="restoreNode"
      @permanentlyDelete="permanentlyDeleteNode"
      @multiMerge="openMultiMergeModal"
      @acceptAllMerges="acceptAllMerges"
      @acceptConflict="(payload) => acceptConflict(payload.conflict, payload.index)"
      @approveBaseChange="approveCurrentChange"
    />

    <RenameModal 
      :show="renameModal.show" 
      :initialName="renameModal.newName" 
      @close="renameModal.show = false" 
      @submit="submitRename" 
    />

    <SplitModal 
      :show="splitModal.show" 
      :nodeName="splitModal.node?.data.name" 
      @close="splitModal.show = false" 
      @submit="confirmSplit" 
    />

    <MergeModal 
      :show="multiMergeModal.show" 
      :count="selectedNodes.length" 
      @close="multiMergeModal.show = false" 
      @submit="confirmMultiMerge" 
    />

    <ConflictModal 
      :show="resolutionModal.show" 
      :conflict="resolutionModal.conflict" 
      :nodeName="resolutionModal.node?.name" 
      :options="resolutionModal.options" 
      @close="resolutionModal.show = false" 
      @execute="executeResolution" 
    />
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import * as d3 from 'd3';
import * as Y from 'yjs';
import mechanicsData from './tag-hierarchy-mechanics.json';

// Composables
import { useNetwork } from './composables/useNetwork.js';
import { useTreeState } from './composables/useTreeState.js';
import { useSelection } from './composables/useSelection.js';

// Components
import TopBar from './components/ui/TopBar.vue';
import Toolbox from './components/ui/Toolbox.vue';
import TreeCanvas from './components/canvas/TreeCanvas.vue';
import RenameModal from './components/ui/modals/RenameModal.vue';
import SplitModal from './components/ui/modals/SplitModal.vue';
import MergeModal from './components/ui/modals/MergeModal.vue';
import ConflictModal from './components/ui/modals/ConflictModal.vue';

// Services & Utils
import { sharedTree, ydoc } from './services/crdt.service.js';
import { generateId, canEditNode, cloneNode, addUUIDs, flattenTree } from './utils/helpers.js';

// 1. Initialize Composables
const { netState, joinId, initHost, joinHost } = useNetwork();
const { isDraftMode, liveTreeData, draftTreeData, activeData, switchMode, applyChange, commitChanges, syncFromNetwork } = useTreeState(netState);
const { selectedNodes, isSingleLeafSelected, clearSelection, toggleSelection } = useSelection();

const selectedIds = computed(() => new Set(selectedNodes.value.map(n => n.data.id)));

// Modal States
const renameModal = ref({ show: false, node: null, newName: '' });
const splitModal = ref({ show: false, node: null });
const multiMergeModal = ref({ show: false });
const resolutionModal = ref({ show: false, conflict: null, index: null, node: null, options: [] });

// 2. Lifecycle
onMounted(() => { 
  if (!sharedTree.get('root')) {
    const baseData = JSON.parse(JSON.stringify(mechanicsData));
    addUUIDs(baseData);
    ydoc.transact(() => { sharedTree.set('root', JSON.stringify(baseData)); });
  }
  syncFromNetwork(); 
});

// 3. Node Operations
function handleNodeMoved({ draggedNode, targetNode }) {
  if (draggedNode.parent && draggedNode.parent.data.id === targetNode.data.id) return;

  const sourceData = draggedNode.data;
  const targetData = targetNode.data;

  const ghostId = generateId();
  const ghostNode = {
    ...cloneNode(sourceData, netState.username),
    id: ghostId,
    isGhost: true,
    action: 'added',
    lastEditedBy: netState.username
  };

  if (!targetData.children) targetData.children = [];
  targetData.children.push(ghostNode);

  sourceData.action = 'pending-move';
  if (!sourceData.conflicts) sourceData.conflicts = [];
  
  sourceData.conflicts.push({
    id: generateId(),
    type: 'move-proposal',
    ghostId: ghostId,
    targetId: targetData.id,
    by: netState.username
  });

  applyChange();
}

function toggleLock() {
  const n = selectedNodes.value[0].data;
  if (n.locked && n.lockedBy !== netState.peerId) {
    alert(`Cannot unlock. Node is locked.`);
    return;
  }
  n.locked = !n.locked;
  if (n.locked) {
    n.lockedBy = netState.peerId;
    n.lockedByName = netState.username;
  } else {
    delete n.lockedBy;
    delete n.lockedByName;
  }
  n.lastEditedBy = netState.username;
  if (isDraftMode.value) n._isDraft = true;
  applyChange();
}

function addChild() {
  const n = selectedNodes.value[0].data;
  if (!canEditNode(n, netState.peerId)) return alert("Node is locked or deleted!"); 
  if (!n.children) n.children = [];
  n.children.push({ 
    name: "New Node", 
    _isDraft: isDraftMode.value ? true : undefined, 
    id: generateId(),
    lastEditedBy: netState.username,
    action: 'added'
  });
  applyChange();
}

function openRenameModal() {
  const n = selectedNodes.value[0].data;
  if (!canEditNode(n, netState.peerId)) return alert("Node is locked!");
  renameModal.value = { show: true, node: n, newName: n.name };
}

function submitRename(newName) {
  const n = renameModal.value.node;
  if (newName && newName !== n.name) { 
    if (n.action && n.lastEditedBy !== netState.username) {
      if (!n.conflicts) n.conflicts = [];
      n.conflicts.push({ id: generateId(), type: 'rename', value: newName, by: netState.username });
    } else {
      n.name = newName; 
      if (n.action !== 'added') n.action = 'renamed'; 
      n.lastEditedBy = netState.username;
    }
    if (isDraftMode.value) n._isDraft = true; 
    applyChange(); 
  }
  renameModal.value.show = false;
}

function deleteNode() {
  selectedNodes.value.forEach(n => {
    if (n.depth === 0) return alert("Cannot delete root node."); 
    if (!canEditNode(n.data, netState.peerId)) return;
    
    if (n.data.action && n.data.lastEditedBy !== netState.username) {
      if (!n.data.conflicts) n.data.conflicts = [];
      n.data.conflicts.push({ id: generateId(), type: 'delete', by: netState.username });
    } else {
      n.data.action = 'deleted';
      n.data.lastEditedBy = netState.username;
    }
    if (isDraftMode.value) n.data._isDraft = true;
  });
  selectedNodes.value = []; 
  applyChange();
}

function permanentlyDeleteNode() {
  selectedNodes.value.forEach(n => {
    if (!n.parent) return; 
    const parentData = n.parent.data;
    const idx = parentData.children.findIndex(c => c.id === n.data.id);
    if (idx > -1) parentData.children.splice(idx, 1);
  });
  selectedNodes.value = []; 
  applyChange();
}

function restoreNode() {
  selectedNodes.value.forEach(n => {
    delete n.data.action;
    delete n.data.lastEditedBy;
    if (isDraftMode.value) n.data._isDraft = true;
  });
  applyChange();
}

function approveCurrentChange() {
  const n = selectedNodes.value[0].data;
  delete n.action;
  delete n.lastEditedBy;
  if (isDraftMode.value) n._isDraft = true;
  applyChange();
}

// 4. Split & Merge Engine
function openSplitModal() {
  const n = selectedNodes.value[0];
  if (n.depth === 0) return alert("Cannot split root node.");
  splitModal.value = { show: true, node: n };
}

function confirmSplit(newNamesString) {
  const d3Node = splitModal.value.node;
  const nodeData = d3Node.data;
  const parentData = d3Node.parent.data;
  const names = newNamesString.split(',').map(n => n.trim()).filter(n => n);
  
  if (names.length < 2) return alert("Provide at least two names.");
  const ghostIds = [];

  if (!parentData.children) parentData.children = [];
  names.forEach(name => {
    const ghost = { id: generateId(), name: name, isGhost: true, action: 'added', lastEditedBy: netState.username };
    ghostIds.push(ghost.id);
    parentData.children.push(ghost);
  });

  nodeData.action = 'pending-split';
  if (!nodeData.conflicts) nodeData.conflicts = [];
  nodeData.conflicts.push({ id: generateId(), type: 'split-proposal', ghostIds: ghostIds, newNames: names, by: netState.username });

  applyChange();
  splitModal.value.show = false;
}

function openMultiMergeModal() {
  const firstParentId = selectedNodes.value[0].parent ? selectedNodes.value[0].parent.data.id : 'root';
  const allShareSameParent = selectedNodes.value.every(n => (n.parent ? n.parent.data.id : 'root') === firstParentId);
  if (!allShareSameParent) return alert("Merge rejected: Only categories with the exact same parent can be merged.");
  multiMergeModal.value.show = true;
}

function confirmMultiMerge(newNameStr) {
  const targetParent = selectedNodes.value[0].parent ? selectedNodes.value[0].parent.data : activeData.value;
  const newName = newNameStr || "Consolidated Category";

  const newNode = { id: generateId(), name: newName, action: 'added', lastEditedBy: netState.username, children: [], conflicts: [] };

  selectedNodes.value.forEach(d => {
    const sourceData = d.data;
    sourceData.action = 'pending-merge'; 
    newNode.conflicts.push({
      id: generateId(), type: 'merge-proposal', sourceId: sourceData.id, sourceName: sourceData.name,
      originalTargetName: newName, proposedName: newName, by: netState.username
    });

    if (sourceData.children) {
      const makeGhost = (node) => {
        const ghost = cloneNode(node, netState.username);
        ghost.isGhost = true;
        if (ghost.children) ghost.children = ghost.children.map(makeGhost);
        return ghost;
      };
      sourceData.children.forEach(child => newNode.children.push(makeGhost(child)));
    }
  });

  if (!targetParent.children) targetParent.children = [];
  targetParent.children.push(newNode);
  selectedNodes.value = [];
  applyChange();
  multiMergeModal.value.show = false;
}

// 5. Conflict Resolution Matrix
function acceptConflict(conflict, index) {
  const n = selectedNodes.value[0].data;
  const actionMap = {
    'delete': 'delete-node', 'rename': 'rename-node', 'move-proposal': 'move-node',
    'split-proposal': 'split-replace', 'merge-proposal': 'merge-node'
  };
  const action = actionMap[conflict.type];
  if (!action) return;

  resolutionModal.value = { show: false, conflict, index, node: n, options: [] };
  executeResolution({ action });
}

function acceptAllMerges() {
  const n = selectedNodes.value[0].data;
  const referenceConflict = n.conflicts.find(c => c.type === 'merge-proposal');
  if (!referenceConflict) return;
  resolutionModal.value = { show: false, conflict: referenceConflict, index: null, node: n, options: [] };
  executeResolution({ action: 'n-merges' }); 
}

function executeResolution(option) {
  const { conflict, node } = resolutionModal.value;
  
  // 1. FORCE LIVE CONTEXT: Resolutions must update the shared state immediately
  // We use the liveTreeData to ensure the broadcast is accurate
  const root = d3.hierarchy(liveTreeData.value);
  
  // Find the node and its parent in the LIVE data
  let liveNode = null;
  let liveParent = null;
  root.each(n => {
    if (n.data.id === node.id) liveNode = n.data;
    if (n.children && n.children.some(c => c.data.id === node.id)) liveParent = n.data;
  });

  if (!liveNode) return;

  // 2. CONFLICT PURGING: Choosing one path invalidates all other pending proposals on this node
  liveNode.conflicts = [];
  delete liveNode.action;

  const act = option.action;

  // --- DELETE RESOLUTION ---
  if (act === 'delete-node') liveNode.action = 'deleted';

  // --- RENAME RESOLUTION ---
  else if (act === 'rename-node') {
    liveNode.name = conflict.value || conflict.proposedName || liveNode.name;
    liveNode.action = 'renamed';
  }

  // --- MOVE RESOLUTION ---
  else if (act === 'move-node') {
    const targetParent = root.descendants().find(n => n.data.id === conflict.targetId);
    if (targetParent && liveParent) {
      // Physically remove from old parent
      const idx = liveParent.children.findIndex(c => c.id === liveNode.id);
      liveParent.children.splice(idx, 1);
      
      // Physically remove the Ghost Projection from the target
      const gIdx = targetParent.data.children.findIndex(c => c.id === conflict.ghostId);
      if (gIdx > -1) targetParent.data.children.splice(gIdx, 1);
      
      // Attach to new parent
      if (!targetParent.data.children) targetParent.data.children = [];
      targetParent.data.children.push(liveNode);
      liveNode.action = 'moved';
    }
  }

  // --- SPLIT RESOLUTION ---
  else if (act.startsWith('split')) {
    if (conflict.ghostIds && liveParent) {
      conflict.ghostIds.forEach(gId => {
        const gIdx = liveParent.children.findIndex(c => c.id === gId);
        if (gIdx > -1) liveParent.children.splice(gIdx, 1);
      });
    }
    const idx = liveParent.children.findIndex(c => c.id === liveNode.id);
    if (idx > -1) liveParent.children.splice(idx, 1);
    
    const historicalSplitTree = { name: liveNode.name, children: conflict.newNames.map(n => ({ name: n })) };
    conflict.newNames.forEach(name => {
      liveParent.children.push({
        id: generateId(), name: name, action: 'added', lastEditedBy: netState.username,
        splitFrom: liveNode.name, splitStructure: historicalSplitTree
      });
    });
  }

  // --- MERGE RESOLUTION ---
  else if (act.includes('merge')) {
    const isMulti = act.startsWith('n-merges');
    const mergesToProcess = isMulti ? node.conflicts.filter(c => c.type === 'merge-proposal') : [conflict];
    
    if (!liveNode.mergedStructure) liveNode.mergedStructure = { source: { children: [] } };
    
    mergesToProcess.forEach(mConf => {
      let sourceParent = null, sourceData = null;
      root.each(n => {
        if (n.children && n.children.some(c => c.data.id === mConf.sourceId)) {
          sourceParent = n.data;
          sourceData = n.children.find(c => c.data.id === mConf.sourceId).data;
        }
      });

      if (sourceParent && sourceData) {
        // Log history
        liveNode.mergedStructure.source.children.push({
          name: sourceData.name,
          children: sourceData.children ? cloneNode(sourceData, netState.username).children : []
        });

        // Physically DELETE the source node from the tree
        const srcIdx = sourceParent.children.findIndex(c => c.id === mConf.sourceId);
        if (srcIdx > -1) sourceParent.children.splice(srcIdx, 1);
        
        // Adopt children
        if (sourceData.children) {
          if (!liveNode.children) liveNode.children = [];
          sourceData.children.forEach(child => liveNode.children.push(cloneNode(child, netState.username)));
        }
      }
    });
    
    liveNode.name = conflict.proposedName || liveNode.name;
    liveNode.action = 'added'; // Solidify the new category
    if (liveNode.children) liveNode.children = liveNode.children.filter(c => !c.isGhost);
  }

  liveNode.lastEditedBy = netState.username;
  
  resolutionModal.value.show = false;
  
  // 3. GLOBAL CLEANUP: Now that sources are physically gone, losers will be detected
  cleanupOrphanedArtifacts(); 
  
  // 4. FORCE SYNC: Bypass draft mode and broadcast the new reality
  forceGlobalSync();
}

// Helper to force a network broadcast regardless of current UI mode
function forceGlobalSync() {
  const cleanLive = JSON.parse(JSON.stringify(liveTreeData.value));
  removeDraftFlag(cleanLive);
  updateSharedTreeRoot(JSON.stringify(cleanLive));
  webrtcService.sendUpdate(encodeCurrentState(), netState.isHost);
  
  // If we are in draft mode, we must re-sync our draft to the new live reality
  if (isDraftMode.value) {
    draftTreeData.value = JSON.parse(JSON.stringify(liveTreeData.value));
  }
}

function cleanupOrphanedArtifacts() {
  const root = d3.hierarchy(liveTreeData.value);
  const validGhostIds = new Set();
  const allCurrentIds = new Set();

  root.each(n => {
    allCurrentIds.add(n.data.id);
    if (n.data.conflicts) {
      n.data.conflicts.forEach(c => {
        if (c.type === 'split-proposal' && c.ghostIds) c.ghostIds.forEach(id => validGhostIds.add(id));
        if (c.type === 'move-proposal' && c.ghostId) validGhostIds.add(c.ghostId);
      });
    }
  });

  function traverseAndClean(parentData) {
    if (!parentData.children) return;
    parentData.children = parentData.children.filter(child => {
      // Delete ghosts belonging to rejected/completed split or move proposals
      if (child.isGhost && !validGhostIds.has(child.id)) return false;

      // COMPETITIVE MERGE INVALIDATION
      // If this node is a merge target, and ONE of its source nodes has been 
      // merged elsewhere (and is thus missing), this target is now invalid.
      if (child.conflicts && child.conflicts.some(c => c.type === 'merge-proposal')) {
        const mergeConflicts = child.conflicts.filter(c => c.type === 'merge-proposal');
        const allSourcesStillExist = mergeConflicts.every(mc => allCurrentIds.has(mc.sourceId));
        if (!allSourcesStillExist) return false; 
      }
      return true;
    });
    parentData.children.forEach(traverseAndClean);
  }
  traverseAndClean(liveTreeData.value);
}
</script>

<style>
:root {
  --font-family: system-ui, -apple-system, sans-serif;
}
#app { max-width: 100% !important; padding: 0 !important; display: block !important; }
body { margin: 0 !important; overflow: hidden !important; font-family: var(--font-family); }

/* Component Styles ported from monolith */
.dashboard { background-color: #f8f9fa; position: fixed; top: 0; left: 0; right: 0; bottom: 0; z-index: 1000; }
.sleek-top-bar { position: absolute; top: 0; left: 0; right: 0; height: 56px; background: rgba(255, 255, 255, 0.95); backdrop-filter: blur(8px); border-bottom: 1px solid #e5e5e5; display: flex; align-items: center; justify-content: space-between; padding: 0 24px; box-sizing: border-box; z-index: 100; box-shadow: 0 1px 3px rgba(0,0,0,0.02); min-width: 700px; }
.workspace-controls, .network-controls, .auth-row, .connected-row { display: flex; align-items: center; gap: 12px; }
.segmented-control { display: flex; background: #f1f3f4; padding: 4px; border-radius: 8px; }
.segmented-control button { background: transparent; border: none; padding: 6px 16px; border-radius: 6px; font-weight: 600; font-size: 13px; color: #5f6368; cursor: pointer; transition: all 0.2s ease; }
.segmented-control button.active { background: white; color: #202124; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
.sleek-input { border: 1px solid #dadce0; background: #f8f9fa; padding: 8px 12px; border-radius: 6px; font-size: 13px; outline: none; transition: border 0.2s; width: 120px; }
.sleek-input:focus { border-color: #1a73e8; background: white; }
.sleek-btn { display: flex; align-items: center; gap: 6px; padding: 8px 16px; border-radius: 6px; font-weight: 600; font-size: 13px; cursor: pointer; transition: all 0.2s ease; border: none; }
.sleek-btn.primary { background: #1a73e8; color: white; }
.sleek-btn.outline { background: transparent; border: 1px solid #dadce0; color: #1a73e8; }
.sleek-btn.commit-btn { background: #0f9d58; }
.divider { width: 1px; height: 24px; background: #e5e5e5; margin: 0 4px; }
.or-text { font-size: 12px; color: #888; font-weight: 500; }
.user-badge { display: flex; align-items: center; gap: 8px; padding: 6px 12px; background: #f8f9fa; border: 1px solid #e8eaed; border-radius: 20px; }
.status-dot { width: 8px; height: 8px; background: #0f9d58; border-radius: 50%; }
.username { font-weight: 600; font-size: 13px; color: #202124; }
.role-badge { background: #e8f0fe; color: #1a73e8; padding: 2px 8px; border-radius: 10px; font-size: 11px; font-weight: 700; text-transform: uppercase; }
.bottom-toolbox { position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%); background: rgba(255, 255, 255, 0.95); backdrop-filter: blur(8px); border: 1px solid #e0e0e0; border-radius: 12px; box-shadow: 0 8px 24px rgba(0,0,0,0.12); padding: 12px 24px; display: flex; align-items: center; gap: 16px; z-index: 1000; animation: slideUpToolbox 0.2s ease-out; }
.toolbox-header { border-right: 1px solid #e0e0e0; padding-right: 16px; }
.selection-badge { background: #e8f0fe; color: #1a73e8; padding: 4px 10px; border-radius: 16px; font-size: 12px; font-weight: bold; text-transform: uppercase; }
.toolbox-actions { display: flex; gap: 8px; align-items: center; }
.modal-overlay { position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(0, 0, 0, 0.4); backdrop-filter: blur(2px); display: flex; align-items: center; justify-content: center; z-index: 2000; }
.modal-content { background: white; padding: 24px; border-radius: 12px; box-shadow: 0 10px 25px rgba(0,0,0,0.15); width: 300px; display: flex; flex-direction: column; gap: 16px; font-family: system-ui, -apple-system, sans-serif; animation: slideUp 0.2s ease-out; }
.modal-content h3 { margin: 0; font-size: 16px; color: #202124; }
.full-width { width: 100%; box-sizing: border-box; }
.modal-actions { display: flex; justify-content: flex-end; gap: 8px; }
.canvas-container { position: absolute; top: 0; left: 0; width: 100%; height: 100%; cursor: grab; }
.canvas-container:active { cursor: grabbing; }
.recenter-btn { position: absolute; top: 76px; right: 24px; z-index: 100; display: flex; padding: 8px; background: white; border: 1px solid #ccc; border-radius: 8px; color: #5f6368; cursor: pointer; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
@keyframes slideUpToolbox { from { opacity: 0; transform: translate(-50%, 20px); } to { opacity: 1; transform: translate(-50%, 0); } }
@keyframes slideUp { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
</style>
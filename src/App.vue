<template>
  <div class="dashboard" @click.self="clearSelection">
    <TopBar 
      :isDraftMode="isDraftMode" 
      :netState="netState"
      :layoutMode="layoutMode"
      @switchMode="switchMode"
      @commitChanges="commitChanges"
      @initHost="initHost"
      @joinHost="joinHost"
      @updateUsername="(val) => netState.username = val"
      @updateLayout="(val) => layoutMode = val"
      @addDockedNode="openAddNodeModal"
    />

    <template v-if="netState.isReady || netState.status === 'disconnected'">
      <TreeCanvas 
        :treeData="activeData"
        :isDraftMode="isDraftMode"
        :localPeerId="netState.peerId"
        :selectedIds="selectedIds"
        :layoutMode="layoutMode"
        @node-selected="(payload) => toggleSelection(payload.d, payload.event.ctrlKey || payload.event.metaKey)"
        @node-moved="handleNodeMoved"
        @docked-node-placed="handleDockedNodePlaced"
      />

      <Toolbox 
        :selectedNodes="selectedNodes"
        :isSingleLeafSelected="isSingleLeafSelected"
        :localPeerId="netState.peerId"
        :contextConflicts="contextConflicts"
        @rename="openRenameModal"
        @addChild="addChild"
        @split="openSplitModal"
        @toggleLock="toggleLock"
        @delete="deleteNode"
        @restore="restoreNode"
        @multiMerge="openMultiMergeModal"
        @acceptAllMerges="(hostId) => acceptAllMerges(hostId)"
        @acceptConflict="acceptConflict"
        @discardAllMerges="(hostId) => discardAllMerges(hostId)" 
        @discardConflict="discardConflict" 
      />
    </template>

    <div v-else class="modal-overlay">
      <div class="modal-content" style="width: auto; text-align: center; font-weight: 600; color: #5f6368;">
        Synchronizing canonical state...
      </div>
    </div>

    <RenameModal 
      :show="renameModal.show" 
      :initialName="renameModal.newName" 
      @close="renameModal.show = false" 
      @submit="submitRename" 
    />

    <RenameModal 
      :show="addNodeModal.show" 
      :initialName="'New Concept'" 
      @close="addNodeModal.show = false" 
      @submit="submitAddNode" 
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
      :parentOptions="multiMergeModal.parentOptions"
      @close="multiMergeModal.show = false" 
      @submit="confirmMultiMerge" 
    />

    <DeleteModal 
      :show="deleteModal.show" 
      :nodeName="deleteModal.name" 
      @close="deleteModal.show = false" 
      @submit="confirmDelete" 
    />

  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue';
import * as d3 from 'd3';
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
import DeleteModal from './components/ui/modals/DeleteModal.vue';

// Services & Utils
import { sharedTree, updateSharedTreeRoot, encodeCurrentState } from './services/crdt.service.js';
import { webrtcService } from './services/webrtc.service.js';
import { generateId, canEditNode, cloneNode, addUUIDs, removeDraftFlag } from './utils/helpers.js';

// 1. Initialize Composables
const { netState, initHost, joinHost } = useNetwork();
const { isDraftMode, liveTreeData, draftTreeData, activeData, switchMode, applyChange, commitChanges, syncFromNetwork } = useTreeState(netState);
const { selectedNodes, isSingleLeafSelected, clearSelection, toggleSelection } = useSelection();

const selectedIds = computed(() => new Set(selectedNodes.value.map(n => n.data.id)));

// Scans the tree for conflicts hosted elsewhere that involve the selected node
const contextConflicts = computed(() => {
  if (selectedNodes.value.length !== 1 || !activeData.value) return [];
  const selectedId = selectedNodes.value[0].data.id;
  const conflicts = [];
  
  const root = d3.hierarchy(activeData.value);
  root.each(n => {
    if (n.data.conflicts) {
      n.data.conflicts.forEach(c => {
        let isRelevant = false;
        // 1. Direct conflict (hosted directly on the selected node)
        if (n.data.id === selectedId) isRelevant = true;
        // 2. Indirect Merge Source (selected node is being merged)
        else if (c.type === 'merge-proposal' && c.sourceId === selectedId) isRelevant = true;
        // 3. Indirect Split Target (selected node is a new split category)
        else if (c.type === 'split-proposal' && c.ghostIds?.includes(selectedId)) isRelevant = true;
        // 4. Indirect Move Target (selected node is a proposed move destination)
        else if (c.type === 'move-proposal' && c.ghostId === selectedId) isRelevant = true;

        if (isRelevant) {
          conflicts.push({ conflict: c, hostNodeId: n.data.id });
        }
      });
    }
  });
  return conflicts;
});

const layoutMode = ref('horizontal');

// Modal States
const renameModal = ref({ show: false, node: null, newName: '' });
const splitModal = ref({ show: false, node: null });
const multiMergeModal = ref({ show: false, parentOptions: [] });
const addNodeModal = ref({ show: false });
const deleteModal = ref({ show: false, nodes: [], name: '' });

// Keyboard Shortcuts
function handleGlobalKeydown(e) {
  // 1. Escape: Must run even if an input is focused to allow canceling out of text fields
  if (e.key === 'Escape') {
    if (renameModal.value.show) renameModal.value.show = false;
    else if (addNodeModal.value.show) addNodeModal.value.show = false;
    else if (splitModal.value.show) splitModal.value.show = false;
    else if (multiMergeModal.value.show) multiMergeModal.value.show = false;
    else clearSelection();
    
    if (document.activeElement) document.activeElement.blur();
    return;
  }

  // 2. Prevent triggering shortcuts when typing inside form inputs
  const activeTag = document.activeElement?.tagName?.toLowerCase();
  if (activeTag === 'input' || activeTag === 'textarea') return;

  // 3. Delete/Backspace: Trigger node deletion
  if (e.key === 'Delete' || e.key === 'Backspace') {
    if (selectedNodes.value.length > 0) {
      deleteNode();
    }
    return;
  }

  // 4. Ctrl+S / Cmd+S: Split exactly one node
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
    e.preventDefault(); 
    if (selectedNodes.value.length === 1) {
      openSplitModal();
    }
    return;
  }

  // 5. Ctrl+M / Cmd+M: Merge multiple nodes
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'm') {
    e.preventDefault();
    if (selectedNodes.value.length > 1) {
      openMultiMergeModal();
    }
    return;
  }

  // 6. Ctrl+Left / Ctrl+Right (Cmd+Left / Cmd+Right): Sibling Navigation
  if ((e.ctrlKey || e.metaKey) && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
    e.preventDefault(); 
    
    // We navigate based on the most recently selected node (the last one in the array)
    if (selectedNodes.value.length >= 1) {
      const currentNode = selectedNodes.value[selectedNodes.value.length - 1];
      const parent = currentNode.parent;
      
      if (!parent || !parent.children) return;

      const siblings = parent.children;
      const currentIndex = siblings.findIndex(s => s.data.id === currentNode.data.id);
      const targetIndex = e.key === 'ArrowLeft' ? currentIndex - 1 : currentIndex + 1;
      
      if (targetIndex >= 0 && targetIndex < siblings.length) {
        const targetNode = siblings[targetIndex];
        
        // If Shift is held, we perform a multi-selection
        // If not, we perform a singular selection (standard move)
        const isMultiSelect = e.shiftKey;
        toggleSelection(targetNode, isMultiSelect);
      }
    }
    return;
  }
}

// 2. Lifecycle
onMounted(() => { 
  if (!sharedTree.get('root')) {
    const baseData = JSON.parse(JSON.stringify(mechanicsData));
    addUUIDs(baseData);
    // Pass the raw object through our deep-sync function instead of stringifying
    updateSharedTreeRoot(baseData);
  }
  syncFromNetwork(); 
  window.addEventListener('keydown', handleGlobalKeydown);
});

onUnmounted(() => {
  window.removeEventListener('keydown', handleGlobalKeydown);
});

// 3. Node Operations
function handleNodeMoved({ draggedNode, targetNode }) {
  if (draggedNode.parent && draggedNode.parent.data.id === targetNode.data.id) return;

  const sourceData = draggedNode.data;
  const targetData = targetNode.data;

  // Ensure neither the source nor the target is locked by someone else
  if (!canEditNode(sourceData, netState.peerId) || !canEditNode(targetData, netState.peerId)) {
    return alert("Move rejected: Node is locked by another user.");
  }

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

  if (!sourceData.conflicts) sourceData.conflicts = [];
  
  sourceData.conflicts.push({
    id: generateId(),
    type: 'move-proposal',
    ghostId: ghostId,
    targetId: targetData.id,
    targetName: targetData.name, // Capture the visual name of the destination
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
    if (n.isDocked) {
      n.name = newName;
      n.action = 'renamed';
    } else {
      if (!n.conflicts) n.conflicts = [];
      n.conflicts.push({ id: generateId(), type: 'rename', value: newName, by: netState.username });
    }
    
    if (isDraftMode.value) n._isDraft = true; 
    applyChange(); 
  }
  renameModal.value.show = false;
}

function deleteNode() {
  const validNodes = selectedNodes.value.filter(n => canEditNode(n.data, netState.peerId));
  if (validNodes.length === 0) return;
  
  const hasChildren = validNodes.some(n => n.data.children && n.data.children.length > 0);
  
  deleteModal.value.nodes = validNodes;
  
  if (hasChildren) {
    deleteModal.value.name = validNodes.length === 1 ? validNodes[0].data.name : `${validNodes.length} nodes`;
    deleteModal.value.show = true;
  } else {
    confirmDelete({ cascade: false });
  }
}

function confirmDelete(payload) {
  const { cascade } = payload;
  deleteModal.value.nodes.forEach(n => {
    if (!n.data.conflicts) n.data.conflicts = [];
    n.data.conflicts.push({ id: generateId(), type: 'delete', by: netState.username, cascade });
    if (isDraftMode.value) n.data._isDraft = true;
  });
  selectedNodes.value = [];
  applyChange();
  deleteModal.value.show = false;
}

function restoreNode() {
  selectedNodes.value.forEach(n => {
    // 1. Clear the legacy base action if it was marked as deleted
    if (n.data.action === 'deleted') {
      delete n.data.action;
    }
    
    // 2. Target and remove ONLY the atomic delete proposals
    if (n.data.conflicts) {
      n.data.conflicts = n.data.conflicts.filter(c => c.type !== 'delete');
    }
    
    // 3. Clean up UI state flags
    delete n.data.lastEditedBy;
    if (isDraftMode.value) n.data._isDraft = true;
  });
  
  applyChange();
}

function openAddNodeModal() {
  addNodeModal.value.show = true;
}

function submitAddNode(newName) {
  const nodeName = newName && newName.trim() ? newName.trim() : "New Concept";
  const newNode = {
    id: generateId(),
    name: nodeName,
    action: 'added',
    isDocked: true, // Structural flag for unplaced nodes
    lastEditedBy: netState.username,
    _isDraft: isDraftMode.value ? true : undefined,
  };

  // 1. If the canvas is still a strict top-down tree, automatically transition it into a Forest
  if (!activeData.value.isSystemRoot) {
    const legacyRoot = JSON.parse(JSON.stringify(activeData.value));
    
    // Wipe the reactive object without destroying the memory reference Vue relies on
    for (let key in activeData.value) delete activeData.value[key];
    
    activeData.value.id = generateId();
    activeData.value.name = "Canvas Root";
    activeData.value.isSystemRoot = true;
    activeData.value.children = [legacyRoot, newNode];
  } else {
    // 2. We already have an invisible canvas floor, just append the new node
    if (!activeData.value.children) activeData.value.children = [];
    activeData.value.children.push(newNode);
  }
  
  applyChange();
  addNodeModal.value.show = false;
}

function handleDockedNodePlaced({ draggedNode, targetNode }) {
  const sourceId = draggedNode.id;
  let extractedNode = null;

  const extractAndRemove = (node) => {
    if (!node.children) return false;
    for (let i = 0; i < node.children.length; i++) {
      if (node.children[i].id === sourceId) {
        extractedNode = node.children[i];
        node.children.splice(i, 1);
        return true;
      }
      if (extractAndRemove(node.children[i])) return true;
    }
    return false;
  };

  extractAndRemove(activeData.value);
  if (!extractedNode) return;

  delete extractedNode.isDocked;
  extractedNode.action = 'moved';
  extractedNode.lastEditedBy = netState.username;

  if (targetNode) {
    if (!canEditNode(targetNode.data, netState.peerId)) {
      extractedNode.isDocked = true;
      activeData.value.children.push(extractedNode);
      applyChange();
      throw new Error('Target node is locked by another peer.');
    }
    if (!targetNode.data.children) targetNode.data.children = [];
    targetNode.data.children.push(extractedNode);
  } else {
    if (!activeData.value.children) activeData.value.children = [];
    activeData.value.children.push(extractedNode);
  }

  applyChange();
}

// 4. Split & Merge Engine
function openSplitModal() {
  const n = selectedNodes.value[0];

  // Prevent splitting a locked node
  if (!canEditNode(n.data, netState.peerId)) return alert("Node is locked!");

  splitModal.value = { show: true, node: n };
}

function confirmSplit(payload) {
  const { names: newNamesString, keepOriginal } = payload;
  const d3Node = splitModal.value.node;
  const nodeData = d3Node.data;
  const parentData = d3Node.parent?.data; // Safe access for root
  const names = newNamesString.split(',').map(n => n.trim()).filter(n => n);
  
  // If keeping original, 1 new name is a valid split. Otherwise, need at least 2.
  if (names.length < (keepOriginal ? 1 : 2)) {
    return alert(`Provide at least ${keepOriginal ? 'one' : 'two'} new names.`);
  }

  const ghostIds = [];

  names.forEach(name => {
    const ghost = { id: generateId(), name: name, isGhost: true, action: 'added', lastEditedBy: netState.username };
    ghostIds.push(ghost.id);
    
    // Only inject ghosts visually if a parent exists. 
    // Root splits defer structural shifts entirely to the execution matrix.
    if (parentData) {
      if (!parentData.children) parentData.children = [];
      parentData.children.push(ghost);
    }
  });

  if (!nodeData.conflicts) nodeData.conflicts = [];
  
  nodeData.conflicts.push({ 
    id: generateId(), 
    type: 'split-proposal', 
    ghostIds: ghostIds, 
    newNames: names, 
    keepOriginal: keepOriginal,
    by: netState.username 
  });

  applyChange();
  splitModal.value.show = false;
}

function openMultiMergeModal() {
  if (selectedNodes.value.length < 2) return;

  // Ensure no locked nodes are included in a merge
  if (selectedNodes.value.some(n => !canEditNode(n.data, netState.peerId))) {
    return alert("Merge rejected: One or more selected nodes are locked.");
  }

  // 1. Guard against Ancestor/Descendant collisions
  const selectedIds = new Set(selectedNodes.value.map(n => n.data.id));
  for (const n of selectedNodes.value) {
    let current = n.parent;
    while (current) {
      if (selectedIds.has(current.data.id)) {
        return alert("Merge rejected: Cannot merge a category with its own parent or descendant.");
      }
      current = current.parent;
    }
  }

  // 2. Build valid parent targets
  const parentMap = new Map();
  selectedNodes.value.forEach(n => {
    const parent = n.parent;
    const parentId = parent ? parent.data.id : 'root';
    const parentName = parent ? parent.data.name : 'Root';
    
    if (!parentMap.has(parentId)) {
      parentMap.set(parentId, { id: parentId, name: parentName, node: parent });
    }
  });

  multiMergeModal.value = { 
    show: true, 
    parentOptions: Array.from(parentMap.values()) 
  };
}

function confirmMultiMerge(payload) {
  const { newName: newNameStr, targetParentId } = payload;
  const newName = newNameStr || "Consolidated Category";

  // 1. Resolve the specific target parent in the raw JSON tree
  let targetParentData = null;
  if (targetParentId === 'root' || targetParentId === activeData.value.id) {
    targetParentData = activeData.value;
  } else {
    const findParent = (node) => {
      if (node.id === targetParentId) return node;
      if (node.children) {
        for (let child of node.children) {
          const found = findParent(child);
          if (found) return found;
        }
      }
      return null;
    };
    targetParentData = findParent(activeData.value);
  }

  if (!targetParentData) return alert("Merge rejected: Target parent could not be resolved.");

  // 2. Scaffold the new consolidated node
  const newNode = { 
    id: generateId(), 
    name: newName, 
    action: 'added', 
    lastEditedBy: netState.username, 
    children: [], 
    conflicts: [] 
  };

  // 3. Map sources and build ghost structures
  selectedNodes.value.forEach(d => {
    const sourceData = d.data;
    
    // The conflict lives on the new proposed node, linking back to the disparate sources
    newNode.conflicts.push({
      id: generateId(), 
      type: 'merge-proposal', 
      sourceId: sourceData.id, 
      sourceName: sourceData.name,
      originalTargetName: newName, 
      proposedName: newName, 
      by: netState.username
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

  // 4. Attach to the specifically selected parent
  if (!targetParentData.children) targetParentData.children = [];
  targetParentData.children.push(newNode);
  
  selectedNodes.value = [];
  applyChange();
  multiMergeModal.value.show = false;
}

// 5. Conflict Resolution Matrix
function acceptConflict(payload) {
  const { conflict, hostNodeId } = payload;
  
  // Find the exact node that physically holds the conflict array
  let hostNode = null;
  d3.hierarchy(liveTreeData.value).each(n => {
    if (n.data.id === hostNodeId) hostNode = n.data;
  });
  
  if (!hostNode) return;
  if (!canEditNode(hostNode, netState.peerId)) return alert("Action rejected: The target node is locked by another user.");

  const actionMap = {
    'delete': 'delete-node', 'rename': 'rename-node', 'move-proposal': 'move-node',
    'split-proposal': 'split-replace', 'merge-proposal': 'merge-node'
  };
  const action = actionMap[conflict.type];
  if (!action) return;

  executeResolution({ action }, conflict, hostNode);
}

function acceptAllMerges(hostNodeId) {
  let hostNode = null;
  d3.hierarchy(liveTreeData.value).each(n => {
    if (n.data.id === hostNodeId) hostNode = n.data;
  });
  
  if (!hostNode) return;
  if (!canEditNode(hostNode, netState.peerId)) return alert("Action rejected: The target node is locked by another user.");

  const referenceConflict = hostNode.conflicts?.find(c => c.type === 'merge-proposal');
  if (!referenceConflict) return;
  
  executeResolution({ action: 'n-merges' }, referenceConflict, hostNode); 
}

function discardConflict(payload) {
  const { conflict, hostNodeId } = payload;
  
  let hostNode = null;
  d3.hierarchy(liveTreeData.value).each(n => {
    if (n.data.id === hostNodeId) hostNode = n.data;
  });
  
  if (!hostNode) return;
  if (!canEditNode(hostNode, netState.peerId)) return alert("Action rejected: The target node is locked.");

  // Remove the specific atomic proposal
  if (hostNode.conflicts) {
    hostNode.conflicts = hostNode.conflicts.filter(c => c.id !== conflict.id);
  }

  // Trigger GC to automatically destroy any ghost UI nodes that belonged to this proposal
  cleanupOrphanedArtifacts(); 
  forceGlobalSync();
}

function discardAllMerges(hostNodeId) {
  let hostNode = null;
  d3.hierarchy(liveTreeData.value).each(n => {
    if (n.data.id === hostNodeId) hostNode = n.data;
  });
  
  if (!hostNode) return;
  if (!canEditNode(hostNode, netState.peerId)) return alert("Action rejected: The target node is locked.");

  // Wipe all merge proposals hosted here
  if (hostNode.conflicts) {
    hostNode.conflicts = hostNode.conflicts.filter(c => c.type !== 'merge-proposal');
  }

  cleanupOrphanedArtifacts(); 
  forceGlobalSync();
}

function executeResolution(option, conflict, node) {
  // 1. FORCE LIVE CONTEXT: Resolutions must update the shared state immediately
  const root = d3.hierarchy(liveTreeData.value);
  
  let liveNode = null;
  let liveParent = null;
  root.each(n => {
    if (n.data.id === node.id) liveNode = n.data;
    if (n.children && n.children.some(c => c.data.id === node.id)) liveParent = n.data;
  });

  if (!liveNode) return;

  const cachedConflicts = liveNode.conflicts ? [...liveNode.conflicts] : [];

  // Only wipe the specific conflict being resolved (or all merges if n-merges is clicked)
  if (option.action === 'n-merges') {
    liveNode.conflicts = cachedConflicts.filter(c => c.type !== 'merge-proposal');
  } else {
    liveNode.conflicts = cachedConflicts.filter(c => c.id !== conflict.id);
  }
  
  delete liveNode.action;

  const act = option.action;

  // --- DELETE RESOLUTION ---
  if (act === 'delete-node') {
    const historicalRecord = {
      id: generateId(), 
      name: liveNode.name,
      action: 'deleted',
      deletedBy: conflict.by || netState.username,
      timestamp: Date.now(),
      children: liveNode.children ? JSON.parse(JSON.stringify(liveNode.children)) : []
    };
    
    if (historicalRecord.children.length > 0) {
      historicalRecord.children.forEach(addUUIDs);
    }

    if (!liveParent) {
      liveTreeData.value = {
        id: generateId(),
        name: "Canvas Root",
        isSystemRoot: true,
        children: (!conflict.cascade && liveNode.children) ? JSON.parse(JSON.stringify(liveNode.children)) : [],
        deletedChildren: [historicalRecord]
      };
    } else {
      if (!liveParent.deletedChildren) liveParent.deletedChildren = [];
      liveParent.deletedChildren.push(historicalRecord);

      const idx = liveParent.children.findIndex(c => c.id === liveNode.id);
      if (idx > -1) liveParent.children.splice(idx, 1);
      
      if (!conflict.cascade && liveNode.children) {
        liveNode.children.forEach(child => liveParent.children.push(child));
      }
    }
  }

  // --- RENAME RESOLUTION ---
  else if (act === 'rename-node') {
    liveNode.name = conflict.value || conflict.proposedName || liveNode.name;
    liveNode.action = 'renamed';
  }

  // --- MOVE RESOLUTION ---
  else if (act === 'move-node') {
    const targetParent = root.descendants().find(n => n.data.id === conflict.targetId);
    
    if (targetParent && targetParent.ancestors().some(a => a.data.id === liveNode.id)) {
      liveNode.conflicts.push(conflict);
      return alert("Resolution rejected: Executing this move creates a structural cycle. Discard the proposal.");
    }

    if (targetParent && liveParent) {
      const idx = liveParent.children.findIndex(c => c.id === liveNode.id);
      liveParent.children.splice(idx, 1);
      
      const gIdx = targetParent.data.children.findIndex(c => c.id === conflict.ghostId);
      if (gIdx > -1) targetParent.data.children.splice(gIdx, 1);
      
      if (!targetParent.data.children) targetParent.data.children = [];
      targetParent.data.children.push(liveNode);
      liveNode.action = 'moved';
    }
  }

  // --- SPLIT RESOLUTION ---
  else if (act.startsWith('split')) {
    let targetParent = liveParent;

    // Root Split Interception
    if (!targetParent) {
      targetParent = {
        id: generateId(),
        name: "Canvas Root",
        isSystemRoot: true,
        children: []
      };
      liveTreeData.value = targetParent;
    }

    // Check if the user is accepting via a specific ghost node vs the original source node
    const selectedId = Array.from(selectedIds.value)[0];
    const targetGhostIndex = conflict.ghostIds ? conflict.ghostIds.indexOf(selectedId) : -1;
    
    // Cache the immutable array to prevent history destruction during sequential array splicing
    if (!conflict.originalNames) conflict.originalNames = [...conflict.newNames];
    const historicalSplitTree = { 
      id: generateId(),
      name: liveNode.name, 
      children: conflict.originalNames.map(n => ({ id: generateId(), name: n })) 
    };

    if (targetGhostIndex !== -1) {
      // User selected a specific ghost node (one of the proposed split ones)
      const gId = conflict.ghostIds[targetGhostIndex];
      const gName = conflict.newNames[targetGhostIndex];

      // 1. Remove the specific ghost from the UI
      if (targetParent.children) {
        const gIdx = targetParent.children.findIndex(c => c.id === gId);
        if (gIdx > -1) targetParent.children.splice(gIdx, 1);
      }

      // 2. Add the permanent resolved node
      targetParent.children.push({
        id: generateId(), name: gName, action: 'added', lastEditedBy: netState.username,
        splitFrom: liveNode.name, splitStructure: historicalSplitTree
      });

      // 3. Mutate the conflict array to remove this fragment
      conflict.ghostIds.splice(targetGhostIndex, 1);
      conflict.newNames.splice(targetGhostIndex, 1);

      // 4. If fragments remain, restore the conflict to the host. Otherwise, delete the host.
      if (conflict.ghostIds.length > 0) {
        liveNode.conflicts.push(conflict); // Re-attach conflict since it was stripped at the top of executeResolution
      } else {
        if (!conflict.keepOriginal) {
          const idx = targetParent.children.findIndex(c => c.id === liveNode.id);
          if (idx > -1) targetParent.children.splice(idx, 1);
        } else {
          liveNode.splitStructure = historicalSplitTree;
          liveNode.splitFrom = liveNode.name; 
        }
      }
    } else {
      // User selected the node being split
      if (conflict.ghostIds && targetParent.children) {
        conflict.ghostIds.forEach(gId => {
          const gIdx = targetParent.children.findIndex(c => c.id === gId);
          if (gIdx > -1) targetParent.children.splice(gIdx, 1);
        });
      }
      
      if (!conflict.keepOriginal) {
        const idx = targetParent.children.findIndex(c => c.id === liveNode.id);
        if (idx > -1) targetParent.children.splice(idx, 1);
      } else {
        liveNode.splitStructure = historicalSplitTree;
        liveNode.splitFrom = liveNode.name; 
        if (!liveParent) targetParent.children.push(liveNode); // Explicitly attach if we made a new root
      }

      conflict.newNames.forEach(name => {
        targetParent.children.push({
          id: generateId(), name: name, action: 'added', lastEditedBy: netState.username,
          splitFrom: liveNode.name, splitStructure: historicalSplitTree
        });
      });
    }
  }

  // --- MERGE RESOLUTION ---
  else if (act.includes('merge')) {
    const mergesToProcess = act === 'n-merges' 
      ? cachedConflicts.filter(c => c.type === 'merge-proposal')
      : [conflict]; 
    
    if (!liveNode.mergedStructure) liveNode.mergedStructure = { source: { children: [] } };
    
    const liveNodeD3 = root.descendants().find(n => n.data.id === liveNode.id);

    mergesToProcess.forEach(mConf => {
      let sourceParent = null, sourceData = null;
      root.each(n => {
        if (n.children && n.children.some(c => c.data.id === mConf.sourceId)) {
          sourceParent = n.data;
          sourceData = n.children.find(c => c.data.id === mConf.sourceId).data;
        }
      });

      if (sourceParent && sourceData) {
        if (liveNodeD3 && liveNodeD3.ancestors().some(a => a.data.id === sourceData.id)) {
          liveNode.conflicts.push(mConf);
          alert(`Merge rejected: Consolidating '${sourceData.name}' into '${liveNode.name}' creates a structural cycle. Discard the proposal.`);
          return;
        }

        liveNode.mergedStructure.source.children.push({
          id: generateId(),
          name: sourceData.name,
          children: sourceData.children ? cloneNode(sourceData, netState.username).children : []
        });

        liveNode.mergedFrom = liveNode.mergedFrom 
          ? `${liveNode.mergedFrom}, ${sourceData.name}` 
          : sourceData.name;

        const srcIdx = sourceParent.children.findIndex(c => c.id === mConf.sourceId);
        if (srcIdx > -1) sourceParent.children.splice(srcIdx, 1);
        
        if (sourceData.children) {
          if (!liveNode.children) liveNode.children = [];
          sourceData.children.forEach(child => liveNode.children.push(cloneNode(child, netState.username)));
        }
      }
    });
    
    liveNode.name = conflict.proposedName || liveNode.name;
    liveNode.action = 'added'; 
    if (liveNode.children) liveNode.children = liveNode.children.filter(c => !c.isGhost);
  }

  liveNode.lastEditedBy = netState.username;
  
  // 3. GLOBAL CLEANUP
  cleanupOrphanedArtifacts(); 
  
  // 4. FORCE SYNC AND REACTIVITY
  forceGlobalSync();
}

// Helper to force a network broadcast regardless of current UI mode
function forceGlobalSync() {
  const cleanLive = JSON.parse(JSON.stringify(liveTreeData.value));
  
  removeDraftFlag(cleanLive);
  
  updateSharedTreeRoot(cleanLive); 
  
  webrtcService.sendUpdate(encodeCurrentState(), netState.isHost);
  
  if (isDraftMode.value) {
    draftTreeData.value = JSON.parse(JSON.stringify(liveTreeData.value));
  }
}

function cleanupOrphanedArtifacts() {
  const root = d3.hierarchy(liveTreeData.value);
  const validGhostIds = new Set();
  const allCurrentIds = new Set();
  const activeMergeSourceIds = new Set(); 

  // 1. Build an index of all current nodes and collect active ghosts
  root.each(n => {
    allCurrentIds.add(n.data.id);
    if (n.data.conflicts) {
      n.data.conflicts.forEach(c => {
        if (c.type === 'split-proposal' && c.ghostIds) c.ghostIds.forEach(id => validGhostIds.add(id));
        if (c.type === 'move-proposal' && c.ghostId) validGhostIds.add(c.ghostId);
      });
    }
  });

  // 2. Prune invalid branches
  function traverseAndClean(parentData) {
    if (!parentData.children) return;
    parentData.children = parentData.children.filter(child => {
      // Delete ghosts belonging to rejected/completed split or move proposals
      if (child.isGhost && !validGhostIds.has(child.id)) return false;

      // COMPETITIVE MERGE INVALIDATION
      if (child.conflicts && child.conflicts.some(c => c.type === 'merge-proposal')) {
        // Evaluate merge sources individually rather than failing the whole node
        const validConflicts = [];
        
        child.conflicts.forEach(c => {
          if (c.type === 'merge-proposal') {
            if (allCurrentIds.has(c.sourceId)) {
              validConflicts.push(c);
              activeMergeSourceIds.add(c.sourceId);
            }
          } else {
            validConflicts.push(c);
          }
        });
        
        child.conflicts = validConflicts;
        const remainingMerges = child.conflicts.filter(c => c.type === 'merge-proposal');
        
        // If the node hasn't been structurally merged yet and loses all valid sources, prune it safely
        if (remainingMerges.length === 0 && !child.mergedStructure) {
          return false; 
        }
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
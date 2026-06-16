// Manages the Yjs document, the shared tree structure, and network syncing

import * as Y from 'yjs';
import { DEBUG_NETWORK } from './webrtc.service.js';

export let ydoc = new Y.Doc();
export let sharedTree = ydoc.getMap('treeData');

export function applyHostState(updatePayload) {
  try {
    // Annihilate local vector clocks to prevent parallel initialization collisions
    ydoc = new Y.Doc();
    sharedTree = ydoc.getMap('treeData');
    
    const update = new Uint8Array(updatePayload);
    Y.applyUpdate(ydoc, update, 'network');
    
    if (DEBUG_NETWORK) console.log(`[CRDT: Host Override Success] Replaced local CRDT document. Size: ${update.byteLength}b`);
    window.dispatchEvent(new Event('tree-updated'));
  } catch (error) {
    console.error("[CRDT: Host Override Failure] Failed to reconstruct document:", error);
  }
}

export function applyNetworkUpdate(updatePayload) {
  try {
    const update = new Uint8Array(updatePayload);
    Y.applyUpdate(ydoc, update, 'network');
    if (DEBUG_NETWORK) console.log(`[CRDT: Decode Success] Applied binary update. Size: ${update.byteLength}b`);
    window.dispatchEvent(new Event('tree-updated'));
  } catch (error) {
    if (DEBUG_NETWORK) console.error("[CRDT: Decode Failure] Failed to process binary data:", error);
    else console.error("CRDT Service failed to process binary data:", error);
  }
}

export function encodeCurrentState() {
  const state = Y.encodeStateAsUpdate(ydoc);
  if (DEBUG_NETWORK) console.log(`[CRDT: Encode Success] Generated binary state. Size: ${state.byteLength}b`);
  return state;
}

// Deep syncs a JSON object into a Y.Map without overwriting the map's identity
function syncObjectToYMap(yMap, jsonObj) {
  const currentKeys = Array.from(yMap.keys());
  
  for (const [key, value] of Object.entries(jsonObj)) {
    if (Array.isArray(value)) {
      let yArray = yMap.get(key);
      if (!(yArray instanceof Y.Array)) {
        yArray = new Y.Array();
        yMap.set(key, yArray);
      }
      syncArrayToYArray(yArray, value);
    } else if (value !== null && typeof value === 'object') {
      let childYMap = yMap.get(key);
      if (!(childYMap instanceof Y.Map)) {
        childYMap = new Y.Map();
        yMap.set(key, childYMap);
      }
      syncObjectToYMap(childYMap, value);
    } else {
      if (yMap.get(key) !== value) {
        yMap.set(key, value);
      }
    }
  }

  // Remove keys that no longer exist
  currentKeys.forEach(key => {
    if (!(key in jsonObj)) yMap.delete(key);
  });
}

// Deep syncs a JSON Array into a Y.Array without destroying CRDT references
function syncArrayToYArray(yArray, jsonArr) {
  const isObjectArray = jsonArr.length > 0 && typeof jsonArr[0] === 'object' && jsonArr[0] !== null;
  
  if (!isObjectArray) {
    yArray.delete(0, yArray.length);
    if (jsonArr.length > 0) yArray.insert(0, jsonArr);
    return;
  }

  const newIds = new Set(jsonArr.map(item => item.id));
  
  // 1. Delete items that no longer exist (iterate backwards to avoid index shifting)
  for (let i = yArray.length - 1; i >= 0; i--) {
    const yItem = yArray.get(i);
    if (yItem instanceof Y.Map && yItem.has('id') && !newIds.has(yItem.get('id'))) {
      yArray.delete(i, 1);
    } else if (!(yItem instanceof Y.Map)) {
      yArray.delete(i, 1);
    }
  }

  // 2. Map the surviving CRDT items
  const existingIds = new Set();
  for (let i = 0; i < yArray.length; i++) {
    const yItem = yArray.get(i);
    if (yItem instanceof Y.Map) existingIds.add(yItem.get('id'));
  }

  // 3. Safely insert only brand new items at the end
  const itemsToInsert = [];
  jsonArr.forEach(item => {
    if (!existingIds.has(item.id)) {
      const newYMap = new Y.Map();
      newYMap.set('id', item.id);
      itemsToInsert.push(newYMap);
    }
  });

  if (itemsToInsert.length > 0) {
    yArray.insert(yArray.length, itemsToInsert);
  }

  // 4. Deep sync all properties in place
  for (let i = 0; i < yArray.length; i++) {
    const yItem = yArray.get(i);
    const jsonItem = jsonArr.find(j => j.id === yItem.get('id'));
    if (jsonItem) syncObjectToYMap(yItem, jsonItem);
  }
}

// accepting a JSON object, NOT a JSON string
export function updateSharedTreeRoot(jsonTree) {
  ydoc.transact(() => {
    let rootMap = sharedTree.get('root');
    if (!(rootMap instanceof Y.Map)) {
      rootMap = new Y.Map();
      sharedTree.set('root', rootMap);
    }
    syncObjectToYMap(rootMap, jsonTree);
  });
}

// Extracts the deeply nested Yjs data back to standard JSON
export function getSharedTreeJSON() {
  const rootMap = sharedTree.get('root');
  return rootMap instanceof Y.Map ? rootMap.toJSON() : null;
}
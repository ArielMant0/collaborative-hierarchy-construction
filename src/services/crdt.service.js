// Manages the Yjs document, the shared tree structure, and network syncing

import * as Y from 'yjs';

export const ydoc = new Y.Doc();
export const sharedTree = ydoc.getMap('treeData');

export function applyNetworkUpdate(updatePayload) {
  try {
    const update = new Uint8Array(updatePayload);
    Y.applyUpdate(ydoc, update, 'network');
    window.dispatchEvent(new Event('tree-updated'));
  } catch (error) {
    console.error("CRDT Service failed to process binary data:", error);
  }
}

export function encodeCurrentState() {
  return Y.encodeStateAsUpdate(ydoc);
}

export function updateSharedTreeRoot(jsonString) {
  ydoc.transact(() => {
    sharedTree.set('root', jsonString);
  });
}
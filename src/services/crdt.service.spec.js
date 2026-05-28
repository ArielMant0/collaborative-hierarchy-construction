import { describe, it, expect, beforeEach, vi } from 'vitest';
import { 
  ydoc, 
  sharedTree, 
  updateSharedTreeRoot, 
  getSharedTreeJSON,
  encodeCurrentState,
  applyNetworkUpdate
} from './crdt.service.js';
import * as Y from 'yjs';

describe('CRDT Service (Layer 3 Pure Logic)', () => {
  beforeEach(() => {
    // Isolate tests by wiping the shared tree root before each execution
    if (sharedTree.has('root')) {
      sharedTree.delete('root');
    }
  });

  it('should initialize with an empty JSON state', () => {
    expect(getSharedTreeJSON()).toBeNull();
  });

  it('should deeply sync standard JSON into the Yjs Map without data loss', () => {
    const mockTree = {
      id: 'root-1',
      isSystemRoot: true,
      name: 'Forest Canvas',
      children: [
        { id: 'node-1', name: 'Floating Parent', conflicts: [] }
      ]
    };

    updateSharedTreeRoot(mockTree);
    const extractedData = getSharedTreeJSON();
    
    expect(extractedData).toEqual(mockTree);
  });

  it('should preserve unmodified CRDT node identities across sync loops', () => {
    const initialTree = {
      id: 'root-1',
      children: [{ id: 'child-1', name: 'Version A' }]
    };
    updateSharedTreeRoot(initialTree);
    
    // Capture the exact memory reference of the child node's Y.Map
    const firstSyncMap = sharedTree.get('root').get('children').get(0);

    const updatedTree = {
      id: 'root-1',
      children: [{ id: 'child-1', name: 'Version B' }] // Mutating only the name
    };
    updateSharedTreeRoot(updatedTree);
    
    const secondSyncMap = sharedTree.get('root').get('children').get(0);
    
    // The underlying CRDT map reference MUST remain identical. 
    // If it was destroyed and recreated, it would trigger a massive network diff.
    expect(firstSyncMap === secondSyncMap).toBe(true);
    expect(getSharedTreeJSON().children[0].name).toBe('Version B');
  });

  it('should encode the document state to a Uint8Array binary format', () => {
    updateSharedTreeRoot({ id: 'test-node' });
    const binaryState = encodeCurrentState();
    
    expect(binaryState).toBeInstanceOf(Uint8Array);
    expect(binaryState.length).toBeGreaterThan(0);
  });

  it('should decode network payloads and trigger the Vue reactivity bridge', () => {
    const eventSpy = vi.fn();
    window.addEventListener('tree-updated', eventSpy);

    // Generate a valid binary payload from a temporary Yjs document
    const tempDoc = new Y.Doc();
    tempDoc.getMap('treeData').set('root', new Y.Map());
    const payload = Y.encodeStateAsUpdate(tempDoc);

    applyNetworkUpdate(payload);
    
    expect(eventSpy).toHaveBeenCalledTimes(1);
    
    window.removeEventListener('tree-updated', eventSpy);
  });
});
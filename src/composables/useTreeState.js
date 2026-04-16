// Wraps crdt.service.js and manages the division between the draft mode and the shared staging environment. 
// It handles the conflict resolution execution matrix.

import { ref, computed, onMounted, onUnmounted } from 'vue';
import { sharedTree, applyNetworkUpdate, encodeCurrentState, updateSharedTreeRoot } from '../services/crdt.service.js';
import { webrtcService } from '../services/webrtc.service.js';
import { removeDraftFlag, tagGlobalDuplicates} from '../utils/helpers.js';

export function useTreeState(netState) {
  const isDraftMode = ref(false);
  const liveTreeData = ref(null);
  const draftTreeData = ref(null);

  const activeData = computed(() => isDraftMode.value ? draftTreeData.value : liveTreeData.value);

  function syncFromNetwork() {
    const treeString = sharedTree.get('root');
    if (treeString) {
      try {
        const parsedData = JSON.parse(treeString);
        tagGlobalDuplicates(parsedData); 
        liveTreeData.value = parsedData;
      } catch (e) {
        console.error("Failed to parse tree data:", e);
      }
    }
  }

  function setupCRDTListeners() {
    window.addEventListener('tree-updated', syncFromNetwork);
    
    webrtcService.addEventListener('crdt-update-received', (e) => {
      applyNetworkUpdate(e.detail.data);
      
      // RELAY ROUTER: If we are the Host, forward Client A's update to Client B, C, etc.
      if (netState.isHost) {
        webrtcService.broadcast(e.detail.data, e.detail.peer);
      }
    });

    webrtcService.addEventListener('client-joined', (e) => {
      if (netState.isHost) {
        // Force the client to overwrite their local tree to bypass CRDT tie-breakers
        webrtcService.sendToPeer(e.detail, { type: 'WELCOME_SYNC', payload: sharedTree.get('root') });
        // Send the underlying Yjs binary to align vector clocks
        webrtcService.sendToPeer(e.detail, encodeCurrentState());
      }
    });

    webrtcService.addEventListener('welcome-sync', (e) => {
      if (!netState.isHost) {
        // Manually trigger a local transaction with the Host's exact data to "win" the state
        updateSharedTreeRoot(e.detail);
        syncFromNetwork();
      }
    });
  }

  onMounted(() => setupCRDTListeners());
  
  onUnmounted(() => {
    window.removeEventListener('tree-updated', syncFromNetwork);
  });

  function switchMode(isDraft) {
    isDraftMode.value = isDraft;
    if (isDraft) {
      draftTreeData.value = JSON.parse(JSON.stringify(liveTreeData.value));
    }
  }

  function applyChange() {
    tagGlobalDuplicates(activeData.value);
    if (!isDraftMode.value) {
      const cleanLive = JSON.parse(JSON.stringify(liveTreeData.value));
      removeDraftFlag(cleanLive);
      updateSharedTreeRoot(JSON.stringify(cleanLive));
      webrtcService.sendUpdate(encodeCurrentState(), netState.isHost);
    }
  }

  function commitChanges() {
    const cleanDraft = JSON.parse(JSON.stringify(draftTreeData.value));
    removeDraftFlag(cleanDraft);
    
    updateSharedTreeRoot(JSON.stringify(cleanDraft));
    webrtcService.sendUpdate(encodeCurrentState(), netState.isHost);
    
    liveTreeData.value = cleanDraft;
    isDraftMode.value = false;
  }

  return {
    isDraftMode,
    liveTreeData,
    draftTreeData,
    activeData,
    switchMode,
    applyChange,
    commitChanges,
    syncFromNetwork
  };
}
// Wraps crdt.service.js and manages the division between the draft mode and the shared staging environment. 
// It handles the conflict resolution execution matrix.

import { ref, computed, onMounted, onUnmounted } from 'vue';
import { sharedTree, applyNetworkUpdate, applyHostState, encodeCurrentState, updateSharedTreeRoot, getSharedTreeJSON, appendLogEntry, getLogsJSON } from '../services/crdt.service.js';
import { webrtcService, DEBUG_NETWORK } from '../services/webrtc.service.js';
import { removeDraftFlag, tagGlobalDuplicates} from '../utils/helpers.js';

export function useTreeState(netState) {
  const isDraftMode = ref(false);
  const liveTreeData = ref(null);
  const draftTreeData = ref(null);
  const actionLogs = ref([]); // Reactivity Bridge for Logs

  const activeData = computed(() => isDraftMode.value ? draftTreeData.value : liveTreeData.value);

  function syncFromNetwork() {
    if (DEBUG_NETWORK) console.log(`[TreeState: Local Sync] 'tree-updated' event caught. Rebuilding reactive state.`);
    const parsedData = getSharedTreeJSON();
    if (parsedData) {
      tagGlobalDuplicates(parsedData); 
      liveTreeData.value = parsedData;
    }
    // Sync the logs from CRDT to the reactive Vue ref
    actionLogs.value = getLogsJSON();
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
        webrtcService.sendToPeer(e.detail, { 
          type: 'WELCOME_SYNC', 
          payload: encodeCurrentState() 
        });
      }
    });

    webrtcService.addEventListener('welcome-sync', (e) => {
      if (!netState.isHost) {
        netState.isReady = true;
        applyHostState(e.detail);
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
      updateSharedTreeRoot(cleanLive); // Pass as object
      webrtcService.sendUpdate(encodeCurrentState(), netState.isHost);
    }
  }

  function commitChanges() {
    const cleanDraft = JSON.parse(JSON.stringify(draftTreeData.value));
    removeDraftFlag(cleanDraft);
    
    updateSharedTreeRoot(cleanDraft); // Pass as object
    webrtcService.sendUpdate(encodeCurrentState(), netState.isHost);
    
    liveTreeData.value = cleanDraft;
    isDraftMode.value = false;
  }

  // function to write a log, broadcast, and update the UI
  function logAction(actionType, details = '') {
    appendLogEntry({
      timestamp: Date.now(),
      by: netState.username || netState.peerId || 'Unknown',
      action: actionType,
      details: details
    });
    
    // Broadcast the updated CRDT log state to all peers
    webrtcService.sendUpdate(encodeCurrentState(), netState.isHost);
    
    // Immediately trigger local UI sync
    actionLogs.value = getLogsJSON();
  }

  return {
    isDraftMode,
    liveTreeData,
    draftTreeData,
    activeData,
    actionLogs,
    switchMode,
    applyChange,
    commitChanges,
    syncFromNetwork,
    logAction
  };
}
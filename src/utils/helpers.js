//functions for ID generation, tree flattening, and data cleanup

export function generateId() {
  return crypto.randomUUID ? crypto.randomUUID() : Date.now() + '-' + Math.random();
}

export function cloneNode(node, username) {
  const cloned = { 
    ...node, 
    id: generateId(), 
    action: 'moved', 
    lastEditedBy: username 
  };
  delete cloned.groupId; 
  if (node.children) {
    cloned.children = node.children.map(c => cloneNode(c, username));
  }
  return cloned;
}

export function flattenTree(node, acc = []) {
  if (node && node.action !== 'deleted' && !node.isGhost) acc.push(node);
  if (node && node.children) {
    node.children.forEach(child => flattenTree(child, acc));
  }
  return acc;
}

export function canEditNode(nodeData, localPeerId) {
  if (!nodeData) return true; 
  if (nodeData.action === 'deleted') return false; 
  if (!nodeData.locked) return true;
  return nodeData.lockedBy === localPeerId;
}

export function addUUIDs(node) {
  node.id = generateId();
  if (node.children) node.children.forEach(addUUIDs);
}

export function removeDraftFlag(node) {
  delete node._isDraft;
  if (node.children) node.children.forEach(removeDraftFlag);
}

export function tagGlobalDuplicates(rootNode) {
  if (!rootNode) return;
  const allNodes = flattenTree(rootNode);
  
  const nameMap = new Map();
  allNodes.forEach(node => {
    if (!node.name) return;
    const name = node.name.trim().toLowerCase();
    if (!nameMap.has(name)) nameMap.set(name, []);
    nameMap.get(name).push(node);
  });

  nameMap.forEach(duplicates => {
    if (duplicates.length > 1) {
      const masterGroupId = duplicates.find(d => d.groupId)?.groupId || generateId();
      duplicates.forEach(d => {
        d.groupId = masterGroupId;
      });
    } else if (duplicates.length === 1 && duplicates[0].groupId) {
      delete duplicates[0].groupId;
    }
  });
}
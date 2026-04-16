import * as d3 from 'd3';
import { canEditNode } from '../utils/helpers.js';

export const NODE_DIMENSIONS = { width: 110, height: 36 };
const COLORS = { 
  draft: '#ff9800', 
  live: '#4caf50',
  linkDefault: '#b0bec5',
  nodeDefault: '#e0e0e0',
  lockedOther: '#f44336',
  lockedMe: '#2196f3'
};
const ACTION_COLORS = {
  added: '#4caf50',     
  deleted: '#f44336',   
  renamed: '#9c27b0',   
  moved: '#009688'      
};

export class TreeRenderer {
  constructor(svgElement, callbacks) {
    this.svg = d3.select(svgElement);
    this.callbacks = callbacks; 
    this.nodeElements = new Map();
    this.linkElements = new Map();
    this.currentZoomBehavior = null;
    this.initialRenderDone = false;
    this.nameColorScale = d3.scaleOrdinal(d3.schemePastel1);
    
    this.ctx = { isDraftMode: false, localPeerId: null, selectedIds: new Set() };
    
    this.initCanvas();
    this.drag = this.createDragBehavior();
  }

  initCanvas() {
    if (this.svg.select("g.zoom-group").empty()) {
      const zoomG = this.svg.append("g").attr("class", "zoom-group");
      zoomG.append("g").attr("class", "links-layer");
      zoomG.append("g").attr("class", "nodes-layer");

      this.currentZoomBehavior = d3.zoom()
        .scaleExtent([0.1, 3])
        .on("zoom", (e) => zoomG.attr("transform", e.transform));
      this.svg.call(this.currentZoomBehavior);
    }
  }

  updateContext(newContext) {
    this.ctx = { ...this.ctx, ...newContext };
  }

  getStrokeColor(data) {
    if (data.isGhost) return "#9e9e9e";
    if (data.conflicts?.length) return "#ff9800"; 
    if (data.action) return ACTION_COLORS[data.action];
    if (data.locked) return data.lockedBy === this.ctx.localPeerId ? COLORS.lockedMe : COLORS.lockedOther;
    return (this.ctx.isDraftMode && data._isDraft) ? COLORS.draft : COLORS.nodeDefault;
  }

  recenter(treeData, animate = false) {
    if (!treeData) return;
    const zoomG = this.svg.select("g.zoom-group");
    if (zoomG.empty() || !this.currentZoomBehavior) return;

    const width = window.innerWidth;
    const height = window.innerHeight; 
    const root = d3.hierarchy(treeData);

    const treeLayout = d3.tree().nodeSize([NODE_DIMENSIONS.width + 15, NODE_DIMENSIONS.height + 40]);
    treeLayout(root);

    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    root.each(d => {
      if (d.x < x0) x0 = d.x;
      if (d.x > x1) x1 = d.x;
      if (d.y < y0) y0 = d.y;
      if (d.y > y1) y1 = d.y;
    });

    if (x0 === Infinity) return;

    const minX = x0 - (NODE_DIMENSIONS.width / 2);
    const maxX = x1 + (NODE_DIMENSIONS.width / 2);
    const minY = y0 - (NODE_DIMENSIONS.height / 2);
    const maxY = y1 + (NODE_DIMENSIONS.height / 2) + 20; 

    const bWidth = maxX - minX;
    const bHeight = maxY - minY;
    const padding = 60; 

    const scaleX = (width - padding * 2) / bWidth;
    const scaleY = (height - padding * 2) / bHeight;
    const scale = Math.min(1.5, scaleX, scaleY);

    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;

    const tx = (width / 2) - (cx * scale);
    const ty = (height / 2) - (cy * scale);

    const transform = d3.zoomIdentity.translate(tx, ty).scale(scale);

    if (animate) {
      this.svg.transition().duration(750).call(this.currentZoomBehavior.transform, transform);
    } else {
      this.svg.call(this.currentZoomBehavior.transform, transform);
    }
  }

  createDragBehavior() {
    const renderer = this;
    return d3.drag()
      .on("start", function(event, d) {
        if (!canEditNode(d.data, renderer.ctx.localPeerId) || !canEditNode(d.parent?.data, renderer.ctx.localPeerId)) return; 
        
        d.isDragging = true;
        d.hasMoved = false;
        d.startX = event.x; 
        d.startY = event.y;
        
        d3.select(this).raise().select("rect")
          .attr("opacity", 0.8)
          .attr("stroke", COLORS.draft)
          .attr("stroke-width", 4);
      })
      .on("drag", function(event, d) {
        if (!d.isDragging) return;
        
        const totalDistance = Math.hypot(event.x - d.startX, event.y - d.startY);
        if (totalDistance > 5) d.hasMoved = true;
        
        d.x = event.x; d.y = event.y;
        
        const el = renderer.nodeElements.get(d);
        if (el) el.attr("transform", `translate(${d.x},${d.y})`);
        
        const link = renderer.linkElements.get(d);
        if (link) {
          const dragLinkGen = d3.linkVertical()
            .source(l => [l.source.x, l.source.y + NODE_DIMENSIONS.height / 2])
            .target(l => [l.target.x, l.target.y - NODE_DIMENSIONS.height / 2]);

          link.attr("d", dragLinkGen)
              .attr("stroke", COLORS.draft)
              .attr("stroke-width", 3)
              .attr("stroke-dasharray", "5,5");
        }
      })
      .on("end", function(event, d) {
        if (!d.isDragging) return;
        d.isDragging = false;
        
        if (!d.hasMoved) {
            renderer.render(renderer.lastData); 
            return; 
        }
        
        let droppedOnNode = null;
        const halfW = NODE_DIMENSIONS.width / 2;
        const halfH = NODE_DIMENSIONS.height / 2;
        
        renderer.nodeElements.forEach((targetEl, targetNode) => {
          const isSelfOrDescendant = targetNode.data.id === d.data.id || 
              targetNode.ancestors().some(a => a.data.id === d.data.id);
          if (isSelfOrDescendant) return;
          
          if (
              event.x >= targetNode.x - halfW && event.x <= targetNode.x + halfW &&
              event.y >= targetNode.y - halfH && event.y <= targetNode.y + halfH
          ) {
            droppedOnNode = targetNode;
          }
        });

        if (droppedOnNode && renderer.callbacks.onMove) {
          renderer.callbacks.onMove({ draggedNode: d, targetNode: droppedOnNode });
        } else {
          renderer.render(renderer.lastData); 
        }
      });
  }

  showDuplicateLinks(event, d) {
    if (!d.data.groupId) return;
    this.svg.selectAll(".duplicate-link")
      .filter(link => link.groupId === d.data.groupId)
      .transition().duration(200)
      .style("opacity", 0.7)
      .attr("stroke-width", 3);
  }

  hideDuplicateLinks() {
    this.svg.selectAll(".duplicate-link")
      .transition().duration(200)
      .style("opacity", 0)
      .attr("stroke-width", 4);
  }

  render(treeData) {
    if (!treeData) return;
    this.lastData = treeData;

    const g = this.svg.select("g.zoom-group");
    const linksLayer = g.select(".links-layer");
    const nodesLayer = g.select(".nodes-layer");
    
    this.nodeElements.clear();
    this.linkElements.clear();
    
    const root = d3.hierarchy(treeData);
    const treeLayout = d3.tree()
      .nodeSize([NODE_DIMENSIONS.width + 20, NODE_DIMENSIONS.height + 40])
      .separation((a, b) => (a.parent === b.parent ? 1 : 1.1)); 
    treeLayout(root);

    const t = this.svg.transition().duration(400);

    // --- Path Generators ---
    const edgeLinkGen = d3.linkVertical()
      .source(d => [d.source.x, d.source.y + NODE_DIMENSIONS.height / 2])
      .target(d => [d.target.x, d.target.y - NODE_DIMENSIONS.height / 2]);

    const getUnderArcPath = (d) => {
      const dx = d.target.x - d.source.x;
      const dy = d.target.y - d.source.y;
      
      // If the ghost is roughly directly below the source (like a standard child),
      // use the clean vertical tree link to avoid tight, messy loops.
      if (dy > 0 && Math.abs(dx) < NODE_DIMENSIONS.width * 1.5) {
        return edgeLinkGen(d); 
      }
      
      // For distant horizontal moves or upward moves, draw a sweeping under-arc
      // so it loops around the outside of the tree instead of slicing through it.
      const dr = Math.sqrt(dx * dx + dy * dy) * 1.2; 
      const startY = d.source.y + (NODE_DIMENSIONS.height / 2);
      const endY = d.target.y + (NODE_DIMENSIONS.height / 2);
      const sweep = dx > 0 ? 0 : 1; 
      
      return `M${d.source.x},${startY} A${dr},${dr} 0 0,${sweep} ${d.target.x},${endY}`;
    };

    const getDuplicateArcPath = (d) => {
      const dx = d.target.x - d.source.x;
      const dy = d.target.y - d.source.y;
      const dr = Math.sqrt(dx * dx + dy * dy) * 1.2; 
      return `M${d.source.x},${d.source.y} A${dr},${dr} 0 0,1 ${d.target.x},${d.target.y}`;
    };

    // --- 1. Duplicate Ghost Links ---
    const duplicateLinksData = [];
    const groupedDuplicates = new Map();
    
    root.descendants().forEach(d => {
      if (d.data.groupId) {
        if (!groupedDuplicates.has(d.data.groupId)) groupedDuplicates.set(d.data.groupId, []);
        groupedDuplicates.get(d.data.groupId).push(d);
      }
    });

    groupedDuplicates.forEach(nodes => {
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          duplicateLinksData.push({ source: nodes[i], target: nodes[j], groupId: nodes[i].data.groupId });
        }
      }
    });

    const dLinks = linksLayer.selectAll(".duplicate-link").data(duplicateLinksData, d => d.source.data.id + "-dup-" + d.target.data.id);
    dLinks.exit().remove();
    
    const dLinksEnter = dLinks.enter().append("path").attr("class", "duplicate-link")
      .attr("fill", "none")
      .attr("stroke-width", 4)
      .style("opacity", 0)
      .attr("stroke", d => this.nameColorScale(d.groupId))
      .attr("d", getDuplicateArcPath); // Set shape before transition

    dLinksEnter.merge(dLinks)
      .transition(t)
      .attr("stroke", d => this.nameColorScale(d.groupId))
      .attr("d", getDuplicateArcPath);

    // --- 2. Conflict Links ---
    const conflictLinksData = [];
    root.descendants().forEach(d => {
      if (d.data.conflicts) {
        d.data.conflicts.forEach(c => {
          if (c.type === 'move-proposal') {
            const ghostNode = root.descendants().find(n => n.data.id === c.ghostId);
            if (ghostNode) conflictLinksData.push({ source: d, target: ghostNode, type: c.type });
          } else if (c.type === 'merge-proposal') {
            const sourceNode = root.descendants().find(n => n.data.id === c.sourceId);
            if (sourceNode) conflictLinksData.push({ source: sourceNode, target: d, type: c.type });
          } else if (c.type === 'split-proposal') {
            c.ghostIds.forEach(gId => {
              const ghostNode = root.descendants().find(n => n.data.id === gId);
              if (ghostNode) conflictLinksData.push({ source: d, target: ghostNode, type: c.type });
            });
          }
        });
      }
    });

    const cLinks = linksLayer.selectAll(".conflict-link").data(conflictLinksData, d => d.source.data.id + "-conf-" + d.target.data.id);
    cLinks.exit().remove();
    
    const cLinksEnter = cLinks.enter().append("path").attr("class", "conflict-link")
      .attr("fill", "none")
      .attr("stroke-width", 3)
      .attr("stroke-dasharray", "5,5")
      .attr("stroke", d => {
        if (d.type === 'merge-proposal') return "#9c27b0";
        if (d.type === 'split-proposal') return "#e91e63"; 
        return "#ff9800";
      })
      .attr("d", getUnderArcPath); // Set shape before transition

    cLinksEnter.merge(cLinks)
      .transition(t)
      .attr("d", getUnderArcPath);

    // --- 3. Regular Links ---
    const links = linksLayer.selectAll(".link").data(root.links(), d => d.source.data.id + "-link-" + d.target.data.id);
    links.exit().remove();
    
    const linksEnter = links.enter().append("path").attr("class", "link")
      .attr("fill", "none")
      .attr("d", edgeLinkGen); // Set shape before transition
      
    const linksMerge = linksEnter.merge(links);
    
    linksMerge.transition(t)
      .attr("stroke", d => {
        if (d.target.data.isGhost) return COLORS.linkDefault;
        if (d.target.data.action === 'moved') return ACTION_COLORS.moved;
        if (d.target.data.action === 'added') return ACTION_COLORS.added; 
        return COLORS.linkDefault;
      })
      .attr("stroke-width", 2)
      .attr("stroke-dasharray", d => d.target.data.action === 'moved' ? "8,4" : "none") 
      .attr("d", edgeLinkGen); 
    
    linksMerge.each((d, i, nodes) => { this.linkElements.set(d.target, d3.select(nodes[i])); });

    // --- 4. Nodes ---
    const nodesData = nodesLayer.selectAll(".node").data(root.descendants(), d => d.data.id);
    nodesData.exit().remove();

    const nodesEnter = nodesData.enter().append("g")
      .attr("class", "node")
      .attr("transform", d => `translate(${d.parent ? d.parent.x : d.x},${d.parent ? d.parent.y : d.y})`)
      .call(this.drag)
      .on("mouseenter", (event, d) => {
         this.showDuplicateLinks(event, d);
         if (this.callbacks.onHover) this.callbacks.onHover({ event, d });
      })
      .on("mouseleave", () => {
         this.hideDuplicateLinks();
         if (this.callbacks.onHoverLeave) this.callbacks.onHoverLeave();
      })
      .on("click", (event, d) => {
        event.stopPropagation();
        if (this.callbacks.onSelect) this.callbacks.onSelect({ event, d });
      });

    nodesEnter.append("rect")
      .attr("width", NODE_DIMENSIONS.width)
      .attr("height", NODE_DIMENSIONS.height)
      .attr("x", -NODE_DIMENSIONS.width / 2)
      .attr("y", -NODE_DIMENSIONS.height / 2)
      .attr("rx", 8)
      .style("filter", "drop-shadow(0px 4px 6px rgba(0,0,0,0.05))");
    
    nodesEnter.append("g").attr("class", "merge-icon")
      .attr("transform", `translate(${NODE_DIMENSIONS.width / 2 - 24}, ${-NODE_DIMENSIONS.height / 2 + 4}) scale(0.65) rotate(180, 12, 12)`)
      .style("opacity", 0).append("path").attr("d", "M17 20.41L18.41 19 15 15.59 13.59 17 17 20.41zM7.5 8H11v5.59L5.59 19 7 20.41l6-6V8h3.5L12 3.5 7.5 8z").attr("fill", "#9c27b0");
    
    nodesEnter.append("g").attr("class", "split-icon")
      .attr("transform", `translate(${NODE_DIMENSIONS.width / 2 - 24}, ${-NODE_DIMENSIONS.height / 2 + 4}) scale(0.65) rotate(180, 12, 12)`)
      .style("opacity", 0).append("path").attr("d", "M14 4l2.29 2.29-2.88 2.88 1.42 1.42 2.88-2.88L20 10V4zm-4 0H4v6l2.29-2.29 4.71 4.7V20h2v-8.41l-5.29-5.3z").attr("fill", "#e91e63");
    
    nodesEnter.append("line").attr("class", "link-bar")
      .attr("x1", -NODE_DIMENSIONS.width / 2 + 4).attr("y1", -NODE_DIMENSIONS.height / 2 + 8) 
      .attr("x2", -NODE_DIMENSIONS.width / 2 + 4).attr("y2", NODE_DIMENSIONS.height / 2 - 8)  
      .attr("stroke-width", 4).attr("stroke-linecap", "round").style("opacity", 0); 

    nodesEnter.append("text").attr("class", "node-name").attr("dy", 1).attr("text-anchor", "middle").style("font-family", "system-ui, sans-serif").style("font-size", "10px").style("font-weight", "500");
    nodesEnter.append("text").attr("class", "conflict-text").attr("dy", 18).style("fill", "#ff9800").style("font-size", "11px").style("font-weight", "bold").attr("text-anchor", "middle");
    nodesEnter.append("text").attr("class", "lock-icon").attr("dy", -12).attr("dx", 55).style("font-size", "14px");
    nodesEnter.append("text").attr("class", "user-label").attr("dy", 18).attr("text-anchor", "middle").style("font-size", "8px");

    const nodesMerge = nodesEnter.merge(nodesData);
    nodesMerge.transition(t).attr("transform", d => `translate(${d.x},${d.y})`);
    nodesMerge.style("cursor", d => canEditNode(d.data, this.ctx.localPeerId) ? "grab" : "not-allowed");

    nodesMerge.select("rect")
      .attr("stroke", d => this.ctx.selectedIds.has(d.data.id) ? "#1a73e8" : this.getStrokeColor(d.data))
      .attr("stroke-width", d => {
        if (this.ctx.selectedIds.has(d.data.id)) return 4;
        return (d.data.locked || d.data.action || d.data.conflicts?.length || (this.ctx.isDraftMode && d.data._isDraft)) ? 3 : 2;
      })
      .style("opacity", d => d.data.isGhost ? 0.3 : 1)
      .attr("fill", d => d.data.action === 'deleted' ? "#ffebee" : "#ffffff");

    nodesMerge.select(".node-name")
      .text(d => d.data.name)
      .style("text-decoration", d => d.data.action === 'deleted' ? "line-through" : "none")
      .style("fill", d => d.data.action === 'deleted' ? "#aaa" : "#333");

    nodesMerge.select(".conflict-text").text(d => {
      if (!d.data.conflicts?.length) return "";
      
      const renames = d.data.conflicts.filter(c => c.type === 'rename').map(c => `"${c.value}"`);
      const merges = d.data.conflicts.filter(c => c.type === 'merge-proposal').map(c => c.sourceName);
      const splits = d.data.conflicts.filter(c => c.type === 'split-proposal').map(c => c.newNames.join(', '));
      
      let display = [];
      if (renames.length) display.push(`[RENAME]: ${renames.join(', ')}`);
      if (splits.length) display.push(`[SPLIT]: ${splits.join(' | ')}`);
      
      // Clean, concise count instead of a massive string
      if (merges.length) display.push(`[MERGING: ${merges.length}]`);
      
      return display.join(' | ');
    });

    nodesMerge.select(".lock-icon").text(d => {
      let text = d.data.locked ? "🔒 " : "";
      if (d.data.conflicts?.some(c => c.type === 'delete')) text += "⚠️ DEL";
      return text;
    });

    nodesMerge.select(".merge-icon").style("opacity", d => d.data.mergedFrom ? 1 : 0);
    nodesMerge.select(".split-icon").style("opacity", d => d.data.splitFrom ? 1 : 0);

    nodesMerge.select(".user-label")
      .attr("dy", d => {
        const hasConflictText = d.data.conflicts?.some(c => c.type === 'rename' || c.type === 'merge-proposal' || c.type === 'split-proposal');
        return hasConflictText ? 20 : 12;
      })
      .text(d => {
        if (d.data.isGhost) return "Proposed State";
        let text = d.data.lastEditedBy ? `✎ ${d.data.lastEditedBy}` : "";
        if (d.data.conflicts?.length) text += ` [CONFLICTS: ${d.data.conflicts.length}]`;
        else if (d.data.action) text += ` [${d.data.action.toUpperCase()}]`;
        if (d.data.mergedFrom) text += ` [MERGED]`;
        if (d.data.splitFrom) text += ` [SPLIT]`; 
        return text;
      });

    nodesMerge.each((d, i, nodes) => { this.nodeElements.set(d, d3.select(nodes[i])); });

    nodesMerge.select(".link-bar")
      .style("opacity", d => d.data.groupId ? 1 : 0)
      .attr("stroke", d => d.data.groupId ? this.nameColorScale(d.data.groupId) : "none");

    if (!this.initialRenderDone) {
      this.recenter(treeData, false);
      this.initialRenderDone = true;
    }
  }
}
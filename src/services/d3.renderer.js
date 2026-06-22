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

  setTransform(x, y, k) {
    if (!this.currentZoomBehavior) return;
    const transform = d3.zoomIdentity.translate(x, y).scale(k);
    this.svg.call(this.currentZoomBehavior.transform, transform);
  }

  constructor(svgElement, callbacks) {
    this.svg = d3.select(svgElement);
    this.callbacks = callbacks; 
    this.nodeElements = new Map();
    this.linkElements = new Map();
    this.currentZoomBehavior = null;
    this.initialRenderDone = false;
    this.nameColorScale = d3.scaleOrdinal(d3.schemePastel1);
    
    this.ctx = { isDraftMode: false, localPeerId: null, selectedIds: new Set(), showDeleted: true, layoutMode: 'vertical' };
    
    this.initCanvas();
    this.drag = this.createDragBehavior();
  }

  getLayout(root) {
    if (this.ctx.layoutMode === 'vertical') {
      return d3.tree().nodeSize([NODE_DIMENSIONS.height + 20, NODE_DIMENSIONS.width + 60]).separation((a, b) => (a.parent === b.parent ? 1 : 1.1));
    } else if (this.ctx.layoutMode === 'radial') {
      const radiusStep = NODE_DIMENSIONS.width + 140;
      const totalRadius = Math.max(400, (root.height || 1) * radiusStep);
      return d3.tree().size([2 * Math.PI, totalRadius]).separation((a, b) => (a.parent === b.parent ? 1.5 : 2.5) / (a.depth || 1));
    }
    return d3.tree().nodeSize([NODE_DIMENSIONS.width + 20, NODE_DIMENSIONS.height + 40]).separation((a, b) => (a.parent === b.parent ? 1 : 1.1));
  }

  project(x, y) {
    if (this.ctx.layoutMode === 'vertical') return [y, x];
    if (this.ctx.layoutMode === 'radial') {
      const angle = x - (Math.PI / 2); // x is strictly in radians (0 to 2*PI)
      return [y * Math.cos(angle), y * Math.sin(angle)];
    }
    return [x, y];
  }

  initCanvas() {
    if (this.svg.select("g.zoom-group").empty()) {
      const zoomG = this.svg.append("g").attr("class", "zoom-group");
      zoomG.append("g").attr("class", "links-layer");
      zoomG.append("g").attr("class", "nodes-layer");

      this.currentZoomBehavior = d3.zoom()
        .scaleExtent([0.1, 3])
        .on("zoom", (e) => {
          zoomG.attr("transform", e.transform);
          if (this.callbacks.onZoom) {
            this.callbacks.onZoom(e.transform);
          }
        });
      this.svg.call(this.currentZoomBehavior);
    }
  }

  updateContext(newContext) {
    this.ctx = { ...this.ctx, ...newContext };
  }

  findNodeAtPosition(clientX, clientY) {
    const svgNode = this.svg.node();
    const point = svgNode.createSVGPoint();
    point.x = clientX;
    point.y = clientY;

    const screenCTM = svgNode.getScreenCTM();
    if (!screenCTM) return null;

    const svgPoint = point.matrixTransform(screenCTM.inverse());
    const zoomTransform = d3.zoomTransform(svgNode);

    const x = (svgPoint.x - zoomTransform.x) / zoomTransform.k;
    const y = (svgPoint.y - zoomTransform.y) / zoomTransform.k;

    let droppedOnNode = null;
    const halfW = NODE_DIMENSIONS.width / 2;
    const halfH = NODE_DIMENSIONS.height / 2;

    this.nodeElements.forEach((targetEl, targetNode) => {
      if (targetNode.data.isSystemRoot) return;
      if (
        x >= targetNode.px - halfW && x <= targetNode.px + halfW &&
        y >= targetNode.py - halfH && y <= targetNode.py + halfH
      ) {
        droppedOnNode = targetNode;
      }
    });

    return droppedOnNode;
  }

  getStrokeColor(data) {
    if (data.isGhost) return "#9e9e9e";
    
    // Orange for ALL proposals (including pending deletions)
    if (data.conflicts?.length) return "#ff9800"; 
    
    // Red for officially executed deletions via ACTION_COLORS.deleted
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
    
    const root = d3.hierarchy(treeData, d => {
      const visible = d.children?.filter(c => !c.isDocked);
      return visible?.length ? visible : null;
    });

    const treeLayout = this.getLayout(root);
    treeLayout(root);

    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    root.each(d => {
      const [px, py] = this.project(d.x, d.y);
      d.px = px; d.py = py;
      if (d.px < x0) x0 = d.px;
      if (d.px > x1) x1 = d.px;
      if (d.py < y0) y0 = d.py;
      if (d.py > y1) y1 = d.py;
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
      .subject(function(event, d) { return { x: d.px, y: d.py }; })
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
        
        d.px = event.x; d.py = event.y;
        
        d3.select(this).attr("transform", `translate(${d.px},${d.py})`);
        
        const refreshLink = (targetNode) => {
          const l = renderer.linkElements.get(targetNode);
          if (!l) return;
          let dragLinkGen;
          if (renderer.ctx.layoutMode === 'vertical') {
            dragLinkGen = d3.link(d3.curveBumpX)
              .source(linkData => [linkData.source.px + NODE_DIMENSIONS.width / 2, linkData.source.py])
              .target(linkData => [linkData.target.px - NODE_DIMENSIONS.width / 2, linkData.target.py]);
          } else if (renderer.ctx.layoutMode === 'radial') {
            dragLinkGen = linkData => `M${linkData.source.px},${linkData.source.py} L${linkData.target.px},${linkData.target.py}`;
          } else {
            dragLinkGen = d3.link(d3.curveBumpY)
              .source(linkData => [linkData.source.px, linkData.source.py + NODE_DIMENSIONS.height / 2])
              .target(linkData => [linkData.target.px, linkData.target.py - NODE_DIMENSIONS.height / 2]);
          }
          l.attr("d", dragLinkGen).attr("stroke", COLORS.draft).attr("stroke-width", 3).attr("stroke-dasharray", "5,5");
        };

        refreshLink(d);
        
        if (d.children) {
          d.children.forEach(child => refreshLink(child));
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
              event.x >= targetNode.px - halfW && event.x <= targetNode.px + halfW &&
              event.y >= targetNode.py - halfH && event.y <= targetNode.py + halfH
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
    
    const root = d3.hierarchy(treeData, d => {
      const visible = d.children?.filter(c => !c.isDocked);
      return visible?.length ? visible : null;
    });

    const treeLayout = this.getLayout(root);
    treeLayout(root);
    
    root.each(d => {
      const [px, py] = this.project(d.x, d.y);
      d.px = px; d.py = py;
    });

    const t = this.svg.transition().duration(400);

    // --- Path Generators ---
    const edgeLinkGen = (d) => {
      if (this.ctx.layoutMode === 'vertical') {
        return d3.link(d3.curveBumpX)
          .source(l => [l.source.px + NODE_DIMENSIONS.width / 2, l.source.py])
          .target(l => [l.target.px - NODE_DIMENSIONS.width / 2, l.target.py])(d);
      }
      if (this.ctx.layoutMode === 'radial') {
        return d3.linkRadial()
          .angle(l => l.x)
          .radius(l => l.y)(d);
      }
      return d3.link(d3.curveBumpY)
        .source(l => [l.source.px, l.source.py + NODE_DIMENSIONS.height / 2])
        .target(l => [l.target.px, l.target.py - NODE_DIMENSIONS.height / 2])(d);
    };

    const getUnderArcPath = (d) => {
      const dx = d.target.px - d.source.px;
      const dy = d.target.py - d.source.py;
      const dist = Math.sqrt(dx * dx + dy * dy);
      
      if (dist < NODE_DIMENSIONS.width * 1.2 && d.type !== 'split-proposal') return edgeLinkGen(d);

      let dr = dist * 1.1; 
      let startPoint = [d.source.px, d.source.py];
      let endPoint = [d.target.px, d.target.py];
      let sweep = dx > 0 ? 0 : 1;

      if (this.ctx.layoutMode === 'vertical') {
        startPoint[0] += NODE_DIMENSIONS.width / 2;
        if (d.type === 'split-proposal') {
          endPoint[0] += NODE_DIMENSIONS.width / 2;
          dr = Math.max(80, Math.abs(dy) * 0.8);
          sweep = dy > 0 ? 1 : 0; 
        } else {
          endPoint[0] -= NODE_DIMENSIONS.width / 2;
          sweep = dy > 0 ? 1 : 0;
        }
      } else if (this.ctx.layoutMode === 'horizontal') {
        startPoint[1] += NODE_DIMENSIONS.height / 2;
        if (d.type === 'split-proposal') {
          endPoint[1] += NODE_DIMENSIONS.height / 2;
          dr = Math.max(80, Math.abs(dx) * 0.8);
          sweep = dx > 0 ? 0 : 1; 
        } else {
          endPoint[1] -= NODE_DIMENSIONS.height / 2;
        }
      }
      
      return `M${startPoint[0]},${startPoint[1]} A${dr},${dr} 0 0,${sweep} ${endPoint[0]},${endPoint[1]}`;
    };

    const getDuplicateArcPath = (d) => {
      const dx = d.target.px - d.source.px;
      const dy = d.target.py - d.source.py;
      const dr = Math.sqrt(dx * dx + dy * dy) * 1.2; 
      return `M${d.source.px},${d.source.py} A${dr},${dr} 0 0,1 ${d.target.px},${d.target.py}`;
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
    const seenConflicts = new Set();
    
    root.descendants().forEach(d => {
      if (d.data.isGhost) return;
      if (d.data.conflicts) {
        d.data.conflicts.forEach(c => {
          if (c.type === 'move-proposal') {
            const ghostNode = root.descendants().find(n => n.data.id === c.ghostId);
            if (ghostNode) {
              const key = `move-${d.data.id}-${ghostNode.data.id}`;
              if (!seenConflicts.has(key)) {
                seenConflicts.add(key);
                conflictLinksData.push({ source: d, target: ghostNode, type: c.type });
              }
            }
          } else if (c.type === 'merge-proposal') {
            const sourceNode = root.descendants().find(n => n.data.id === c.sourceId);
            if (sourceNode) {
              const key = `merge-${sourceNode.data.id}-${d.data.id}`;
              if (!seenConflicts.has(key)) {
                seenConflicts.add(key);
                conflictLinksData.push({ source: sourceNode, target: d, type: c.type });
              }
            }
          } else if (c.type === 'split-proposal') {
            c.ghostIds.forEach(gId => {
              const ghostNode = root.descendants().find(n => n.data.id === gId);
              if (ghostNode) {
                const key = `split-${d.data.id}-${ghostNode.data.id}`;
                if (!seenConflicts.has(key)) {
                  seenConflicts.add(key);
                  conflictLinksData.push({ source: d, target: ghostNode, type: c.type });
                }
              }
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
      .attr("d", getUnderArcPath);

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
        if (d.source.data.isSystemRoot) return "transparent"; // Sever visual anchor
        if (d.target.data.isGhost) return COLORS.linkDefault;
        if (d.target.data.action === 'moved') return ACTION_COLORS.moved;
        if (d.target.data.action === 'added') return ACTION_COLORS.added; 
        return COLORS.linkDefault;
      })
      .attr("stroke-width", 2)
      .attr("stroke-dasharray", "none") 
      .style("opacity", d => d.source.data.isSystemRoot ? 0 : 1) // Guarantee invisibility
      .attr("d", edgeLinkGen);

    linksMerge.each((d, i, nodes) => { this.linkElements.set(d.target, d3.select(nodes[i])); });

    // --- 4. Nodes ---
    const nodesData = nodesLayer.selectAll(".node").data(root.descendants(), d => d.data.id);
    nodesData.exit().remove();

    const nodesEnter = nodesData.enter().append("g")
      .attr("class", "node")
      .attr("transform", d => `translate(${d.parent ? d.parent.px : d.px},${d.parent ? d.parent.py : d.py})`)
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
    
    nodesEnter.append("g").attr("class", "delete-icon")
      .attr("transform", `translate(${NODE_DIMENSIONS.width / 2 - 24}, ${-NODE_DIMENSIONS.height / 2 + 4}) scale(0.65)`)
      .style("opacity", 0)
      .append("path")
      .attr("d", "M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z")
      .attr("fill", "#f44336");
    
    nodesEnter.append("line").attr("class", "link-bar")
      .attr("x1", -NODE_DIMENSIONS.width / 2 + 4).attr("y1", -NODE_DIMENSIONS.height / 2 + 8) 
      .attr("x2", -NODE_DIMENSIONS.width / 2 + 4).attr("y2", NODE_DIMENSIONS.height / 2 - 8)  
      .attr("stroke-width", 4).attr("stroke-linecap", "round").style("opacity", 0); 

    nodesEnter.append("text").attr("class", "node-name").attr("dy", 1).attr("text-anchor", "middle").style("font-family", "system-ui, sans-serif").style("font-size", "10px").style("font-weight", "500");
    nodesEnter.append("text").attr("class", "lock-icon").attr("dy", -12).attr("dx", 55).style("font-size", "14px");
    
    // Scalable foreignObject for layout underneath the node
    nodesEnter.append("foreignObject")
      .attr("class", "node-meta-fo")
      .attr("width", NODE_DIMENSIONS.width + 40)
      .attr("height", 60)
      .attr("x", -(NODE_DIMENSIONS.width + 40) / 2)
      .attr("y", NODE_DIMENSIONS.height / 2 + 2)
      .append("xhtml:div")
      .attr("class", "node-meta-container")
      .style("display", "flex")
      .style("flex-direction", "column")
      .style("align-items", "center")
      .style("text-align", "center")
      .style("width", "100%")
      .style("height", "100%")
      .style("overflow", "hidden");

    const nodesMerge = nodesEnter.merge(nodesData);
    
    // 1. Cloak the group during the transform transition
    nodesMerge.transition(t)
      .attr("transform", d => `translate(${d.px},${d.py})`)
      .style("opacity", d => d.data.isSystemRoot ? 0 : 1);

    // 2. Disable all physics/mouse interactions for the phantom root
    nodesMerge.style("pointer-events", d => d.data.isSystemRoot ? "none" : "all");
    
    nodesMerge.style("cursor", d => {
      if (d.data.isSystemRoot) return "default";
      return canEditNode(d.data, this.ctx.localPeerId) ? "grab" : "not-allowed";
    });

    // 3. Standard node styling
    nodesMerge.select("rect")
      .attr("stroke", d => {
        if (this.ctx.selectedIds.has(d.data.id)) return "#1a73e8";
        if (d.ancestors().some(a => a !== d && a.data.conflicts?.some(c => c.type === 'delete' && c.cascade))) return "#ff9800";
        return this.getStrokeColor(d.data);
      })
      .attr("stroke-width", d => {
        if (this.ctx.selectedIds.has(d.data.id)) return 4;
        const isCascadePending = d.ancestors().some(a => a !== d && a.data.conflicts?.some(c => c.type === 'delete' && c.cascade));
        return (isCascadePending || d.data.locked || d.data.action || d.data.conflicts?.length || (this.ctx.isDraftMode && d.data._isDraft)) ? 3 : 2;
      })
      .style("opacity", d => d.data.isGhost ? 0.3 : 1)
      .attr("fill", d => {
        const isPendingDelete = d.ancestors().some(a => a.data.conflicts?.some(c => c.type === 'delete' && (c.cascade || a === d)));
        return isPendingDelete ? "#ffebee" : "#ffffff";
      });

    nodesMerge.select(".node-name")
      .text(d => d.data.name)
      .style("text-decoration", "none")
      .style("fill", "#333");

    nodesMerge.select(".lock-icon").text(d => d.data.locked ? "🔒 " : "");

    nodesMerge.select(".merge-icon").style("opacity", d => d.data.mergedFrom ? 1 : 0);
    nodesMerge.select(".split-icon").style("opacity", d => d.data.splitFrom ? 1 : 0);
    nodesMerge.select(".delete-icon").style("opacity", d => d.data.deletedChildren?.length ? 1 : 0);

    // Content Condensation via HTML injection
    nodesMerge.select(".node-meta-container").html(d => {
      let html = "";
      
      const isCascadePending = d.ancestors().some(a => a !== d && a.data.conflicts?.some(c => c.type === 'delete' && c.cascade));
      
      if (d.data.conflicts?.length) {
        const count = d.data.conflicts.length;
        html += `<div style="color: #ff9800; font-size: 10px; font-weight: bold; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; letter-spacing: 0.5px;">[${count} PROPOSAL${count > 1 ? 'S' : ''}]</div>`;
      } else if (isCascadePending) {
        html += `<div style="color: #f44336; font-size: 10px; font-weight: bold; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; letter-spacing: 0.5px;">[CASCADE DELETE]</div>`;
      }

      let userText = d.data.isGhost ? "Proposed State" : "";
      if (!userText) {
        if (d.data.lastEditedBy) userText += `✎ ${d.data.lastEditedBy}`;
        if (d.data.action) userText += ` [${d.data.action.toUpperCase()}]`;
        if (d.data.mergedFrom) userText += ` [MERGED]`;
        if (d.data.splitFrom) userText += ` [SPLIT]`;
      }

      if (userText) {
        html += `<div style="font-size: 8px; color: #5f6368; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; margin-top: 2px;">${userText}</div>`;
      }

      return html;
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
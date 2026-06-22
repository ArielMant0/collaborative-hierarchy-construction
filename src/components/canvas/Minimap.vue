<template>
  <div class="minimap-container" @dblclick.stop @wheel.stop>
    <svg ref="minimapSvg" class="minimap-svg">
      <g ref="treeGroup" class="tree-group">
        <g class="links-layer"></g>
        <g class="nodes-layer"></g>
      </g>
      <rect 
        ref="viewRect" 
        class="minimap-viewport" 
        fill="rgba(26, 115, 232, 0.15)" 
        stroke="#1a73e8" 
        stroke-width="1.5" 
        style="pointer-events: none;">
      </rect>
    </svg>
  </div>
</template>

<script setup>
import { ref, watch, onMounted, onUnmounted } from 'vue';
import * as d3 from 'd3';

const props = defineProps({
  treeData: Object,
  currentTransform: { type: Object, default: () => ({ x: 0, y: 0, k: 1 }) },
  layoutMode: { type: String, default: 'horizontal' }
});

const emit = defineEmits(['update-transform']);

const minimapSvg = ref(null);
const treeGroup = ref(null);
const viewRect = ref(null);

const MINIMAP_SIZE = { width: 240, height: 160 };
const NODE_DIMENSIONS = { width: 110, height: 36 };

let currentScale = 1;
let treeCenter = { x: 0, y: 0 };

onMounted(() => {
  const svg = d3.select(minimapSvg.value)
    .attr('width', MINIMAP_SIZE.width)
    .attr('height', MINIMAP_SIZE.height);

  const drag = d3.drag().on('drag', (event) => {
    if (!currentScale) return;
    const treeDx = event.dx / currentScale;
    const treeDy = event.dy / currentScale;
    
    const newX = props.currentTransform.x - (treeDx * props.currentTransform.k);
    const newY = props.currentTransform.y - (treeDy * props.currentTransform.k);
    
    emit('update-transform', newX, newY, props.currentTransform.k);
  });
  
  svg.call(drag);
  
  window.addEventListener('resize', updateViewport);
  if (props.treeData) drawMinimap();
});

onUnmounted(() => {
  window.removeEventListener('resize', updateViewport);
});

function project(x, y, mode) {
  if (mode === 'vertical') return [y, x];
  if (mode === 'radial') {
    const angle = x - (Math.PI / 2);
    return [y * Math.cos(angle), y * Math.sin(angle)];
  }
  return [x, y];
}

function drawMinimap() {
  if (!props.treeData || !treeGroup.value) return;

  const root = d3.hierarchy(props.treeData, d => d.children?.filter(c => !c.isDocked));
  
  let treeLayout;
  if (props.layoutMode === 'vertical') {
    treeLayout = d3.tree().nodeSize([NODE_DIMENSIONS.height + 20, NODE_DIMENSIONS.width + 60]).separation((a, b) => (a.parent === b.parent ? 1 : 1.1));
  } else if (props.layoutMode === 'radial') {
    const radiusStep = NODE_DIMENSIONS.width + 140;
    const totalRadius = Math.max(400, (root.height || 1) * radiusStep);
    treeLayout = d3.tree().size([2 * Math.PI, totalRadius]).separation((a, b) => (a.parent === b.parent ? 1.5 : 2.5) / (a.depth || 1));
  } else {
    treeLayout = d3.tree().nodeSize([NODE_DIMENSIONS.width + 20, NODE_DIMENSIONS.height + 40]).separation((a, b) => (a.parent === b.parent ? 1 : 1.1));
  }
  
  treeLayout(root);

  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  root.each(d => {
    const [px, py] = project(d.x, d.y, props.layoutMode);
    d.px = px; d.py = py;
    if (px < x0) x0 = px;
    if (px > x1) x1 = px;
    if (py < y0) y0 = py;
    if (py > y1) y1 = py;
  });

  if (x0 === Infinity) return;

  x0 -= NODE_DIMENSIONS.width / 2;
  x1 += NODE_DIMENSIONS.width / 2;
  y0 -= NODE_DIMENSIONS.height / 2;
  y1 += NODE_DIMENSIONS.height / 2;

  const treeW = Math.max(x1 - x0, NODE_DIMENSIONS.width);
  const treeH = Math.max(y1 - y0, NODE_DIMENSIONS.height);
  
  treeCenter = { x: x0 + treeW / 2, y: y0 + treeH / 2 };

  const pad = 16;
  const mapW = MINIMAP_SIZE.width - pad * 2;
  const mapH = MINIMAP_SIZE.height - pad * 2;

  currentScale = Math.min(mapW / treeW, mapH / treeH);

  const tx = (MINIMAP_SIZE.width / 2) - (treeCenter.x * currentScale);
  const ty = (MINIMAP_SIZE.height / 2) - (treeCenter.y * currentScale);

  const group = d3.select(treeGroup.value);
  group.attr("transform", `translate(${tx}, ${ty}) scale(${currentScale})`);

  const linksLayer = group.select('.links-layer');
  const links = linksLayer.selectAll('line.mini-link').data(root.links());
  links.join('line')
    .attr('class', 'mini-link')
    .attr('x1', d => d.source.px)
    .attr('y1', d => d.source.py)
    .attr('x2', d => d.target.px)
    .attr('y2', d => d.target.py)
    .attr('stroke', '#cfd8dc')
    .attr('stroke-width', 1.5)
    .attr('vector-effect', 'non-scaling-stroke')
    .style('opacity', d => d.source.data.isSystemRoot ? 0 : 1);

  const nodesLayer = group.select('.nodes-layer');
  const nodes = nodesLayer.selectAll('rect.mini-node').data(root.descendants(), d => d.data.id);
  nodes.join('rect')
    .attr('class', 'mini-node')
    .attr('x', d => d.px - NODE_DIMENSIONS.width / 2)
    .attr('y', d => d.py - NODE_DIMENSIONS.height / 2)
    .attr('width', NODE_DIMENSIONS.width)
    .attr('height', NODE_DIMENSIONS.height)
    .attr('rx', 8)
    .attr('vector-effect', 'non-scaling-stroke')
    .attr('fill', d => {
      if (d.data.isSystemRoot) return 'none';
      return d.data.conflicts?.length ? '#ffe0b2' : '#f8f9fa';
    })
    .attr('stroke', d => {
      if (d.data.isSystemRoot) return 'none';
      return d.data.conflicts?.length ? '#ff9800' : '#b0bec5';
    })
    .attr('stroke-width', 1.5);

  updateViewport();
}

function updateViewport() {
  if (!viewRect.value || !currentScale) return;
  
  const screenW = window.innerWidth;
  const screenH = window.innerHeight;

  const treeDataX = (0 - props.currentTransform.x) / props.currentTransform.k;
  const treeDataY = (0 - props.currentTransform.y) / props.currentTransform.k;
  
  const treeDataW = screenW / props.currentTransform.k;
  const treeDataH = screenH / props.currentTransform.k;

  const tx = (MINIMAP_SIZE.width / 2) - (treeCenter.x * currentScale);
  const ty = (MINIMAP_SIZE.height / 2) - (treeCenter.y * currentScale);

  d3.select(viewRect.value)
    .attr('x', treeDataX * currentScale + tx)
    .attr('y', treeDataY * currentScale + ty)
    .attr('width', treeDataW * currentScale)
    .attr('height', treeDataH * currentScale);
}

watch(() => props.treeData, drawMinimap, { deep: true });
watch(() => props.layoutMode, drawMinimap);
watch(() => props.currentTransform, updateViewport, { deep: true });
</script>

<style scoped>
.minimap-container {
  position: absolute;
  bottom: 24px;
  right: 24px;
  background: rgba(255, 255, 255, 0.98);
  backdrop-filter: blur(8px);
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.1);
  z-index: 1000;
  overflow: hidden;
  cursor: grab;
}
.minimap-container:active {
  cursor: grabbing;
}
.minimap-svg {
  display: block;
}
</style>
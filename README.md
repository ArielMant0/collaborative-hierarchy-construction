# Distributed Synchronous Collaborative Hierarchy Building with Visualization

## Project Overview

This system is a web-based, interactive environment designed to facilitate the collaborative construction and modification of hierarchical structures. It addresses the challenges of real-time coordination by providing an intuitive space where multiple users can stay aware of changes, maintain data consistency, and resolve structural conflicts through direct manipulation and visualization.

## Architecture

The application follows a decoupled, three-tier model designed to isolate framework-agnostic logic from the presentation layer (Vue 3). This ensures that the core engine remains stable regardless of the frontend framework used.

### 1. Pure Logic Layer (`/src/services` & `/src/utils`)

Handles heavy computational tasks including network transport, data synchronization, and canvas rendering. These modules operate independently of Vue's reactivity system to prevent infinite rendering loops and memory leaks.

- **WebRTC Service**: Manages unstable peer-to-peer connections via a standard JavaScript EventTarget to guarantee independent network operations.
- **CRDT Service**: Wraps Yjs to manage raw binary data updates, preventing accidental mutation of shared state by the UI.
- **D3 Renderer**: A standalone ES6 class that performs direct DOM manipulation on an infinite canvas, ensuring 60FPS performance for dragging and zooming.

### 2. Reactivity Bridge (`/src/composables`)

Acts as the adapter pattern, mapping vanilla JavaScript events from the logic layer into reactive Vue variables (`ref`, `reactive`).

- **useTreeState**: Manages the critical transition between the Staging environment (global state) and Draft mode (individual workspace).
- **useNetwork**: Transforms native WebRTC events into reactive state for UI updates.

### 3. Presentation & Orchestration (`/src/components` & `App.vue`)

Composed of "dumb" UI modules that handle local state and user input. `App.vue` serves as the Master Orchestrator, containing the conflict resolution matrix and routing data between the engine and the interface.

## Core Features

- **Staging vs. Draft Environments**: Users have access to a shared visualization for the global state and individual visualizations to explore or propose changes privately before contributing.
- **Conflict Resolution Matrix**: A specialized logic layer to identify and resolve differences, overlaps, and structural conflicts between local and shared hierarchies.
- **Ghost Projections**: Proposed structural changes (moves or splits) are visualized as "ghost" nodes to help collaborators understand potential modifications.
- **Infinite Canvas**: Support for space-efficient tree visualizations with full zoom and pan capabilities.
- **Real-time Synchronization**: Peer-to-peer data synchronization ensures a consistent state across all connected clients.

## Data Flow Paradigm

The architecture enforces a strict unidirectional data flow to maintain synchronization:

**Inbound (Network to UI)**
1. WebRTC Service receives binary data.
2. CRDT Service applies the Yjs update.
3. useTreeState parses the Yjs state into JSON.
4. App.vue passes JSON as a prop to components.
5. TreeCanvas triggers D3 to redraw.

**Outbound (User to Network)**
1. User interacts with a node (e.g., dragging).
2. D3 Renderer emits a native event.
3. App.vue evaluates the interaction against the conflict resolution matrix.
4. CRDT Service generates a raw binary diff of the update.
5. WebRTC Service broadcasts the diff to all connected peers.

## Setup & Installation

### Prerequisites

- Node.js
- npm or pnpm

### Installation

1. **Clone the Repository:**

```bash
git clone https://github.com/ArielMant0/collaborative-hierarchy-construction.git
cd collaborative-hierarchy-construction
```

2. **Install Dependencies:**
```bash
npm install
```

3. **Run Development Server:**
```bash
npm run dev
```

4. **Testing Collaboration:** Open the local server address (default ```localhost:5173```) in multiple browser windows or tabs to simulate multiple users.

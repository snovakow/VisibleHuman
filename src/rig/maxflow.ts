// A minimum cut, by Boykov and Kolmogorov's maximum flow, which grows a search tree from each terminal and reuses
// them from one augmenting path to the next: on a grid, where most paths are short and many, it runs far faster than
// searching anew for each path. Nodes are numbered from 0; an edge joins two of them with a capacity each way; a
// node's terminal capacities tie it to the source and the sink. After maxflow(), a node on the source's side of the
// minimum cut is one the source's tree still reaches. Held in typed arrays, so a cut over millions of edges makes no
// garbage. Pure, so the rig script and the tests run it

const free = 0
const sourceTree = 1
const sinkTree = 2
// A node's parent is its terminal, or it has none
const terminalParent = -1
const noParent = -2

export class MinCut {
  private readonly nodes: number
  // Each node's edges, as a linked list through next, and each edge's head, its residual capacity and its sister's
  private first: Int32Array
  private next: Int32Array
  private head: Int32Array
  private residual: Float64Array
  private edges = 0
  // Each node's residual terminal capacity: from the source where positive, to the sink where negative
  private terminal: Float64Array
  private tree: Uint8Array
  private parent: Int32Array
  // When each node's path to its terminal was last checked, and how long it was then, for the adoption's search
  private stamp: Int32Array
  private depth: Int32Array
  private time = 0

  constructor(nodes: number, edgeCapacity = nodes * 6) {
    this.nodes = nodes
    this.first = new Int32Array(nodes).fill(-1)
    this.next = new Int32Array(edgeCapacity)
    this.head = new Int32Array(edgeCapacity)
    this.residual = new Float64Array(edgeCapacity)
    this.terminal = new Float64Array(nodes)
    this.tree = new Uint8Array(nodes)
    this.parent = new Int32Array(nodes).fill(noParent)
    this.stamp = new Int32Array(nodes)
    this.depth = new Int32Array(nodes)
  }

  private grow() {
    const size = this.next.length * 2
    const grown = (from: Int32Array) => {
      const to = new Int32Array(size)
      to.set(from)
      return to
    }
    this.next = grown(this.next)
    this.head = grown(this.head)
    const residual = new Float64Array(size)
    residual.set(this.residual)
    this.residual = residual
  }

  // An edge from a to b of capacity ab, and its sister from b to a of capacity ba; an edge's sister is the edge
  // numbered beside it, which edge ^ 1 finds
  addEdge(a: number, b: number, ab: number, ba: number) {
    if (this.edges + 2 > this.next.length) this.grow()
    const e = this.edges
    this.head[e] = b
    this.residual[e] = ab
    this.next[e] = this.first[a]
    this.first[a] = e
    this.head[e + 1] = a
    this.residual[e + 1] = ba
    this.next[e + 1] = this.first[b]
    this.first[b] = e + 1
    this.edges += 2
  }

  // Ties a node to the source and to the sink with these capacities; flow straight from one to the other through it is
  // pushed at once
  setTerminal(node: number, source: number, sink: number) {
    this.terminal[node] += source - sink
  }

  // Whether a node is on the source's side of the minimum cut
  isSource(node: number) {
    return this.tree[node] === sourceTree
  }

  // Whether a node is one the sink's tree still reaches. A node neither tree reaches lies on no side the cut chose: one
  // the flow never touched, or one cut off from both terminals by edges the flow filled
  isSink(node: number) {
    return this.tree[node] === sinkTree
  }

  // The maximum flow from the source to the sink, less what setTerminal pushed straight through a node tied to both
  maxflow(): number {
    const { nodes, terminal, tree, parent, first, next, head, residual, stamp, depth } = this
    let flow = 0
    // Every node tied to a terminal starts that terminal's tree, and is active
    const active: number[] = []
    let activeAt = 0
    const isActive = new Uint8Array(nodes)
    const activate = (node: number) => {
      if (isActive[node] === 1) return
      isActive[node] = 1
      active.push(node)
    }
    for (let node = 0; node < nodes; node++) {
      if (terminal[node] > 0) tree[node] = sourceTree
      else if (terminal[node] < 0) tree[node] = sinkTree
      else continue
      parent[node] = terminalParent
      activate(node)
    }
    const orphans: number[] = []

    // The head of the path from a node up its tree to its terminal, for the bottleneck and the push
    const pushAlong = (from: number, to: number, joining: number) => {
      // The bottleneck: the joining edge, the source side's edges up to its root and the sink side's down to its root
      let bottleneck = residual[joining]
      for (let node = from; parent[node] !== terminalParent; node = head[parent[node]]) bottleneck = Math.min(bottleneck, residual[parent[node] ^ 1])
      for (let node = from; ; node = head[parent[node]]) {
        if (parent[node] === terminalParent) {
          bottleneck = Math.min(bottleneck, terminal[node])
          break
        }
      }
      for (let node = to; parent[node] !== terminalParent; node = head[parent[node]]) bottleneck = Math.min(bottleneck, residual[parent[node]])
      for (let node = to; ; node = head[parent[node]]) {
        if (parent[node] === terminalParent) {
          bottleneck = Math.min(bottleneck, -terminal[node])
          break
        }
      }
      residual[joining] -= bottleneck
      residual[joining ^ 1] += bottleneck
      // The source's side: each edge up the tree carries the flow toward the node below it
      for (let node = from; ; ) {
        const edge = parent[node]
        if (edge === terminalParent) {
          terminal[node] -= bottleneck
          if (terminal[node] === 0) {
            parent[node] = noParent
            orphans.push(node)
          }
          break
        }
        // The parent edge runs from the node up to its parent; flow goes the other way, along its sister
        residual[edge ^ 1] -= bottleneck
        residual[edge] += bottleneck
        if (residual[edge ^ 1] === 0) {
          parent[node] = noParent
          orphans.push(node)
        }
        node = head[edge]
      }
      for (let node = to; ; ) {
        const edge = parent[node]
        if (edge === terminalParent) {
          terminal[node] += bottleneck
          if (terminal[node] === 0) {
            parent[node] = noParent
            orphans.push(node)
          }
          break
        }
        residual[edge] -= bottleneck
        residual[edge ^ 1] += bottleneck
        if (residual[edge] === 0) {
          parent[node] = noParent
          orphans.push(node)
        }
        node = head[edge]
      }
      flow += bottleneck
    }

    // Whether a node's path up its tree reaches the terminal, and how far, for an orphan looking for a new parent; the
    // nodes found on the way are stamped with the path's length from them, so the next search stops at them
    const rootDepth = (start: number): number => {
      let length = 0
      let node = start
      for (;;) {
        if (stamp[node] === this.time) {
          length += depth[node]
          break
        }
        const edge = parent[node]
        if (edge === noParent) return -1
        length++
        if (edge === terminalParent) {
          stamp[node] = this.time
          depth[node] = 1
          break
        }
        node = head[edge]
      }
      // Stamp the path's nodes with their own distances
      for (let node2 = start, d = length; stamp[node2] !== this.time; node2 = head[parent[node2]]) {
        stamp[node2] = this.time
        depth[node2] = d--
      }
      return length
    }

    const adopt = () => {
      for (let orphan = orphans.pop(); orphan !== undefined; orphan = orphans.pop()) {
        const own = tree[orphan]
        this.time++
        let bestEdge = noParent
        let bestDepth = Infinity
        for (let edge = first[orphan]; edge >= 0; edge = next[edge]) {
          const neighbour = head[edge]
          if (tree[neighbour] !== own) continue
          // In the source's tree flow runs from the neighbour to the orphan, along the edge's sister; in the sink's,
          // from the orphan to the neighbour, along the edge
          const capacity = own === sourceTree ? residual[edge ^ 1] : residual[edge]
          if (capacity <= 0) continue
          const length = rootDepth(neighbour)
          if (length >= 0 && length < bestDepth) {
            bestDepth = length
            bestEdge = edge
          }
        }
        if (bestEdge !== noParent) {
          parent[orphan] = bestEdge
          stamp[orphan] = this.time
          depth[orphan] = bestDepth + 1
          continue
        }
        // No new parent: the orphan leaves its tree, its children become orphans and its neighbours that could feed it
        // become active
        for (let edge = first[orphan]; edge >= 0; edge = next[edge]) {
          const neighbour = head[edge]
          if (tree[neighbour] !== own) continue
          const capacity = own === sourceTree ? residual[edge ^ 1] : residual[edge]
          if (capacity > 0) activate(neighbour)
          if (parent[neighbour] >= 0 && head[parent[neighbour]] === orphan) {
            parent[neighbour] = noParent
            orphans.push(neighbour)
          }
        }
        tree[orphan] = free
      }
    }

    while (activeAt < active.length) {
      const node = active[activeAt++]
      isActive[node] = 0
      if (tree[node] === free) continue
      let joined = false
      for (let edge = first[node]; edge >= 0 && tree[node] !== free; edge = next[edge]) {
        const neighbour = head[edge]
        const capacity = tree[node] === sourceTree ? residual[edge] : residual[edge ^ 1]
        if (capacity <= 0) continue
        if (tree[neighbour] === free) {
          tree[neighbour] = tree[node]
          parent[neighbour] = edge ^ 1
          activate(neighbour)
        } else if (tree[neighbour] !== tree[node]) {
          // A path from the source to the sink: push along it, then mend the trees
          if (tree[node] === sourceTree) pushAlong(node, neighbour, edge)
          else pushAlong(neighbour, node, edge ^ 1)
          adopt()
          joined = true
          break
        }
      }
      // A node that found a path may have more: it's looked at again
      if (joined && tree[node] !== free) activate(node)
      // Compact the queue now and then, so it doesn't grow without end
      if (activeAt > 1 << 20) {
        active.splice(0, activeAt)
        activeAt = 0
      }
    }
    return flow
  }
}

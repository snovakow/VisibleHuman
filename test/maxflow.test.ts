import assert from 'node:assert/strict'
import { test } from 'node:test'
import { MinCut } from '../src/rig/maxflow.ts'

// The minimum cut (src/rig/maxflow.ts), checked against every cut of small graphs, and on a grid whose cheapest cut
// is known

// A repeatable random number from 0 to 1
function random(seed: number) {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 2 ** 32
  }
}

interface Graph {
  nodes: number
  edges: [number, number, number, number][]
  source: number[]
  sink: number[]
}

// The cheapest cut by trying every split of the nodes: the capacities from the source side to the sink side
function bruteForce({ nodes, edges, source, sink }: Graph): number {
  let best = Infinity
  for (let mask = 0; mask < 1 << nodes; mask++) {
    const onSource = (node: number) => ((mask >> node) & 1) === 1
    let cost = 0
    for (let node = 0; node < nodes; node++) cost += onSource(node) ? sink[node] : source[node]
    for (const [a, b, ab, ba] of edges) {
      if (onSource(a) && !onSource(b)) cost += ab
      if (onSource(b) && !onSource(a)) cost += ba
    }
    best = Math.min(best, cost)
  }
  return best
}

// The cut the solver finds, priced the same way, from its sides
function solved(graph: Graph): { cost: number; flow: number } {
  const cut = new MinCut(graph.nodes, 4)
  for (const [a, b, ab, ba] of graph.edges) cut.addEdge(a, b, ab, ba)
  for (let node = 0; node < graph.nodes; node++) cut.setTerminal(node, graph.source[node], graph.sink[node])
  const flow = cut.maxflow()
  let cost = 0
  for (let node = 0; node < graph.nodes; node++) cost += cut.isSource(node) ? graph.sink[node] : graph.source[node]
  for (const [a, b, ab, ba] of graph.edges) {
    if (cut.isSource(a) && !cut.isSource(b)) cost += ab
    if (cut.isSource(b) && !cut.isSource(a)) cost += ba
  }
  // The flow straight through a node tied to both terminals is pushed before the search, and counted here
  const through = graph.source.reduce((sum, capacity, node) => sum + Math.min(capacity, graph.sink[node]), 0)
  return { cost, flow: flow + through }
}

void test('on small random graphs the cut found is the cheapest, and costs what flows', () => {
  const next = random(7)
  for (let trial = 0; trial < 300; trial++) {
    const nodes = 2 + Math.floor(next() * 9)
    const edges: Graph['edges'] = []
    for (let a = 0; a < nodes; a++) {
      for (let b = a + 1; b < nodes; b++) {
        if (next() < 0.45) edges.push([a, b, Math.floor(next() * 10), Math.floor(next() * 10)])
      }
    }
    const source = Array.from({ length: nodes }, () => (next() < 0.3 ? Math.floor(next() * 12) : 0))
    const sink = Array.from({ length: nodes }, () => (next() < 0.3 ? Math.floor(next() * 12) : 0))
    const graph = { nodes, edges, source, sink }
    const expected = bruteForce(graph)
    const { cost, flow } = solved(graph)
    assert.equal(cost, expected, `trial ${trial}`)
    assert.equal(flow, expected, `trial ${trial}'s flow`)
  }
})

void test('on a grid the cut runs along its cheapest column', () => {
  // A 20 × 12 grid, the left column tied to the source and the right to the sink, with every edge across costing 10
  // but those between columns 13 and 14, which cost 1: the cut is that seam
  const width = 20
  const height = 12
  const node = (x: number, y: number) => x + width * y
  const cut = new MinCut(width * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (x + 1 < width) {
        const capacity = x === 13 ? 1 : 10
        cut.addEdge(node(x, y), node(x + 1, y), capacity, capacity)
      }
      if (y + 1 < height) cut.addEdge(node(x, y), node(x, y + 1), 10, 10)
    }
    cut.setTerminal(node(0, y), 1000, 0)
    cut.setTerminal(node(width - 1, y), 0, 1000)
  }
  assert.equal(cut.maxflow(), height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) assert.equal(cut.isSource(node(x, y)), x <= 13, `(${x}, ${y})`)
  }
})

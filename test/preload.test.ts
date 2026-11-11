import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { test } from 'node:test'
import { defaultLevel, readBodies } from '../src/volume/bodies.ts'

// index.html's preload of the list of bodies and of the body the address names, held to bodies.json, so that a
// renamed or rebuilt default file fails here instead of leaving the browser to fetch a file it was never asked to use

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
const list = readFileSync(new URL('../public/volume/bodies.json', import.meta.url), 'utf8')
const { bodies } = readBodies(JSON.parse(list))

void test("the preload's table is each body's default file, in bodies.json's order", () => {
  const table = /var files = (\{[^}]*\});/.exec(html)
  assert.ok(table, "index.html's preload has no table of files")
  const files: unknown = JSON.parse(table[1])
  assert.deepEqual(files, Object.fromEntries(bodies.map((body) => [body.id, defaultLevel(body).file])))
  // The first entry stands for the first body, which an unknown or empty ?body= opens
  assert.ok(typeof files === 'object' && files !== null)
  assert.deepEqual(
    Object.keys(files),
    bodies.map((body) => body.id),
  )
  for (const body of bodies) {
    const file = defaultLevel(body).file
    assert.ok(existsSync(new URL(`../public/${file}`, import.meta.url)), `public/${file} isn't there`)
  }
})

void test('the preload asks for the list the page fetches, as a CORS fetch, before the page script runs', () => {
  const script = html.indexOf('var files = ')
  const page = html.indexOf('<script type="module"')
  assert.ok(script > 0 && page > script, "the preload doesn't come before the page script")
  const preload = html.slice(script, page)
  assert.match(preload, /\['volume\/bodies\.json', file\]/)
  assert.match(preload, /link\.rel = 'preload';/)
  assert.match(preload, /link\.as = 'fetch';/)
  assert.match(preload, /link\.crossOrigin = 'anonymous';/)
  // The page's fetch of the list, which the preload must name as written
  const loader = readFileSync(new URL('../src/volume/loadVolume.ts', import.meta.url), 'utf8')
  assert.match(loader, /const bodiesUrl = 'volume\/bodies\.json'/)
})

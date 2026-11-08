import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseListing } from '../scripts/lib/listing.ts'

// The NLM mirror's listings, on rows copied from Additional-Head-Images/MR_CT_tiffs/CAT-tiff/index.html and
// MRI-tiff/index.html on 2026-11-08. No listing there holds a character reference, so the row with one is written here
// in the same shape

const head =
  "<!DOCTYPE html><html><head><meta http-equiv='content-type' content='text/html; charset=utf-8'>" +
  '<title>Index of public/Visible-Human/Additional-Head-Images/MR_CT_tiffs/CAT-tiff/</title></head><body>' +
  "<h1>Index of public/Visible-Human/Additional-Head-Images/MR_CT_tiffs/CAT-tiff/</h1><table id='list'><thead><tr>" +
  "<th style='width:55%'>File Name</th><th style='width:20%'>File Size</th><th style='width:25%'>Date</th>" +
  '</tr></thead><tbody>'
const tail = '</tbody></table></body></html>'

const row = (href: string, name: string, size: string, date: string) =>
  `<tr><td class='link'><a href='${href}'>${name}</a></td><td class='size'>${size}</td>` +
  `<td class='date'>${date}</td></tr>`

void test('a listing gives each file with its size in bytes, in its order', () => {
  const html =
    head +
    row('1.tif.gz', '1.tif.gz', '68938', '2024-08-28 19:02:41 +0000 UTC') +
    row('10.tif.gz', '10.tif.gz', '73944', '2024-08-28 19:02:41 +0000 UTC') +
    row('100.tif.gz', '100.tif.gz', '114804', '2024-08-28 19:02:41 +0000 UTC') +
    tail
  assert.deepEqual(parseListing(html), [
    { name: '1.tif.gz', bytes: 68938 },
    { name: '10.tif.gz', bytes: 73944 },
    { name: '100.tif.gz', bytes: 114804 },
  ])
})

void test('the header row and the subfolders are skipped', () => {
  const html =
    head +
    row('PD-tiff/index.html', 'PD-tiff/', '-', '-') +
    row('T2_512-tiff/index.html', 'T2_512-tiff/', '-', '-') +
    row('101.tif.gz', '101.tif.gz', '115146', '2024-08-28 19:02:51 +0000 UTC') +
    tail
  assert.deepEqual(parseListing(html), [{ name: '101.tif.gz', bytes: 115146 }])
})

void test('a name with character references is decoded', () => {
  const html =
    head +
    row('a&amp;b%20c.png', 'a&amp;b c&#39;s &#x2013; d.png', '42', '2024-08-28 19:02:41 +0000 UTC') +
    row('0.png', 'a &unknown; e.png', '0', '2024-08-28 19:02:41 +0000 UTC') +
    tail
  assert.deepEqual(parseListing(html), [
    { name: "a&b c's – d.png", bytes: 42 },
    { name: 'a &unknown; e.png', bytes: 0 },
  ])
})

void test('a file whose size cell holds no number has no size', () => {
  const html = head + row('x.png', 'x.png', '1.2 MB', '2024-08-28 19:02:41 +0000 UTC') + tail
  assert.deepEqual(parseListing(html), [{ name: 'x.png', bytes: null }])
})

void test('a page with no table lists nothing', () => {
  assert.deepEqual(parseListing('<html><body><h1>404 Not Found</h1></body></html>'), [])
})

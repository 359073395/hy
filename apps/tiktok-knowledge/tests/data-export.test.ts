import assert from 'node:assert/strict';
import { test } from 'node:test';
import { rowsToCsv } from '../src/lib/data-export';

test('CSV preserves Unicode, nested data, quotes and line breaks', () => {
  const csv = rowsToCsv([{ name: '张三,"四"\n五', score: 100, answers: { a: 'yes' }, empty: null }], ['name', 'score', 'answers', 'empty']);
  assert.ok(csv.startsWith('\uFEFF'));
  assert.match(csv, /"张三,""四""\n五"/);
  assert.match(csv, /"\{""a"":""yes""\}"/);
  assert.ok(csv.endsWith(',""\r\n'));
});

test('CSV neutralizes spreadsheet formulas in text fields', () => {
  const rows = ['=1+1', '+SUM(1)', '-1+1', '@SUM(1)', '\t =1+1'].map((name) => ({ name }));
  const csv = rowsToCsv(rows, ['name']);
  for (const row of rows) assert.ok(csv.includes(`"'${row.name}"`));
  assert.equal(rowsToCsv([{ value: -5 }], ['value']), '\uFEFF"value"\r\n"-5"\r\n');
});

test('CSV retains field names for empty datasets', () => {
  assert.equal(rowsToCsv([], ['id', 'name']), '\uFEFF"id","name"\r\n');
});

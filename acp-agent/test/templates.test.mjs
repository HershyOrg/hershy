import test from 'node:test';
import assert from 'node:assert/strict';

import { listTemplates, loadTemplate } from '../src/templates.mjs';

test('listTemplates includes simple-counter', () => {
  const templates = listTemplates();
  assert.ok(templates.some((template) => template.name === 'simple-counter'));
});

test('loadTemplate reads simple-counter sources', async () => {
  const template = await loadTemplate('simple-counter');

  assert.equal(template.template_name, 'simple-counter');
  assert.ok(template.dockerfile.includes('FROM'));
  assert.ok(template.src_files['main.go'].includes('package main'));
  assert.ok(template.src_files['go.mod'].includes('module'));
});

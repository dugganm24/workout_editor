#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SOURCE = 'https://connect.garmin.com/web-data/exercises/Exercises.json';
const dest = fileURLToPath(new URL('../src/exercises/connect-exercises.json', import.meta.url));

const response = await fetch(SOURCE);
if (!response.ok) throw new Error(`${SOURCE} -> ${response.status}`);
const data = await response.json();
if (!data?.categories || typeof data.categories !== 'object') {
  throw new Error('Exercises.json: missing categories');
}

/** @type {Record<string, string[]>} */
const catalog = {};
for (const key of Object.keys(data.categories).sort()) {
  const exercises = data.categories[key]?.exercises;
  if (!exercises || typeof exercises !== 'object') {
    throw new Error(`Exercises.json: ${key} has no exercises map`);
  }
  catalog[key] = Object.keys(exercises).sort();
}

writeFileSync(dest, `${JSON.stringify(catalog, null, 2)}\n`);
const count = Object.values(catalog).reduce((n, names) => n + names.length, 0);
console.log(`Wrote ${Object.keys(catalog).length} categories, ${count} exercises -> ${dest}`);

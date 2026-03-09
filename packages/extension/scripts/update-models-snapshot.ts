#!/usr/bin/env bun

import { writeFile } from "node:fs/promises";
import path from "node:path";
import { parseModelsDevSnapshotText } from "../lib/runtime/models-dev-schema";

const MODELS_URL = process.env.MODELS_DEV_URL ?? "https://models.dev/api.json";
const OUTFILE = path.join(process.cwd(), "lib/runtime/models-snapshot.json");

const response = await fetch(MODELS_URL, {
  headers: {
    Accept: "application/json",
  },
});

if (!response.ok) {
  throw new Error(`Failed to fetch models.dev snapshot: ${response.status}`);
}

const text = await response.text();
const snapshot = parseModelsDevSnapshotText(text);
await writeFile(OUTFILE, `${JSON.stringify(snapshot, null, 2)}\n`);
console.log(`Updated ${OUTFILE}`);

#!/usr/bin/env bun

import path from "node:path"
import { MODELS_DEV_API_URL } from "../lib/runtime/constants"

const MODELS_URL = process.env.MODELS_DEV_URL ?? MODELS_DEV_API_URL
const OUTFILE = path.join(process.cwd(), "lib/runtime/models-snapshot.json")

const response = await fetch(MODELS_URL, {
  headers: {
    Accept: "application/json",
  },
})

if (!response.ok) {
  throw new Error(`Failed to fetch models.dev snapshot: ${response.status}`)
}

const text = await response.text()
JSON.parse(text)
await Bun.write(OUTFILE, `${text}\n`)
console.log(`Updated ${OUTFILE}`)

import Dexie, { type Table, type Transaction } from "dexie"
import { runtimeDb } from "@/lib/runtime/db/runtime-db"

type TxMode = "r" | "rw"
type TxEffect = () => void | Promise<void>

const effectsByTransaction = new WeakMap<Transaction, TxEffect[]>()

export function afterCommit(effect: TxEffect) {
  const transaction = Dexie.currentTransaction
  if (!transaction) {
    throw new Error("afterCommit must be called inside runTx")
  }

  const effects = effectsByTransaction.get(transaction) ?? []
  effects.push(effect)
  effectsByTransaction.set(transaction, effects)
}

export async function runTx<T>(
  mode: TxMode,
  tables: Array<Table>,
  fn: () => Promise<T> | T,
): Promise<T>
export async function runTx<T>(
  tables: Array<Table>,
  fn: () => Promise<T> | T,
): Promise<T>
export async function runTx<T>(
  modeOrTables: TxMode | Array<Table>,
  maybeTablesOrFn:
    | Array<Table>
    | (() => Promise<T> | T),
  maybeFn?: () => Promise<T> | T,
): Promise<T> {
  const mode: TxMode = Array.isArray(modeOrTables) ? "rw" : modeOrTables
  const tables = Array.isArray(modeOrTables)
    ? modeOrTables
    : (maybeTablesOrFn as Array<Table>)
  const fn = (Array.isArray(modeOrTables) ? maybeTablesOrFn : maybeFn) as () =>
    | Promise<T>
    | T

  let transactionRef: Transaction | undefined

  const result = await runtimeDb.transaction(mode, tables, async () => {
    const transaction = Dexie.currentTransaction
    if (!transaction) throw new Error("Dexie transaction unavailable")

    transactionRef = transaction
    effectsByTransaction.set(transaction, [])

    return fn()
  })

  if (!transactionRef) return result

  const effects = effectsByTransaction.get(transactionRef) ?? []
  effectsByTransaction.delete(transactionRef)

  for (const effect of effects) {
    await effect()
  }

  return result
}

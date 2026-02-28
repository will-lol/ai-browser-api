import { refreshProviderCatalog, refreshProviderCatalogForProvider } from "@/lib/runtime/provider-registry"

export async function refreshCatalog() {
  return refreshProviderCatalog()
}

export async function refreshCatalogForProvider(providerID: string) {
  return refreshProviderCatalogForProvider(providerID)
}

export function accountStorageKey(accountId: string, key: string) {
  return `abn-guard-account-${encodeURIComponent(accountId)}-${key}-v1`;
}

export function accountFileKey(accountId: string, fileId: string) {
  return `${encodeURIComponent(accountId)}:${fileId}`;
}

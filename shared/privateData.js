// Host-owned mutable state must never become gameplay data or part of a client content set.
export const PRIVATE_DATA_FILES = Object.freeze(['admin-accounts.json','admin-flags.json','bans.json','ledger.json','device-accounts.json','avatar-registry.json','avatar-grants.json','avatar-review.json','namecard-review.json']);

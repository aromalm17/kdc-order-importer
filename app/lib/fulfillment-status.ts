const completedStatuses = new Set(["fulfilled", "fulfiled"]);

const normalizedIncompleteStatuses = new Map([
  ["unfulfilled", "Unfulfilled"],
  ["unfulfiled", "Unfulfilled"],
  ["unfullfilled", "Unfulfilled"],
  ["notfulfilled", "Unfulfilled"],
  ["partial", "Partially fulfilled"],
  ["partiallyfulfilled", "Partially fulfilled"],
  ["pending", "Pending"],
  ["open", "Open"],
  ["onhold", "On hold"],
  ["scheduled", "Scheduled"],
]);

function canonicalStatus(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export function normalizeFulfillmentStatus(value?: string | null) {
  const raw = value?.trim() ?? "";
  if (!raw) return "Fulfilled";

  const canonical = canonicalStatus(raw);
  if (completedStatuses.has(canonical)) return "Fulfilled";
  return normalizedIncompleteStatuses.get(canonical) ?? raw;
}

export function isCompletedFulfillmentStatus(value?: string | null) {
  return normalizeFulfillmentStatus(value) === "Fulfilled";
}

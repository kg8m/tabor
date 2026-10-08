/**
 * Formats a timestamp for display, e.g. “2026/09/27 (Sun) 14:05”.
 */
export function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const weekday = new Intl.DateTimeFormat("en-US", { weekday: "short" }).format(
    date,
  );
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${year}/${month}/${day} (${weekday}) ${hours}:${minutes}`;
}

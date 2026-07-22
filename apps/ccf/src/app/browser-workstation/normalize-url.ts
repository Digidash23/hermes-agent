export function normalizeUrlOrSearch(input: string): string {
  const trimmed = input.trim()

  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return trimmed
  }

  return trimmed.includes('.') && !trimmed.includes(' ')
    ? `https://${trimmed}`
    : `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`
}

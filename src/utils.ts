export function greet(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) {
    return "Hello, Guest!";
  }
  return `Hello, ${trimmed}!`;
}

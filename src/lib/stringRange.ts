export type StringRange = {
  start: number;
  end: number;
};

export function removeStringRange(input: string, range: StringRange): string {
  if (range.start < 0 || range.end < range.start || range.end > input.length) {
    throw new RangeError(`Invalid string range: ${range.start}-${range.end}`);
  }

  return input.slice(0, range.start) + input.slice(range.end);
}

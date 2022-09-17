/* Jovian (c) 2020, License: MIT */

export function lines(...linesArray: string[]): string {
  return linesArray.join('\n');
}

export function linesList(linesString: string): string[] {
  return linesString.split('\n');
}

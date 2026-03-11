const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const MID_CHAR = ALPHABET[Math.floor(ALPHABET.length / 2)] as string;

export function generateInitialRank(): string {
  return MID_CHAR;
}

export function generateRankBetween(before: string | null, after: string | null): string {
  if (!before && !after) {
    return MID_CHAR;
  }

  if (!before) {
    return decrementRank(after as string);
  }

  if (!after) {
    return incrementRank(before);
  }

  return midpoint(before, after);
}

function incrementRank(rank: string): string {
  const chars = rank.split("");
  let i = chars.length - 1;

  while (i >= 0) {
    const char = chars[i] as string;
    const idx = ALPHABET.indexOf(char);
    if (idx < ALPHABET.length - 1) {
      chars[i] = ALPHABET[idx + 1] as string;
      return chars.join("");
    }
    chars[i] = ALPHABET[0] as string;
    i--;
  }

  return (ALPHABET[0] as string) + rank.split("").map(() => ALPHABET[ALPHABET.length - 1] as string).join("");
}

function decrementRank(rank: string): string {
  const chars = rank.split("");
  let i = chars.length - 1;

  while (i >= 0) {
    const char = chars[i] as string;
    const idx = ALPHABET.indexOf(char);
    if (idx > 0) {
      chars[i] = ALPHABET[idx - 1] as string;
      return chars.join("");
    }
    chars[i] = ALPHABET[ALPHABET.length - 1] as string;
    i--;
  }

  return (ALPHABET[ALPHABET.length - 1] as string) + rank.split("").map(() => ALPHABET[0] as string).join("");
}

function midpoint(a: string, b: string): string {
  const maxLen = Math.max(a.length, b.length);
  const paddedA = a.padEnd(maxLen, ALPHABET[0] as string);
  const paddedB = b.padEnd(maxLen, ALPHABET[0] as string);

  let result = "";
  let carry = 0;

  for (let i = maxLen - 1; i >= 0; i--) {
    const aChar = paddedA[i] as string;
    const bChar = paddedB[i] as string;
    const aIdx = ALPHABET.indexOf(aChar);
    const bIdx = ALPHABET.indexOf(bChar);
    const sum = aIdx + bIdx + carry;
    const mid = Math.floor(sum / 2);
    carry = sum % 2;
    result = (ALPHABET[mid] as string) + result;
  }

  if (result === a) {
    return a + MID_CHAR;
  }

  return result;
}

export function sortByRank<T extends { kanbanRank?: string | null }>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const rankA = a.kanbanRank ?? "";
    const rankB = b.kanbanRank ?? "";
    if (!rankA && !rankB) return 0;
    if (!rankA) return 1;
    if (!rankB) return -1;
    return rankA.localeCompare(rankB);
  });
}

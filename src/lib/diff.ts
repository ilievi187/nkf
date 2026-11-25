export type DiffKind = "same" | "added" | "removed" | "modified";

export interface DiffRow {
  leftNum: number | null;
  rightNum: number | null;
  leftText: string;
  rightText: string;
  kind: DiffKind;
}

export interface DiffResult {
  rows: DiffRow[];
  added: number;
  removed: number;
  modified: number;
}

/**
 * Fast Myers/LCS-inspired line diff for side-by-side & unified viewing.
 * Falls back to line-by-line comparison for very large files (>2500 lines) to stay 60 FPS.
 */
export function computeLineDiff(leftContent: string, rightContent: string): DiffResult {
  const a = leftContent.split("\n");
  const b = rightContent.split("\n");
  const m = a.length;
  const n = b.length;

  // Fast linear fallback for huge files
  if (m * n > 2_000_000) {
    const maxLen = Math.max(m, n);
    const rows: DiffRow[] = [];
    let added = 0;
    let removed = 0;
    let modified = 0;
    for (let i = 0; i < maxLen; i++) {
      const hasL = i < m;
      const hasR = i < n;
      const lt = hasL ? a[i] : "";
      const rt = hasR ? b[i] : "";
      let kind: DiffKind = "same";
      if (hasL && !hasR) {
        kind = "removed";
        removed++;
      } else if (!hasL && hasR) {
        kind = "added";
        added++;
      } else if (lt !== rt) {
        kind = "modified";
        modified++;
      }
      rows.push({
        leftNum: hasL ? i + 1 : null,
        rightNum: hasR ? i + 1 : null,
        leftText: lt,
        rightText: rt,
        kind,
      });
    }
    return { rows, added, removed, modified };
  }

  // Standard LCS DP table
  const dp: Uint32Array[] = Array.from({ length: m + 1 }, () => new Uint32Array(n + 1));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      if (a[i] === b[j]) {
        dp[i][j] = dp[i + 1][j + 1] + 1;
      } else {
        dp[i][j] = dp[i + 1][j] >= dp[i][j + 1] ? dp[i + 1][j] : dp[i][j + 1];
      }
    }
  }

  const raw: DiffRow[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      raw.push({ leftNum: i + 1, rightNum: j + 1, leftText: a[i], rightText: b[j], kind: "same" });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      raw.push({ leftNum: i + 1, rightNum: null, leftText: a[i], rightText: "", kind: "removed" });
      i++;
    } else {
      raw.push({ leftNum: null, rightNum: j + 1, leftText: "", rightText: b[j], kind: "added" });
      j++;
    }
  }
  while (i < m) {
    raw.push({ leftNum: i + 1, rightNum: null, leftText: a[i], rightText: "", kind: "removed" });
    i++;
  }
  while (j < n) {
    raw.push({ leftNum: null, rightNum: j + 1, leftText: "", rightText: b[j], kind: "added" });
    j++;
  }

  // Pair adjacent removed + added rows into clean "modified" rows
  const rows: DiffRow[] = [];
  let added = 0;
  let removed = 0;
  let modified = 0;

  let k = 0;
  while (k < raw.length) {
    if (raw[k].kind === "removed" && k + 1 < raw.length && raw[k + 1].kind === "added") {
      rows.push({
        leftNum: raw[k].leftNum,
        rightNum: raw[k + 1].rightNum,
        leftText: raw[k].leftText,
        rightText: raw[k + 1].rightText,
        kind: "modified",
      });
      modified++;
      k += 2;
    } else {
      if (raw[k].kind === "added") added++;
      else if (raw[k].kind === "removed") removed++;
      rows.push(raw[k]);
      k++;
    }
  }

  return { rows, added, removed, modified };
}

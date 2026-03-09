export async function navigateFromDisassemblyOperand(
  sourceVa: string,
  targetVa: string,
  pushSelectionHistory: (va: string) => void,
  navigateToVa: (va: string) => Promise<boolean>,
): Promise<boolean> {
  pushSelectionHistory(sourceVa);
  return navigateToVa(targetVa);
}

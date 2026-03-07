export function toFunctionProvenanceCode(kind: string): string {
  switch (kind) {
    case "pdb":
      return "pdb";
    case "exception":
      return "exc";
    case "import":
      return "imp";
    case "export":
      return "exp";
    case "tls":
      return "tls";
    case "entry":
      return "ent";
    case "call":
      return "jmp";
    default:
      return kind.slice(0, 3).toLowerCase();
  }
}

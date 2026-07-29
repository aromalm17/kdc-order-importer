export const XLSX_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function sanitizeFilename(value: string, fallback: string) {
  const sanitized = Array.from(value, (character) => {
    const code = character.charCodeAt(0);
    return code < 32 ||
      code === 127 ||
      character === "/" ||
      character === "\\"
      ? "-"
      : character;
  })
    .join("")
    .replace(/-+/g, "-")
    .trim();
  return sanitized || fallback;
}

export function getAttachmentFilename(
  contentDisposition: string | null,
  fallback: string,
) {
  if (!contentDisposition) return fallback;

  const encodedMatch = contentDisposition.match(
    /filename\*\s*=\s*UTF-8''([^;]+)/i,
  );
  if (encodedMatch?.[1]) {
    try {
      return sanitizeFilename(decodeURIComponent(encodedMatch[1]), fallback);
    } catch {
      return fallback;
    }
  }

  const quotedMatch = contentDisposition.match(/filename\s*=\s*"([^"]+)"/i);
  if (quotedMatch?.[1]) {
    return sanitizeFilename(quotedMatch[1], fallback);
  }

  const plainMatch = contentDisposition.match(/filename\s*=\s*([^;]+)/i);
  return plainMatch?.[1]
    ? sanitizeFilename(plainMatch[1], fallback)
    : fallback;
}

export function isExcelResponse(contentType: string | null) {
  return (
    contentType?.toLowerCase().startsWith(XLSX_CONTENT_TYPE.toLowerCase()) ??
    false
  );
}

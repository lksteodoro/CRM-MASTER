export const INFOBIP_MEDIA_LIMIT_BYTES = 16 * 1024 * 1024;

type MediaKind = 'profile_photo' | 'image' | 'video' | 'contact_list';

export function validateMediaType(kind: MediaKind, file: File) {
  if ((kind === 'profile_photo' || kind === 'image') && !file.type.startsWith('image/')) {
    throw new Error('Selecione um arquivo de imagem válido.');
  }
  if (kind === 'video' && !file.type.startsWith('video/')) {
    throw new Error('Selecione um arquivo de vídeo válido.');
  }
  if (kind === 'contact_list') {
    const extension = file.name.split('.').pop()?.toLowerCase();
    if (!extension || !['csv', 'txt', 'xls', 'xlsx', 'zip'].includes(extension)) {
      throw new Error('A lista deve estar em CSV, TXT, XLS, XLSX ou ZIP.');
    }
  }
}

const OUTPUT_IMAGE_TYPE = 'image/jpeg';

function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Não foi possível processar a imagem.'))),
      OUTPUT_IMAGE_TYPE,
      quality
    );
  });
}

function drawImage(bitmap: ImageBitmap, width: number, height: number, square: boolean) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Não foi possível processar a imagem.');

  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);

  if (square) {
    // Exibe a imagem inteira dentro do quadrado. As bordas restantes recebem
    // fundo branco, evitando cortar rostos, logotipos ou textos.
    const scale = Math.min(width / bitmap.width, height / bitmap.height);
    const renderedWidth = bitmap.width * scale;
    const renderedHeight = bitmap.height * scale;
    context.drawImage(
      bitmap,
      (width - renderedWidth) / 2,
      (height - renderedHeight) / 2,
      renderedWidth,
      renderedHeight
    );
  } else {
    context.drawImage(bitmap, 0, 0, width, height);
  }

  return canvas;
}

/** Reduz a foto inteira para caber em um JPEG de 600×600, sem recortar. */
export async function prepareProfilePhoto(file: File): Promise<File> {
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = drawImage(bitmap, 600, 600, true);
    const blob = await canvasToBlob(canvas, 0.9);
    return new File([blob], 'foto-perfil-600x600.jpg', { type: OUTPUT_IMAGE_TYPE });
  } finally {
    bitmap.close();
  }
}

/**
 * Mantém imagens que já cabem no limite. Para imagens maiores, reduz dimensões
 * e qualidade progressivamente até gerar um JPEG aceito pela Infobip.
 */
export async function prepareCampaignImage(file: File): Promise<File> {
  if (file.size <= INFOBIP_MEDIA_LIMIT_BYTES) return file;

  const bitmap = await createImageBitmap(file);
  try {
    const initialScale = Math.min(1, 4096 / Math.max(bitmap.width, bitmap.height));
    let width = bitmap.width * initialScale;
    let height = bitmap.height * initialScale;
    let quality = 0.88;

    for (let attempt = 0; attempt < 10; attempt += 1) {
      const canvas = drawImage(bitmap, Math.max(1, Math.round(width)), Math.max(1, Math.round(height)), false);
      const blob = await canvasToBlob(canvas, quality);
      if (blob.size <= INFOBIP_MEDIA_LIMIT_BYTES) {
        const baseName = file.name.replace(/\.[^.]+$/, '') || 'imagem';
        return new File([blob], `${baseName}-otimizada.jpg`, { type: OUTPUT_IMAGE_TYPE });
      }
      width *= 0.82;
      height *= 0.82;
      quality = Math.max(0.55, quality - 0.06);
    }
  } finally {
    bitmap.close();
  }

  throw new Error('Não foi possível reduzir a imagem para menos de 16 MB. Escolha uma imagem menor.');
}

export function ensureWithinInfobipLimit(file: File) {
  if (file.size > INFOBIP_MEDIA_LIMIT_BYTES) {
    throw new Error(
      `O arquivo tem ${(file.size / 1024 / 1024).toFixed(1)} MB. Vídeos e listas devem ter no máximo 16 MB.`
    );
  }
}

export function formatFileSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

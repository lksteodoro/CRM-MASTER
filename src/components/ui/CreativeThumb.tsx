import { Image, Video, GalleryHorizontal } from 'lucide-react';

const creativeIcon = { Imagem: Image, Vídeo: Video, Carrossel: GalleryHorizontal };

function hueFromId(id: string) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (Math.imul(31, h) + id.charCodeAt(i)) | 0;
  return Math.abs(h) % 360;
}

// Deterministic placeholder swatch standing in for the real Meta creative
// thumbnail (not available without the Ads API). Pass `imageUrl` once that
// integration exists and this renders the real image instead.
export function CreativeThumb({
  id,
  creativeType,
  imageUrl,
  size = 40,
}: {
  id: string;
  creativeType: keyof typeof creativeIcon;
  imageUrl?: string;
  size?: number;
}) {
  if (imageUrl) {
    return (
      <img
        src={imageUrl}
        alt=""
        width={size}
        height={size}
        className="shrink-0 rounded-lg object-cover"
        style={{ width: size, height: size }}
      />
    );
  }

  const hue = hueFromId(id);
  const Icon = creativeIcon[creativeType];

  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-lg"
      style={{
        width: size,
        height: size,
        background: `linear-gradient(135deg, hsl(${hue},55%,32%), hsl(${(hue + 45) % 360},55%,20%))`,
      }}
    >
      <Icon size={Math.round(size * 0.42)} className="text-white/85" />
    </div>
  );
}

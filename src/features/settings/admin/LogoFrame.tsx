import { useTranslation } from 'react-i18next';
import { PictureFrame } from '../../../components/PictureFrame';
import { MarkForm } from '../../../components/ProjectTile';
import { LOGO_PLATE } from '../../../components/SubCompanyLogo';
import { markGlow } from '../../../lib/projectMark';
import type { PictureCrop } from '../../../lib/picture';

/** The sizes of the preview circles: the badge of a small tile, and two larger places. */
const PREVIEW_SIZES = [18, 22, 28] as const;

/**
 * The frame step of a new logo (PRJ-11, 2026-10-19). The Admin drags the picture inside a circle and zooms with a slider, so the
 * mark fills the circle. A row below shows the logo at the sizes of the lists, beside a sample project tile, so the Admin sees before
 * Save what everyone will see. The parent saves the picture again from the crop. The frame itself is the shared PictureFrame, which
 * the profile picture uses too (fbk_029).
 */
export function LogoFrame({ file, crop, onCrop }: { file: File; crop: PictureCrop; onCrop: (crop: PictureCrop) => void }) {
  const { t } = useTranslation();
  return (
    <PictureFrame
      file={file}
      crop={crop}
      onCrop={onCrop}
      plate={LOGO_PLATE}
      words={{ group: t('subCompanies.frame'), hint: t('subCompanies.frameHint'), zoom: t('subCompanies.zoom'), preview: t('subCompanies.preview') }}
      previews={(circle) => (
        <>
          {/* A sample project tile with the badge at its real place and size. */}
          <span className="relative inline-flex shrink-0" style={{ width: 34, height: 34 }} aria-hidden>
            <span style={{ width: 34, height: 34, background: markGlow('prj_000', 3) }} className="grid place-items-center rounded-[30%] ring-1 ring-inset ring-ink/10">
              <MarkForm mark={3} className="size-[45%]" />
            </span>
            <span style={{ insetBlockEnd: -9, insetInlineEnd: -9, boxShadow: '0 0 0 2px var(--c-panel)' }} className="absolute rounded-full">
              {circle(PREVIEW_SIZES[0])}
            </span>
          </span>
          {PREVIEW_SIZES.slice(1).map((side) => circle(side))}
        </>
      )}
    />
  );
}

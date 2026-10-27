import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { UserCard } from '../../api/contract/views';
import { glowOf } from '../../components/Avatar';
import { Button } from '../../components/Button';
import { PictureFrame } from '../../components/PictureFrame';
import { Sheet } from '../../components/Sheet';
import { DEFAULT_CROP, PictureError, pictureOf, type PictureCrop } from '../../lib/picture';
import { FormError } from '../auth/AuthPage';

/** The sizes of the preview circles: the picture in Settings, the header of a chat, and the bubbles and small lists. */
const AVATAR_SIZES = [72, 40, 24] as const;

/**
 * The frame step of the profile picture (fbk_029, owner 2026-10-23: "allow to change the crop, zoom in zoom out when upload a new
 * profile picture"). The person drags the picture inside a round frame and zooms with a slider; a row shows the picture round at the
 * sizes where it appears. Save makes the 128 px picture from that frame (pictureOf with the crop) and hands it to the parent, which saves
 * it. It is the same frame as the logo of a sub-company (PictureFrame). The frame starts as the centre square, as the picture always
 * was, so a person who only presses Save gets what they got before. The glow of the person shows through the see-through parts.
 */
export function AvatarFrameSheet({ file, user, onCancel, onSave, onUnreadable, saving }: {
  file: File;
  user: Pick<UserCard, 'id'>;
  onCancel: () => void;
  /** The picture, made from the frame. The parent saves it and closes the step. */
  onSave: (picture: string) => void;
  /** The browser could not load the picture at all. */
  onUnreadable: () => void;
  saving: boolean;
}) {
  const { t } = useTranslation();
  const [crop, setCrop] = useState<PictureCrop>(DEFAULT_CROP);
  const [making, setMaking] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const save = async () => {
    setProblem(null);
    setMaking(true);
    try {
      onSave(await pictureOf(file, { crop }));
    } catch (error) {
      setProblem(t(error instanceof PictureError && error.reason === 'too_big' ? 'profile.pictureTooBig' : 'profile.pictureUnreadable'));
    } finally {
      setMaking(false);
    }
  };
  return (
    <Sheet
      open
      onOpenChange={(open) => { if (!open) onCancel(); }}
      title={t('profile.frame')}
      footer={(
        <>
          <Button onClick={onCancel}>{t('common.cancel')}</Button>
          <Button variant="primary" disabled={making || saving} onClick={() => void save()}>{t('settings.save')}</Button>
        </>
      )}
    >
      <div className="flex flex-col gap-4 pt-1">
        <PictureFrame
          file={file}
          crop={crop}
          onCrop={setCrop}
          start="fill"
          plate={glowOf(user.id)}
          words={{ group: t('profile.frame'), hint: t('profile.frameHint'), zoom: t('profile.zoom'), preview: t('profile.preview') }}
          previews={(circle) => AVATAR_SIZES.map((side) => circle(side))}
          onUnreadable={onUnreadable}
        />
        <FormError text={problem} />
      </div>
    </Sheet>
  );
}

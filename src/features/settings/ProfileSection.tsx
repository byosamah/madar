import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { User } from '../../api/contract/entities';
import { useUndoable } from '../../app/actions';
import { fieldError } from '../../app/errors';
import { useAction } from '../../app/runtime';
import { useToast } from '../../app/toasts';
import { Avatar } from '../../components/Avatar';
import { Button } from '../../components/Button';
import { TextField } from '../../components/Fields';
import { safePicture } from '../../lib/picture';
import { FormError } from '../auth/AuthPage';
import { AvatarFrameSheet } from './AvatarFrameSheet';


/**
 * The profile area at the top of Settings (owner items 10 and 12, 2026-10-05): the picture, and the names in English and in
 * Arabic. A new picture first gets a frame step (fbk_029): the person drags and zooms it inside a round frame, then Save makes the small picture
 * from that frame (lib/picture.ts) and saves it, with Undo in the toast.
 */
export function ProfileSection({ user }: { user: User }) {
  const { t } = useTranslation();
  const toast = useToast();
  const profile = useAction('me.updateProfile', { onSuccess: () => toast.show({ message: t('settings.saved') }) });
  const picture = useUndoable('me.updateProfile', {
    message: (saved) => t(saved.avatarUrl ? 'profile.pictureSaved' : 'profile.pictureRemoved'),
    onSuccess: () => setFraming(null),
  });
  const fileRef = useRef<HTMLInputElement>(null);
  // The file just chosen, while the frame step is open.
  const [framing, setFraming] = useState<File | null>(null);
  const [pictureProblem, setPictureProblem] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [nameAr, setNameAr] = useState('');
  const [discipline, setDiscipline] = useState('');

  useEffect(() => {
    setName(user.name);
    setNameAr(user.nameAr ?? '');
    setDiscipline(user.discipline);
  }, [user.id, user.name, user.nameAr, user.discipline]);

  const hasPicture = safePicture(user.avatarUrl) !== null;
  const busy = picture.isPending;

  const choose = (file: File | undefined) => {
    // The same file can be chosen again after a Cancel.
    if (fileRef.current) fileRef.current.value = '';
    if (!file) return;
    setPictureProblem(null);
    setFraming(file);
  };

  return (
    <section aria-labelledby="settings-profile" className="panel flex flex-col gap-4 p-5">
      <h2 id="settings-profile" className="text-section text-ink">{t('settings.profile')}</h2>
      <div className="flex items-center gap-4">
        <Avatar user={user} size={72} />
        <div className="flex min-w-0 flex-col items-start gap-2">
          <span className="max-w-full truncate text-footnote text-label-2"><bdi>{user.email}</bdi></span>
          <div className="flex flex-wrap gap-2">
            <Button disabled={busy} onClick={() => fileRef.current?.click()}>
              {t(hasPicture ? 'profile.changePicture' : 'profile.addPicture')}
            </Button>
            {hasPicture && (
              <Button variant="plain" disabled={busy} onClick={() => { setPictureProblem(null); picture.mutate({ avatarUrl: null }); }}>
                {t('profile.removePicture')}
              </Button>
            )}
          </div>
          <p className="text-footnote text-label-2 text-pretty">{t('profile.seeThroughHint')}</p>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/*"
          aria-label={t('profile.choosePicture')}
          tabIndex={-1}
          className="sr-only"
          onChange={(event) => choose(event.target.files?.[0])}
        />
      </div>
      <FormError text={pictureProblem} />
      {framing && (
        <AvatarFrameSheet
          file={framing}
          user={user}
          saving={picture.isPending}
          onCancel={() => setFraming(null)}
          onSave={(avatarUrl) => picture.mutate({ avatarUrl })}
          onUnreadable={() => {
            setFraming(null);
            setPictureProblem(t('profile.pictureUnreadable'));
          }}
        />
      )}
      <form
        className="grid gap-3 sm:grid-cols-2 sm:items-end"
        onSubmit={(event) => {
          event.preventDefault();
          // An Arabic name that did not change stays out, so a save with no change records nothing.
          const arabic = nameAr.trim() === (user.nameAr ?? '') ? {} : { nameAr };
          profile.mutate({ name, discipline, ...arabic });
        }}
      >
        {/* A refused field shows its message under it, as in the Admin forms (audit 2026-10-03, SHL-22). */}
        <TextField
          id="profile-name"
          label={t('profile.nameEn')}
          required
          value={name}
          dir="auto"
          autoComplete="name"
          error={fieldError(profile.error, 'name', t, t('admin.errors.name'))}
          onChange={(event) => setName(event.target.value)}
        />
        <TextField
          id="profile-name-ar"
          label={t('profile.nameAr')}
          value={nameAr}
          dir="auto"
          lang="ar"
          error={fieldError(profile.error, 'nameAr', t, t('profile.errors.nameAr'))}
          onChange={(event) => setNameAr(event.target.value)}
        />
        <TextField
          id="profile-discipline"
          label={t('settings.discipline')}
          value={discipline}
          dir="auto"
          error={fieldError(profile.error, 'discipline', t, t('admin.errors.discipline'))}
          onChange={(event) => setDiscipline(event.target.value)}
        />
        <div>
          <Button type="submit" disabled={profile.isPending}>{t('settings.save')}</Button>
        </div>
      </form>
    </section>
  );
}

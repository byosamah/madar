# Enterprise parts shared by the companies' app and the platform site

Madar enterprises is a separate site now (design 12, D7). The page of the platform moved to `src/platform/` (read `src/platform/CLAUDE.md`). Three
small files stay here, because the Admin of a company uses them too (the name, the logo and the limits of its own company in Settings, Admin):
- `EnterpriseLogo.tsx`: the logo in a round plate, or the first letter of the name.
- `LogoPicker.tsx`: one picture that fits inside the plate (`lib/picture.ts`, fit contain).
- `limits.ts`: gigabytes and bytes, the people limit, `hasStatus`.

Rule: these files import no runtime, no route and no company screen, so the platform site can import them (`src/platform/imports.test.ts`).
They hold no platform call. The companies' app holds no platform part (root guide, design 12, D9).

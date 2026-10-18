import type { ReportDesign } from './contract/views';

/**
 * The design guide of the office report (owner, 2026-10-18, fbk_016). reports.office gives it to every person who may ask, and the
 * agent builds the document from it. reportDesign.test.ts checks each color and size against src/design/tokens.css. The mark is a
 * copy of MADAR_DOORS (src/components/MadarMark.tsx), because src/api imports no component.
 *
 * The brand font is Thmanyah Sans. Its licence allows no copy outside the built product, so a document uses the free fallback.
 */
export const REPORT_DESIGN: ReportDesign = {
  brand: {
    name: 'Madar',
    nameAr: 'مدار',
    mark: {
      viewBox: '0 0 18 18',
      path: 'M8 0H0A8 8 0 0 0 8 8Z M18 8V0A8 8 0 0 0 10 8Z M10 18H18A8 8 0 0 0 10 10Z M0 10V18A8 8 0 0 0 8 10Z',
    },
  },
  page: { background: '#FFFFFF', margin: '20mm' },
  colors: {
    ink: '#1D1D1F',
    inkSecondary: '#636366',
    hairline: '#F0F0F2',
    accent: '#1F2A55',
  },
  type: {
    family: 'Thmanyah Sans',
    fallback: 'IBM Plex Sans Arabic, then the system sans-serif',
    sizes: { title: '24px', heading: '19px', body: '15px', caption: '12px' },
  },
  rules: [
    'Use a white page only. Do not add a background color or a picture to the page.',
    'Use the ink colors for all text. Use the accent color for one main figure or one heading only.',
    'Align the numbers of each column, so that the digits line up.',
    'Write Arabic from right to left. Set the layout with the start and end sides, never left and right.',
    'Use short labels of two to four words. Put the unit in the label, for example "Received (SAR)".',
    'Draw a chart only for a trend over time. Use a table for all other numbers.',
    'Show money only when the report has a money part. Never estimate a missing amount.',
    'Put the brand mark at the top start of the first page, with the name Madar or مدار.',
    'Use the fallback font in every document. The brand font works only inside Madar.',
    'Never use a long dash in any text: no em-dash and no en-dash.',
  ],
};

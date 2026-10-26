import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { heldRightsOfRole } from '../../../api/rights';
import { BASIC_ON, CATALOG_RIGHT_IDS, expandRights, withNeeds } from '../../../api/rightsCatalog';
import type { State } from '../../../api/store';
import { renderApp } from '../../../test/render';
import { SHEET_SECTIONS } from './roleSheetLogic';

/**
 * Two custom roles saved before role rights version 2 (no `off`): Cashier (rol_001, held by Omar Haddad, a Member) with the old right
 * payment.manage, and Planner (rol_002, held by nobody) with people.manage. Such a role holds the Member switches and its own, so
 * Cashier holds 66 + 4 = 70 and Planner holds 66 + 5 = 71. Turki Al-Otaibi (usr_010) is the Management person of the sample office.
 */
function withRoles(state: State) {
  state.settings.roles = {
    custom: [
      { id: 'rol_001', name: 'Cashier', nameAr: 'أمين الصندوق', rights: ['payment.manage'] },
      { id: 'rol_002', name: 'Planner', nameAr: 'المخطط', rights: ['people.manage'] },
    ],
  };
  state.counters.rol = 2;
  for (const user of Object.values(state.users)) delete user.roleId;
  state.users.usr_004.roleId = 'rol_001';
}

const roles = () => screen.findByRole('region', { name: 'Roles' });
/** The row button of a role: its name is the first line of the button. */
const row = async (name: string) => within(await roles()).findByRole('button', { name: new RegExp(`^${name}`) });
/** Opens the sheet of a role. */
async function openSheet(name: string, prepare: (state: State) => void = withRoles) {
  const view = await renderApp('/admin/roles', prepare);
  await userEvent.click(await row(name));
  const sheet = await screen.findByRole('dialog', { name });
  return { ...view, sheet };
}
const escape = (text: string) => text.replace(/[()]/g, '\\$&');
/** The heading button of a section: its name is the section word and the count ("Projects 10 of 21 on"). */
const heading = (sheet: HTMLElement, name: string) => within(sheet).getByRole('button', { name: new RegExp(`^${escape(name)} \\d+ of \\d+ on$`) });
/** Opens one section (if it is folded) and returns the queries of the section. */
async function openSection(sheet: HTMLElement, name: string) {
  const button = heading(sheet, name);
  if (button.getAttribute('aria-expanded') !== 'true') await userEvent.click(button);
  return within(within(sheet).getByRole('region', { name }));
}
/** The All switch of a section, found by the section key. */
const allSwitch = (sheet: HTMLElement, key: string) => sheet.querySelector(`#role-all-${key}`) as HTMLElement;
const idsOf = (key: string) => SHEET_SECTIONS.find((section) => section.key === key)!.ids;
const MEMBER = withNeeds([...BASIC_ON]);
const AI = 'AI assistants (MCP)';

describe('the Admin Roles section (owner, 2026-10-18, fbk_014; 121 switches since 2026-10-25)', () => {
  it('shows the Admin as locked and one row for each role, with its people and its rights out of 113', async () => {
    await renderApp('/admin/roles', withRoles);
    const section = within(await roles());
    expect(section.getByText('Everything')).toBeInTheDocument();
    expect(section.queryByRole('switch')).toBeNull();
    expect(await row('Management')).toHaveTextContent('1 person · 78 of 121 rights');
    expect(await row('Accounting')).toHaveTextContent(/ · 73 of 121 rights$/);
    expect(await row('Member')).toHaveTextContent(/ · 68 of 121 rights$/);
    expect(await row('Cashier')).toHaveTextContent('1 person · 72 of 121 rights');
    expect(await row('Planner')).toHaveTextContent('No one yet · 73 of 121 rights');
    // One row for each role, not a wall of switches.
    expect(section.getAllByRole('button').length).toBeLessThan(10);
  });

  it('counts the rights of a role through the shared function, also after the Admin turns basic switches off for Member', async () => {
    await renderApp('/admin/roles', (state) => {
      withRoles(state);
      state.settings.roles = { ...state.settings.roles, off: { member: ['search.use', 'task.work'] } };
    });
    expect(await row('Member')).toHaveTextContent(/ · 66 of 121 rights$/);
    // A custom role without `off` follows the Member list.
    expect(await row('Cashier')).toHaveTextContent('1 person · 70 of 121 rights');
  });

  it('opens the sheet of a role with its people and "Holds 72 of 121", and shows 13 folded sections', async () => {
    const { sheet } = await openSheet('Cashier');
    expect(within(sheet).getByText('Omar Haddad')).toBeInTheDocument();
    expect(within(sheet).getByText('Holds 72 of 121')).toBeInTheDocument();
    expect(SHEET_SECTIONS).toHaveLength(13);
    const sections = within(sheet).getAllByRole('region').filter((region) => region.getAttribute('aria-labelledby')?.startsWith('role-section-'));
    expect(sections).toHaveLength(13);
    // Folded: the headings and the 13 All checkboxes show, and no power switch.
    expect(within(sheet).getAllByRole('checkbox')).toHaveLength(13);
    expect(within(sheet).queryByRole('switch')).toBeNull();
    // The main button stays the only primary action.
    expect(within(sheet).getByRole('button', { name: 'Save role' })).toBeInTheDocument();
  });

  describe('the sections', () => {
    it('opens one section at a time and folds the one that was open', async () => {
      const { sheet } = await openSheet('Cashier');
      await userEvent.click(heading(sheet, 'Projects'));
      expect(heading(sheet, 'Projects')).toHaveAttribute('aria-expanded', 'true');
      expect(within(sheet).getByRole('switch', { name: 'Create projects' })).toBeInTheDocument();
      await userEvent.click(heading(sheet, 'Money'));
      expect(heading(sheet, 'Projects')).toHaveAttribute('aria-expanded', 'false');
      expect(heading(sheet, 'Money')).toHaveAttribute('aria-expanded', 'true');
      expect(within(sheet).queryByRole('switch', { name: 'Create projects' })).toBeNull();
      expect(within(sheet).getByRole('switch', { name: 'See payments' })).toBeInTheDocument();
      // A press on the open section folds it.
      await userEvent.click(heading(sheet, 'Money'));
      expect(heading(sheet, 'Money')).toHaveAttribute('aria-expanded', 'false');
    });

    it('shows how many switches of each section are on, for the Member list', async () => {
      const { sheet } = await openSheet('Member', () => undefined);
      for (const section of SHEET_SECTIONS) {
        const on = section.ids.filter((id) => MEMBER.includes(id)).length;
        const region = within(sheet).getAllByRole('region').find((item) => item.getAttribute('aria-labelledby') === `role-section-${section.key}`)!;
        expect(region).toHaveTextContent(`${on} of ${section.ids.length} on`);
      }
      // 12 of the 25 switches of Projects are on for a Member: create, add client and the 8 "Projects I lead" powers.
      expect(heading(sheet, 'Projects')).toHaveTextContent('12 of 25 on');
      expect(within(sheet).getByText('Holds 68 of 121')).toBeInTheDocument();
    });

    it('gives a power with scopes one switch for each scope with its word, and a power with one switch one switch', async () => {
      const { sheet } = await openSheet('Cashier');
      const projects = await openSection(sheet, 'Projects');
      expect(projects.getByRole('switch', { name: 'Change project details, Projects I lead' })).toHaveAttribute('aria-checked', 'true');
      expect(projects.getByRole('switch', { name: 'Change project details, Every project' })).toHaveAttribute('aria-checked', 'false');
      expect(projects.getAllByRole('switch', { name: /^Change project details/ })).toHaveLength(2);
      expect(projects.getAllByRole('switch', { name: /^Correct the project code/ })).toHaveLength(1);
      expect(projects.getByText('Name, client, location, map pin, area, dates, folder, description, cover and sub-company.')).toBeInTheDocument();
      const todos = await openSection(sheet, 'To-dos');
      expect(todos.getAllByRole('switch', { name: /^Add to-dos/ }).map((item) => item.getAttribute('aria-label'))).toEqual([
        'Add to-dos, Office', 'Add to-dos, My projects', 'Add to-dos, Every project',
      ]);
      const meetings = await openSection(sheet, 'Meetings');
      expect(meetings.getAllByRole('switch', { name: /^Plan meetings/ }).map((item) => item.getAttribute('aria-label'))).toEqual([
        'Plan meetings, No project', 'Plan meetings, My projects', 'Plan meetings, Every project',
      ]);
    });

    it('gives every switch a 44 px press area', async () => {
      const { sheet } = await openSheet('Cashier');
      await openSection(sheet, 'Projects');
      for (const item of within(sheet).getAllByRole('switch')) expect(item.className, item.getAttribute('aria-label') ?? '').toMatch(/min-h-11/);
    });
  });

  describe('the All switch', () => {
    // ARIA allows aria-checked="mixed" on a checkbox and not on a switch, so the All control is a checkbox (role rights version 2).
    it('is a checkbox that reads mixed, and a power row stays a switch', async () => {
      const { sheet } = await openSheet('Cashier');
      const all = allSwitch(sheet, 'projects');
      expect(all).toHaveAttribute('role', 'checkbox');
      expect(all).toHaveAttribute('aria-checked', 'mixed');
      await userEvent.click(all);
      await userEvent.click(within(sheet).getByRole('button', { name: /^Projects/ }));
      expect(within(sheet).getAllByRole('switch').length).toBeGreaterThan(0);
      expect(within(sheet).getAllByRole('checkbox', { checked: true }).length).toBeGreaterThan(0);
    });

    it('reads mixed, on and off, and turns a whole section on and off', async () => {
      const { sheet } = await openSheet('Cashier');
      // A Member list holds 12 of the 25 switches of Projects.
      expect(allSwitch(sheet, 'projects')).toHaveAttribute('aria-checked', 'mixed');
      await userEvent.click(allSwitch(sheet, 'projects'));
      expect(allSwitch(sheet, 'projects')).toHaveAttribute('aria-checked', 'true');
      expect(heading(sheet, 'Projects')).toHaveTextContent('25 of 25 on');
      await userEvent.click(allSwitch(sheet, 'projects'));
      expect(allSwitch(sheet, 'projects')).toHaveAttribute('aria-checked', 'false');
      expect(heading(sheet, 'Projects')).toHaveTextContent('0 of 25 on');
      // The other sections stay as they were: Cashier keeps its 4 payment switches (not the Daftra link).
      expect(heading(sheet, 'Money')).toHaveTextContent('4 of 5 on');
      expect(within(sheet).getByText('Holds 60 of 121')).toBeInTheDocument();
    });

    it('turns a mixed section on with one press and keeps the other sections as they are', async () => {
      const { sheet } = await openSheet('Cashier');
      const total = idsOf('ai').length;
      // Three AI switches are off by default: the Undo of every project, the project set-up switch (owner, 2026-10-25), and the Admin work switch (owner, 2026-10-26).
      expect(heading(sheet, AI)).toHaveTextContent(`${total - 3} of ${total} on`);
      await userEvent.click(allSwitch(sheet, 'ai'));
      expect(heading(sheet, AI)).toHaveTextContent(`${total} of ${total} on`);
      expect(allSwitch(sheet, 'ai')).toHaveAttribute('aria-checked', 'true');
      expect(within(sheet).getByText('Holds 75 of 121')).toBeInTheDocument();
    });

    it('turns on the needed switch of another section with a section: the whole Money section brings nothing outside itself', async () => {
      const { sheet } = await openSheet('Member', () => undefined);
      await userEvent.click(allSwitch(sheet, 'money'));
      expect(within(sheet).getByText('Holds 73 of 121')).toBeInTheDocument();
      expect(allSwitch(sheet, 'money')).toHaveAttribute('aria-checked', 'true');
    });

    it('is there for every section, and each section holds two or more switches', async () => {
      const { sheet } = await openSheet('Cashier');
      expect(SHEET_SECTIONS.every((section) => section.ids.length > 1)).toBe(true);
      for (const section of SHEET_SECTIONS) expect(allSwitch(sheet, section.key), section.key).not.toBeNull();
    });
  });

  describe('switches that need each other', () => {
    it('turns the needed switch on with the switch that needs it, and turns the dependants off with the needed switch', async () => {
      const { sheet } = await openSheet('Accounting');
      const money = await openSection(sheet, 'Money');
      // Accounting holds the four payment switches and the Daftra link. Turn "See payments" off: the four that need it go off with it.
      await userEvent.click(money.getByRole('switch', { name: 'See payments' }));
      for (const name of ['See payments', 'Add payments', 'Change and delete payments', 'Mark payments received', 'Link Daftra invoices']) {
        expect(money.getByRole('switch', { name }), name).toHaveAttribute('aria-checked', 'false');
      }
      expect(heading(sheet, 'Money')).toHaveTextContent('0 of 5 on');
      // Turn "Add payments" on: "See payments" comes on with it.
      await userEvent.click(money.getByRole('switch', { name: 'Add payments' }));
      expect(money.getByRole('switch', { name: 'See payments' })).toHaveAttribute('aria-checked', 'true');
      expect(money.getByRole('switch', { name: 'Change and delete payments' })).toHaveAttribute('aria-checked', 'false');
      expect(heading(sheet, 'Money')).toHaveTextContent('2 of 5 on');
    });

    it('moves the scopes together: "Every project" brings "Projects I lead", and turning "Projects I lead" off turns "Every project" off', async () => {
      const { sheet } = await openSheet('Cashier');
      const projects = await openSection(sheet, 'Projects');
      await userEvent.click(projects.getByRole('switch', { name: 'Change the team, Projects I lead' }));
      await userEvent.click(projects.getByRole('switch', { name: 'Change the team, Every project' }));
      expect(projects.getByRole('switch', { name: 'Change the team, Projects I lead' })).toHaveAttribute('aria-checked', 'true');
      await userEvent.click(projects.getByRole('switch', { name: 'Change the team, Projects I lead' }));
      expect(projects.getByRole('switch', { name: 'Change the team, Every project' })).toHaveAttribute('aria-checked', 'false');
    });

    it('turns every AI switch off with "Connect AI assistants", says what the others need, and brings it back with one of them', async () => {
      const { sheet } = await openSheet('Member', () => undefined);
      const ai = await openSection(sheet, AI);
      const total = idsOf('ai').length;
      expect(ai.queryByText(/^Needs:/)).toBeNull();
      await userEvent.click(ai.getByRole('switch', { name: 'Connect AI assistants' }));
      expect(heading(sheet, AI)).toHaveTextContent(`0 of ${total} on`);
      expect(ai.getAllByText('Needs: Connect AI assistants.').length).toBe(16);
      await userEvent.click(ai.getByRole('switch', { name: 'AI reads chats' }));
      expect(ai.getByRole('switch', { name: 'Connect AI assistants' })).toHaveAttribute('aria-checked', 'true');
      expect(ai.getByRole('switch', { name: 'AI reads chats' })).toHaveAttribute('aria-checked', 'true');
      expect(ai.queryAllByText('Needs: Connect AI assistants.')).toHaveLength(0);
    });

    it('does not say a need twice when the line of the power already names it', async () => {
      const { sheet } = await openSheet('Member', () => undefined);
      const money = await openSection(sheet, 'Money');
      expect(money.getByText(/Add a new payment to a project\. Needs "See payments"\./)).toBeInTheDocument();
      expect(money.queryByText('Needs: See payments.')).toBeNull();
    });
  });

  it('puts the three approved lines at the top of the AI section, and in no other section', async () => {
    const { sheet } = await openSheet('Member', () => undefined);
    const ai = await openSection(sheet, AI);
    expect(ai.getByText('What it is: an AI app, such as Claude or ChatGPT, that connects to Madar and works for one person.')).toBeInTheDocument();
    expect(ai.getByText('The rule: an assistant never does more than its person may do. These switches only take more away from the assistants of this role.')).toBeInTheDocument();
    expect(ai.getByText('An assistant can never: delete projects, upload files or change pictures. It does Admin work only with the switch "AI does Admin work". It creates projects and clients only with the switch "AI creates projects and clients".')).toBeInTheDocument();
    const money = await openSection(sheet, 'Money');
    expect(money.queryByText(/^What it is:/)).toBeNull();
  });

  it('warns when Create projects is on and three or more "Projects I lead" switches are off', async () => {
    const { sheet } = await openSheet('Cashier');
    expect(within(sheet).queryByText('A person who makes a project leads it.')).toBeNull();
    const projects = await openSection(sheet, 'Projects');
    await userEvent.click(projects.getByRole('switch', { name: 'Change project details, Projects I lead' }));
    expect(within(sheet).queryByText('A person who makes a project leads it.')).toBeNull();
    await userEvent.click(projects.getByRole('switch', { name: 'Change the team, Projects I lead' }));
    expect(within(sheet).getByText('A person who makes a project leads it.')).toBeInTheDocument();
    // Without Create projects there is no one who makes a project, so no warning.
    await userEvent.click(projects.getByRole('switch', { name: 'Create projects' }));
    expect(within(sheet).queryByText('A person who makes a project leads it.')).toBeNull();
  });

  describe('Back to the standard list', () => {
    it('brings a built-in role back to its default: Management holds 75', async () => {
      const { sheet } = await openSheet('Management');
      expect(within(sheet).getByText('Holds 78 of 121')).toBeInTheDocument();
      const money = await openSection(sheet, 'Money');
      await userEvent.click(money.getByRole('switch', { name: 'See payments' }));
      expect(within(sheet).getByText('Holds 74 of 121')).toBeInTheDocument();
      await userEvent.click(within(sheet).getByRole('button', { name: 'Back to the standard list' }));
      expect(within(sheet).getByText('Holds 78 of 121')).toBeInTheDocument();
      expect(money.getByRole('switch', { name: 'See payments' })).toHaveAttribute('aria-checked', 'true');
    });

    it('brings a custom role back to the Member list', async () => {
      const { sheet } = await openSheet('Cashier');
      expect(within(sheet).getByText('Holds 72 of 121')).toBeInTheDocument();
      await userEvent.click(within(sheet).getByRole('button', { name: 'Back to the standard list' }));
      expect(within(sheet).getByText('Holds 68 of 121')).toBeInTheDocument();
    });

    it('changes nothing in the office before Save role', async () => {
      const { sheet, store } = await openSheet('Cashier');
      await userEvent.click(within(sheet).getByRole('button', { name: 'Back to the standard list' }));
      expect(store.state.settings.roles?.custom?.[0].rights).toEqual(['payment.manage']);
    });
  });

  describe('Save role', () => {
    it('saves the switches that are not basic as rights and the basic switches that are off as off, with one press', async () => {
      const { sheet, store } = await openSheet('Cashier');
      const money = await openSection(sheet, 'Money');
      await userEvent.click(money.getByRole('switch', { name: 'Add payments' }));
      const tasks = await openSection(sheet, 'To-dos');
      await userEvent.click(tasks.getByRole('switch', { name: 'Delete my to-dos' }));
      // Nothing is saved before Save role.
      expect(store.state.settings.roles?.custom?.[0].rights).toEqual(['payment.manage']);
      await userEvent.click(within(sheet).getByRole('button', { name: 'Save role' }));
      await waitFor(() => expect(store.state.settings.roles?.custom?.[0].off).toEqual(['task.deleteOwn']));
      expect(store.state.settings.roles?.custom?.[0].rights).toEqual(['payment.view', 'payment.change', 'payment.receive']);
      // The saved role now holds its own full list: 68 - 1 + 3 = 70.
      expect(heldRightsOfRole(store.state.settings.roles, store.state.settings.roles!.custom![0])).toHaveLength(70);
      expect(await row('Cashier')).toHaveTextContent('1 person · 70 of 121 rights');
    });

    it('saves a built-in role: the extras of the role as rights, the basic switches that are off as off', async () => {
      const { sheet, store } = await openSheet('Accounting');
      const money = await openSection(sheet, 'Money');
      await userEvent.click(money.getByRole('switch', { name: 'See payments' }));
      const dash = await openSection(sheet, 'Dashboard and reports');
      await userEvent.click(dash.getByRole('switch', { name: 'Use Search' }));
      await userEvent.click(within(sheet).getByRole('button', { name: 'Save role' }));
      await waitFor(() => expect(store.state.settings.roles?.rights?.accounting).toEqual([]));
      expect(store.state.settings.roles?.off?.accounting).toEqual(['search.use']);
      expect(store.state.settings.roles?.rights?.management).toBeUndefined();
      expect(await row('Accounting')).toHaveTextContent(/ · 67 of 121 rights$/);
    });

    it('writes no change when a built-in role is saved as it was', async () => {
      const { sheet, store } = await openSheet('Management');
      await userEvent.click(within(sheet).getByRole('button', { name: 'Save role' }));
      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Management' })).toBeNull());
      expect(store.state.settings.roles?.off?.management ?? []).toEqual([]);
      expect(Object.values(store.state.events).filter((event) => event.verb === 'role.updated')).toHaveLength(0);
    });

    it('takes an Undo of the save back to the old role', async () => {
      const { sheet, store } = await openSheet('Cashier');
      const money = await openSection(sheet, 'Money');
      await userEvent.click(money.getByRole('switch', { name: 'Change and delete payments' }));
      await userEvent.click(within(sheet).getByRole('button', { name: 'Save role' }));
      await waitFor(() => expect(store.state.settings.roles?.custom?.[0].off).toEqual([]));
      await userEvent.click(await screen.findByRole('button', { name: 'Undo' }));
      await waitFor(() => expect(store.state.settings.roles?.custom?.[0].off).toBeUndefined());
      expect(expandRights(store.state.settings.roles?.custom?.[0].rights ?? [])).toEqual(['payment.view', 'payment.add', 'payment.change', 'payment.receive']);
    });
  });

  describe('a new role', () => {
    it('starts as a copy of the Member list, and a later change of Member does not change it', async () => {
      const { store } = await renderApp('/admin/roles', (state) => {
        withRoles(state);
        state.settings.roles = { ...state.settings.roles, off: { member: ['search.use'] } };
      });
      await userEvent.click(within(await roles()).getByRole('button', { name: 'New role' }));
      const sheet = await screen.findByRole('dialog', { name: 'New role' });
      // The Member list of this office holds 64 (Search is off).
      expect(within(sheet).getByText('Holds 67 of 121')).toBeInTheDocument();
      await userEvent.type(within(sheet).getByLabelText(/Name in English/), 'Site lead');
      await userEvent.type(within(sheet).getByLabelText(/Name in Arabic/), 'مسؤول الموقع');
      const people = await openSection(sheet, 'People and clients');
      await userEvent.click(people.getByRole('switch', { name: 'Invite people' }));
      await userEvent.click(within(sheet).getByRole('button', { name: 'Save role' }));
      await waitFor(() => expect(store.state.settings.roles?.custom).toHaveLength(3));
      expect(store.state.settings.roles?.custom?.[2]).toMatchObject({ id: 'rol_003', name: 'Site lead', nameAr: 'مسؤول الموقع', rights: ['people.invite'], off: ['search.use'] });
      // The new role holds its own full list: 64 + 1.
      expect(await row('Site lead')).toHaveTextContent('No one yet · 68 of 121 rights');
    });

    it('makes a role with all the switches of two sections from the New role sheet', async () => {
      const { store } = await renderApp('/admin/roles', withRoles);
      await userEvent.click(within(await roles()).getByRole('button', { name: 'New role' }));
      const sheet = await screen.findByRole('dialog', { name: 'New role' });
      await userEvent.type(within(sheet).getByLabelText(/Name in English/), 'Office lead');
      await userEvent.type(within(sheet).getByLabelText(/Name in Arabic/), 'قائد المكتب');
      await userEvent.click(allSwitch(sheet, 'money'));
      await userEvent.click(allSwitch(sheet, 'templates'));
      await userEvent.click(within(sheet).getByRole('button', { name: 'Save role' }));
      await waitFor(() => expect(store.state.settings.roles?.custom).toHaveLength(3));
      const saved = store.state.settings.roles!.custom![2];
      expect(saved.off).toEqual([]);
      expect(saved.rights).toEqual(CATALOG_RIGHT_IDS.filter((id) => id.startsWith('payment.') || id.startsWith('templates.')).filter((id) => !BASIC_ON.includes(id)));
    });

    it('shows the name of another role under the name field, and saves nothing', async () => {
      const { store } = await renderApp('/admin/roles', withRoles);
      await userEvent.click(within(await roles()).getByRole('button', { name: 'New role' }));
      const sheet = await screen.findByRole('dialog', { name: 'New role' });
      await userEvent.type(within(sheet).getByLabelText(/Name in English/), 'cashier');
      await userEvent.type(within(sheet).getByLabelText(/Name in Arabic/), 'دور جديد');
      await userEvent.click(within(sheet).getByRole('button', { name: 'Save role' }));
      expect(await within(sheet).findByText('Another role has this name. Use another name.')).toBeInTheDocument();
      expect(store.state.settings.roles?.custom).toHaveLength(2);
    });
  });

  it('has Cancel, which leaves the rights as they were', async () => {
    const { sheet, store } = await openSheet('Cashier');
    const money = await openSection(sheet, 'Money');
    await userEvent.click(money.getByRole('switch', { name: 'Add payments' }));
    await userEvent.click(within(sheet).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Cashier' })).toBeNull());
    expect(store.state.settings.roles?.custom?.[0].rights).toEqual(['payment.manage']);
    expect(store.state.settings.roles?.custom?.[0].off).toBeUndefined();
  });

  it('opens a built-in role with no name field, and the Member list with the standard switches on', async () => {
    const { sheet } = await openSheet('Member');
    expect(within(sheet).queryByLabelText('Name in English')).toBeNull();
    const tasks = await openSection(sheet, 'To-dos');
    expect(tasks.getByRole('switch', { name: 'Work on my to-dos' })).toHaveAttribute('aria-checked', 'true');
    expect(tasks.getByRole('switch', { name: 'See and manage every office to-do' })).toHaveAttribute('aria-checked', 'false');
  });

  it('deletes a role that nobody holds at once, with Undo', async () => {
    const { sheet, store } = await openSheet('Planner');
    expect(within(sheet).getByText('No one has this role yet.')).toBeInTheDocument();
    await userEvent.click(within(sheet).getByRole('button', { name: 'Delete role' }));
    await waitFor(() => expect(store.state.settings.roles?.custom?.map((role) => role.id)).toEqual(['rol_001']));
    await userEvent.click(await screen.findByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(store.state.settings.roles?.custom?.map((role) => role.id)).toEqual(['rol_001', 'rol_002']));
  });

  it('names the person of a role in use, moves the person to the role that the Admin picks, and one Undo brings both back (ADM-14)', async () => {
    const { sheet, store } = await openSheet('Cashier');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Delete role' }));
    const question = await screen.findByRole('dialog', { name: 'Delete Cashier?' });
    expect(within(question).getByText('Omar Haddad')).toBeInTheDocument();
    expect(within(question).getByText(/This person holds this role/)).toBeInTheDocument();
    expect(within(question).getByLabelText('New role of these people')).toHaveValue('member');
    expect(store.state.settings.roles?.custom).toHaveLength(2);
    await userEvent.click(within(question).getByRole('button', { name: 'Delete and move' }));
    await waitFor(() => expect(store.state.settings.roles?.custom?.map((role) => role.id)).toEqual(['rol_002']));
    expect(store.state.users.usr_004).toMatchObject({ systemRole: 'member', roleId: null });
    expect(await screen.findByText('Role deleted. 1 person moved.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(store.state.users.usr_004.roleId).toBe('rol_001'));
    expect(store.state.settings.roles?.custom?.map((role) => role.id)).toContain('rol_001');
  });

  it('stays closed to Management: the Roles section does not open, and the People section does', async () => {
    await renderApp('/admin/roles', (state) => {
      withRoles(state);
      state.session.currentUserId = 'usr_010';
    });
    expect(await screen.findByRole('region', { name: 'People' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Roles' })).toBeNull();
  });

  it('shows the sheet in Arabic with every word in place', async () => {
    await renderApp('/admin/roles', (state) => {
      withRoles(state);
      state.users.usr_001.preferences.language = 'ar';
    });
    await userEvent.click(await within(await screen.findByRole('region', { name: 'الأدوار' })).findByRole('button', { name: /^أمين الصندوق/ }));
    const sheet = await screen.findByRole('dialog', { name: 'أمين الصندوق' });
    expect(within(sheet).getByText('يملك هذا الدور 72 من 121')).toBeInTheDocument();
    await userEvent.click(within(sheet).getByRole('button', { name: /^المشاريع \d+ من \d+/ }));
    expect(within(sheet).getByRole('switch', { name: 'تعديل بيانات المشروع، مشاريع أقودها' })).toBeInTheDocument();
    expect(within(sheet).getByRole('switch', { name: 'إنشاء المشاريع' })).toBeInTheDocument();
    await userEvent.click(within(sheet).getByRole('button', { name: /^مساعدو الذكاء الاصطناعي/ }));
    expect(within(sheet).getByText(/^القاعدة: المساعد لا يفعل أكثر مما يحق لصاحبه/)).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: 'ارجع إلى القائمة المعتادة' })).toBeInTheDocument();
    // A word that is missing shows its key.
    expect(sheet.textContent).not.toMatch(/roleRights\.|roles\.sheet\./);
  });
});
